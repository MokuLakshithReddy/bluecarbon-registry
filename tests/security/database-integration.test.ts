import test from "node:test";
import assert from "node:assert";
import { PGlite } from "@electric-sql/pglite";

/**
 * Database Authorization & RLS Integration Tests
 *
 * Audit Reference:
 * - P0 Authorization: Binds verifier identity to auth.uid() in confirm_blockchain_anchor and record_blockchain_failure.
 * - P0 Verification integrity: Rejects simulated anchors in confirm_blockchain_anchor, keeping DEMO_SIMULATED distinct.
 * - P1 Outbox recovery: Safe job claiming, lease locking, retries, and backoff.
 * - P1 Database RLS & immutability verification.
 */

async function initTestDatabase() {
  const db = new PGlite();

  // 1. Create Roles
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
  `);

  // 2. Create Types
  await db.exec(`
    CREATE TYPE public.app_role AS ENUM ('admin', 'verifier', 'project_owner');
    CREATE TYPE public.project_status AS ENUM (
      'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED_PENDING_ANCHOR', 'VERIFIED', 'DEMO_SIMULATED', 'CORRECTION_REQUIRED', 'REJECTED'
    );
    CREATE TYPE public.review_decision AS ENUM ('APPROVED', 'CORRECTION_REQUESTED', 'REJECTED');
  `);

  // 3. Supabase Auth Emulation Schema
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;

    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE AS $$
      SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claims', true), '')::jsonb,
        jsonb_build_object('role', current_setting('request.jwt.claim.role', true))
      );
    $$;

    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
  `);

  // 4. Create Tables
  await db.exec(`
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      email text,
      full_name text,
      organization text,
      phone text,
      created_at timestamptz DEFAULT now()
    );

    CREATE TABLE public.user_roles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      role public.app_role NOT NULL,
      created_at timestamptz DEFAULT now(),
      UNIQUE (user_id, role)
    );

    CREATE TABLE public.projects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL,
      project_code text NOT NULL,
      name text NOT NULL,
      status public.project_status NOT NULL DEFAULT 'DRAFT',
      estimated_carbon numeric NOT NULL DEFAULT 0,
      verified_carbon numeric,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );

    CREATE TABLE public.verification_reviews (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES public.projects(id),
      verifier_id uuid NOT NULL,
      verifier_email text,
      decision public.review_decision NOT NULL,
      comments text,
      created_at timestamptz DEFAULT now()
    );

    CREATE TABLE public.carbon_impact_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES public.projects(id),
      verified_tco2e numeric NOT NULL,
      verified_by uuid NOT NULL,
      methodology text NOT NULL,
      created_at timestamptz DEFAULT now()
    );

    CREATE TABLE public.blockchain_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES public.projects(id),
      record_hash text NOT NULL,
      tx_hash text,
      block_number bigint,
      network text,
      status text NOT NULL,
      verifier_id uuid NOT NULL,
      verified_tco2e numeric NOT NULL,
      anchored_payload jsonb NOT NULL,
      created_at timestamptz DEFAULT now()
    );

    CREATE TABLE public.blockchain_outbox (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
      payload jsonb NOT NULL,
      status text NOT NULL DEFAULT 'PENDING',
      record_hash text,
      tx_hash text,
      attempts int NOT NULL DEFAULT 0,
      last_error text,
      locked_until timestamptz,
      locked_by text,
      next_retry_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // 5. Helper & Security Functions
  await db.exec(`
    CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
    RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = _user_id AND role = _role
      );
    $$;

    CREATE OR REPLACE FUNCTION public.is_verifier()
    RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT public.has_role(auth.uid(), 'verifier');
    $$;

    CREATE OR REPLACE FUNCTION public.is_service_role()
    RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT (
        session_user = 'service_role' OR
        coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' OR
        coalesce(auth.jwt()->>'role', '') = 'service_role'
      );
    $$;

    CREATE OR REPLACE FUNCTION public.admin_assign_role(
      _target_user_id uuid,
      _new_role public.app_role
    )
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    BEGIN
      IF NOT (public.has_role(auth.uid(), 'admin') OR public.is_service_role()) THEN
        RAISE EXCEPTION 'Unauthorized: only registry administrators can assign roles.';
      END IF;

      INSERT INTO public.user_roles (user_id, role)
      VALUES (_target_user_id, _new_role)
      ON CONFLICT (user_id, role) DO NOTHING;
    END; $$;

    CREATE OR REPLACE FUNCTION public.perform_verification_decision(
      _project_id uuid,
      _decision text,
      _comments text,
      _confirmed_carbon numeric,
      _verifier_id uuid,
      _verifier_email text,
      _expected_status public.project_status,
      _anchor_payload jsonb DEFAULT NULL
    )
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    DECLARE
      v_project public.projects%ROWTYPE;
      v_new_status public.project_status;
      v_review_decision public.review_decision;
    BEGIN
      -- A. Verify caller authorization & bind identity
      IF NOT (
        public.has_role(_verifier_id, 'verifier') OR
        public.has_role(_verifier_id, 'admin') OR
        public.is_service_role()
      ) THEN
        RAISE EXCEPTION 'Unauthorized: Caller % is not an authorized verifier.', _verifier_id;
      END IF;

      IF NOT public.is_service_role() AND auth.uid() IS DISTINCT FROM _verifier_id THEN
        RAISE EXCEPTION 'Caller identity mismatch: auth.uid does not match verifier_id.';
      END IF;

      -- B. Row lock and concurrency check
      SELECT * INTO v_project
      FROM public.projects
      WHERE id = _project_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Project not found: %', _project_id;
      END IF;

      IF v_project.status IS DISTINCT FROM _expected_status THEN
        RAISE EXCEPTION 'Concurrency conflict: project status is %, expected %.', v_project.status, _expected_status;
      END IF;

      IF _decision = 'APPROVE' THEN
        IF v_project.status != 'UNDER_REVIEW' THEN
          RAISE EXCEPTION 'Invalid transition: Project must be UNDER_REVIEW before approval.';
        END IF;

        IF _confirmed_carbon IS NULL OR _confirmed_carbon <= 0 THEN
          RAISE EXCEPTION 'Invalid carbon value: Confirmed carbon must be a positive number.';
        END IF;

        v_new_status := 'VERIFIED_PENDING_ANCHOR';
        v_review_decision := 'APPROVED';

        -- Enqueue outbox with stored canonical payload
        INSERT INTO public.blockchain_outbox (project_id, payload, status)
        VALUES (
          v_project.id,
          COALESCE(
            _anchor_payload,
            jsonb_build_object(
              'project_code', v_project.project_code,
              'verified_carbon', _confirmed_carbon,
              'verifier_id', _verifier_id
            )
          ),
          'PENDING'
        );
      ELSE
        RAISE EXCEPTION 'Unknown decision: %', _decision;
      END IF;

      UPDATE public.projects
      SET status = v_new_status, updated_at = now()
      WHERE id = v_project.id;

      INSERT INTO public.verification_reviews (project_id, verifier_id, verifier_email, decision, comments)
      VALUES (v_project.id, _verifier_id, _verifier_email, v_review_decision, _comments);

      INSERT INTO public.carbon_impact_records (project_id, verified_tco2e, verified_by, methodology)
      VALUES (v_project.id, _confirmed_carbon, _verifier_id, 'IPCC-2019-WETLANDS-MNG');

      RETURN jsonb_build_object('status', v_new_status, 'verified_carbon', _confirmed_carbon);
    END; $$;

    -- CONFIRM BLOCKCHAIN ANCHOR (Strict identity binding & strictly rejects non-CONFIRMED)
    CREATE OR REPLACE FUNCTION public.confirm_blockchain_anchor(
      _project_id uuid,
      _record_hash text,
      _tx_hash text,
      _block_number bigint,
      _network text,
      _status text,
      _verifier_id uuid,
      _verified_tco2e numeric,
      _anchored_payload jsonb
    )
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    DECLARE
      v_project public.projects%ROWTYPE;
    BEGIN
      IF NOT (
        public.has_role(_verifier_id, 'verifier') OR
        public.has_role(_verifier_id, 'admin') OR
        public.is_service_role()
      ) THEN
        RAISE EXCEPTION 'Unauthorized: Caller is not an authorized verifier.';
      END IF;

      -- Strict identity binding
      IF NOT public.is_service_role() AND auth.uid() IS DISTINCT FROM _verifier_id THEN
        RAISE EXCEPTION 'Caller identity mismatch: auth.uid does not match verifier_id.';
      END IF;

      -- Reject simulated or non-final statuses
      IF _status != 'CONFIRMED' THEN
        RAISE EXCEPTION 'Rejected: Only genuine CONFIRMED blockchain records can promote project to VERIFIED. Status "%" cannot be confirmed.', _status;
      END IF;

      SELECT * INTO v_project FROM public.projects WHERE id = _project_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Project not found: %', _project_id;
      END IF;

      INSERT INTO public.blockchain_records (
        project_id, record_hash, tx_hash, block_number, network, status, verifier_id, verified_tco2e, anchored_payload
      ) VALUES (
        _project_id, _record_hash, _tx_hash, _block_number, _network, 'CONFIRMED', _verifier_id, _verified_tco2e, _anchored_payload
      );

      UPDATE public.projects
      SET status = 'VERIFIED', verified_carbon = _verified_tco2e, updated_at = now()
      WHERE id = _project_id;

      UPDATE public.blockchain_outbox
      SET status = 'CONFIRMED', record_hash = _record_hash, tx_hash = _tx_hash, completed_at = now()
      WHERE project_id = _project_id AND status = 'PENDING';

      RETURN jsonb_build_object('project_id', _project_id, 'status', 'VERIFIED');
    END; $$;

    -- RECORD BLOCKCHAIN FAILURE (Strict identity binding & backoff)
    CREATE OR REPLACE FUNCTION public.record_blockchain_failure(
      _project_id uuid,
      _error_message text,
      _verifier_id uuid
    )
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    BEGIN
      IF NOT (
        public.has_role(_verifier_id, 'verifier') OR
        public.has_role(_verifier_id, 'admin') OR
        public.is_service_role()
      ) THEN
        RAISE EXCEPTION 'Unauthorized: Caller is not an authorized verifier.';
      END IF;

      IF NOT public.is_service_role() AND auth.uid() IS DISTINCT FROM _verifier_id THEN
        RAISE EXCEPTION 'Caller identity mismatch: auth.uid does not match verifier_id.';
      END IF;

      UPDATE public.blockchain_outbox
      SET
        attempts = attempts + 1,
        last_error = _error_message,
        locked_until = NULL,
        locked_by = NULL,
        next_retry_at = now() + interval '30 seconds',
        updated_at = now()
      WHERE project_id = _project_id AND status = 'PENDING';

      RETURN jsonb_build_object('success', true);
    END; $$;

    -- RECORD SIMULATED DEMO ANCHOR (Strictly sets DEMO_SIMULATED, never VERIFIED)
    CREATE OR REPLACE FUNCTION public.record_simulated_demo_anchor(
      _project_id uuid,
      _record_hash text,
      _tx_hash text,
      _verifier_id uuid,
      _verified_tco2e numeric,
      _anchored_payload jsonb
    )
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    BEGIN
      IF NOT (
        public.has_role(_verifier_id, 'verifier') OR
        public.has_role(_verifier_id, 'admin') OR
        public.is_service_role()
      ) THEN
        RAISE EXCEPTION 'Unauthorized: Caller is not an authorized verifier.';
      END IF;

      IF NOT public.is_service_role() AND auth.uid() IS DISTINCT FROM _verifier_id THEN
        RAISE EXCEPTION 'Caller identity mismatch: auth.uid does not match verifier_id.';
      END IF;

      INSERT INTO public.blockchain_records (
        project_id, record_hash, tx_hash, block_number, network, status, verifier_id, verified_tco2e, anchored_payload
      ) VALUES (
        _project_id, _record_hash, _tx_hash, 0, 'Simulated Testnet Demo', 'SIMULATED', _verifier_id, _verified_tco2e, _anchored_payload
      );

      UPDATE public.projects
      SET status = 'DEMO_SIMULATED', verified_carbon = _verified_tco2e, updated_at = now()
      WHERE id = _project_id;

      UPDATE public.blockchain_outbox
      SET status = 'SIMULATED', record_hash = _record_hash, tx_hash = _tx_hash, completed_at = now()
      WHERE project_id = _project_id AND status = 'PENDING';

      RETURN jsonb_build_object('project_id', _project_id, 'status', 'DEMO_SIMULATED');
    END; $$;

    -- CLAIM NEXT OUTBOX JOB
    CREATE OR REPLACE FUNCTION public.claim_next_outbox_job(
      _worker_id text,
      _lease_seconds int DEFAULT 60
    )
    RETURNS TABLE (
      id uuid,
      project_id uuid,
      payload jsonb,
      status text,
      attempts int
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public AS $$
    DECLARE
      v_job public.blockchain_outbox%ROWTYPE;
      v_lease_interval interval := (_lease_seconds || ' seconds')::interval;
    BEGIN
      IF NOT (public.is_verifier() OR public.has_role(auth.uid(), 'admin') OR public.is_service_role()) THEN
        RAISE EXCEPTION 'Unauthorized: Only verifiers or service-role can claim outbox jobs.';
      END IF;

      SELECT * INTO v_job
      FROM public.blockchain_outbox
      WHERE public.blockchain_outbox.status = 'PENDING'
        AND (public.blockchain_outbox.locked_until IS NULL OR public.blockchain_outbox.locked_until < now())
        AND public.blockchain_outbox.next_retry_at <= now()
      ORDER BY public.blockchain_outbox.created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1;

      IF FOUND THEN
        UPDATE public.blockchain_outbox
        SET
          locked_until = now() + v_lease_interval,
          locked_by = _worker_id,
          attempts = public.blockchain_outbox.attempts + 1,
          updated_at = now()
        WHERE public.blockchain_outbox.id = v_job.id;

        RETURN QUERY
        SELECT v_job.id, v_job.project_id, v_job.payload, v_job.status, v_job.attempts + 1;
      END IF;

      RETURN;
    END; $$;
  `);

  // 6. Enable RLS and define policies
  await db.exec(`
    -- user_roles RLS
    ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "read own roles" ON public.user_roles FOR SELECT TO authenticated
      USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
    CREATE POLICY "admin assign roles" ON public.user_roles FOR INSERT TO authenticated
      WITH CHECK (public.has_role(auth.uid(), 'admin'));
    CREATE POLICY "admin update roles" ON public.user_roles FOR UPDATE TO authenticated
      USING (public.has_role(auth.uid(), 'admin'))
      WITH CHECK (public.has_role(auth.uid(), 'admin'));
    CREATE POLICY "admin delete roles" ON public.user_roles FOR DELETE TO authenticated
      USING (public.has_role(auth.uid(), 'admin'));

    -- projects RLS
    ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "read all projects" ON public.projects FOR SELECT TO authenticated USING (true);
    CREATE POLICY "owners update own projects" ON public.projects FOR UPDATE TO authenticated
      USING (auth.uid() = owner_id AND status IN ('DRAFT', 'CORRECTION_REQUIRED'))
      WITH CHECK (auth.uid() = owner_id AND status IN ('DRAFT', 'CORRECTION_REQUIRED'));

    -- verification_reviews RLS (Immutable)
    ALTER TABLE public.verification_reviews ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "review read authenticated" ON public.verification_reviews FOR SELECT TO authenticated USING (true);
    CREATE POLICY "review no update" ON public.verification_reviews FOR UPDATE TO authenticated USING (false);
    CREATE POLICY "review no delete" ON public.verification_reviews FOR DELETE TO authenticated USING (false);

    -- carbon_impact_records RLS (Immutable)
    ALTER TABLE public.carbon_impact_records ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "impact read authenticated" ON public.carbon_impact_records FOR SELECT TO authenticated USING (true);
    CREATE POLICY "carbon impact no update" ON public.carbon_impact_records FOR UPDATE TO authenticated USING (false);
    CREATE POLICY "carbon impact no delete" ON public.carbon_impact_records FOR DELETE TO authenticated USING (false);

    -- Grant access to roles
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
    GRANT SELECT ON public.projects TO anon;
  `);

  return db;
}

/**
 * Switch Postgres execution session context
 */
async function setSessionContext(
  db: PGlite,
  role: "anon" | "authenticated" | "service_role",
  userId?: string,
) {
  await db.exec(`SET ROLE ${role};`);
  if (role === "service_role") {
    await db.exec(`
      SET request.jwt.claim.role = 'service_role';
      SET request.jwt.claim.sub = '${userId || "00000000-0000-0000-0000-000000000000"}';
      SET request.jwt.claims = '{"role": "service_role"}';
    `);
  } else if (role === "authenticated") {
    await db.exec(`
      SET request.jwt.claim.role = 'authenticated';
      SET request.jwt.claim.sub = '${userId || "00000000-0000-0000-0000-000000000001"}';
      SET request.jwt.claims = '{"role": "authenticated", "sub": "${userId || "00000000-0000-0000-0000-000000000001"}"}';
    `);
  } else {
    await db.exec(`
      SET request.jwt.claim.role = 'anon';
      SET request.jwt.claim.sub = '';
      SET request.jwt.claims = '{"role": "anon"}';
    `);
  }
}

test("DB Integration: is_service_role() accurately identifies service-role vs client execution contexts", async () => {
  const db = await initTestDatabase();

  // 1. As service_role role
  await setSessionContext(db, "service_role");
  const res1 = await db.query("SELECT public.is_service_role() as is_sr;");
  assert.strictEqual(res1.rows[0].is_sr, true, "Must detect service_role session");

  // 2. As authenticated regular user
  await setSessionContext(db, "authenticated", "11111111-1111-1111-1111-111111111111");
  const res2 = await db.query("SELECT public.is_service_role() as is_sr;");
  assert.strictEqual(res2.rows[0].is_sr, false, "Must return false for authenticated user");

  // 3. As anonymous user
  await setSessionContext(db, "anon");
  const res3 = await db.query("SELECT public.is_service_role() as is_sr;");
  assert.strictEqual(res3.rows[0].is_sr, false, "Must return false for anonymous client");
});

test("DB Integration: RLS blocks privilege escalation and unauthorized role assignments", async () => {
  const db = await initTestDatabase();

  const adminId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const verifierId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const attackerId = "cccccccc-cccc-cccc-cccc-cccccccccccc";

  await db.exec(`
    INSERT INTO public.user_roles (user_id, role) VALUES ('${adminId}', 'admin');
    INSERT INTO public.user_roles (user_id, role) VALUES ('${attackerId}', 'project_owner');
  `);

  await setSessionContext(db, "authenticated", attackerId);
  await assert.rejects(
    async () => {
      await db.exec(`
        INSERT INTO public.user_roles (user_id, role)
        VALUES ('${attackerId}', 'verifier');
      `);
    },
    /new row violates row-level security policy/,
    "Attacker must be blocked from self-assigning verifier role by user_roles RLS",
  );

  await assert.rejects(
    async () => {
      await db.exec(`
        SELECT public.admin_assign_role('${attackerId}', 'admin');
      `);
    },
    /Unauthorized: only registry administrators can assign roles/,
    "Attacker must be rejected by admin_assign_role security check",
  );

  await setSessionContext(db, "authenticated", adminId);
  await db.exec(`
    SELECT public.admin_assign_role('${verifierId}', 'verifier');
  `);

  const checkRole = await db.query(
    `SELECT role FROM public.user_roles WHERE user_id = '${verifierId}'`,
  );
  assert.strictEqual(checkRole.rows[0].role, "verifier");
});

test("DB Integration: Only authorized verifiers can perform verification decisions", async () => {
  const db = await initTestDatabase();

  const verifierId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const ownerId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const projectId = "dddddddd-dddd-dddd-dddd-dddddddddddd";

  await db.exec(`
    INSERT INTO public.user_roles (user_id, role) VALUES ('${verifierId}', 'verifier');
    INSERT INTO public.user_roles (user_id, role) VALUES ('${ownerId}', 'project_owner');
    INSERT INTO public.projects (id, owner_id, project_code, name, status, estimated_carbon)
    VALUES ('${projectId}', '${ownerId}', 'BC-MNG-INTG', 'Integration Mangrove', 'UNDER_REVIEW', 500);
  `);

  await setSessionContext(db, "authenticated", ownerId);
  await assert.rejects(
    async () => {
      await db.exec(`
        SELECT public.perform_verification_decision(
          '${projectId}', 'APPROVE', 'Self approved', 500, '${ownerId}', 'owner@test.org', 'UNDER_REVIEW'
        );
      `);
    },
    /Unauthorized: Caller .* is not an authorized verifier/,
    "Project owner must be rejected from approving verification",
  );

  await setSessionContext(db, "authenticated", verifierId);
  const decisionRes = await db.query(`
    SELECT public.perform_verification_decision(
      '${projectId}', 'APPROVE', 'Verified by field audit', 520.5, '${verifierId}', 'verifier@test.org', 'UNDER_REVIEW'
    ) as result;
  `);

  const result = (decisionRes.rows[0] as { result: { status: string; verified_carbon: number } })
    .result;
  assert.strictEqual(result.status, "VERIFIED_PENDING_ANCHOR");
  assert.strictEqual(result.verified_carbon, 520.5);

  const projCheck = await db.query(`SELECT status FROM public.projects WHERE id = '${projectId}';`);
  assert.strictEqual(projCheck.rows[0].status, "VERIFIED_PENDING_ANCHOR");

  const outboxCheck = await db.query(
    `SELECT status FROM public.blockchain_outbox WHERE project_id = '${projectId}';`,
  );
  assert.strictEqual(outboxCheck.rows.length, 1);
  assert.strictEqual(outboxCheck.rows[0].status, "PENDING");
});

test("DB Integration: confirm_blockchain_anchor binds caller identity to auth.uid and rejects non-verifiers", async () => {
  const db = await initTestDatabase();

  const verifierId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const attackerId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const projectId = "dddddddd-dddd-dddd-dddd-dddddddddddd";

  await db.exec(`
    INSERT INTO public.user_roles (user_id, role) VALUES ('${verifierId}', 'verifier');
    INSERT INTO public.user_roles (user_id, role) VALUES ('${attackerId}', 'project_owner');
    INSERT INTO public.projects (id, owner_id, project_code, name, status, estimated_carbon)
    VALUES ('${projectId}', '${attackerId}', 'BC-MNG-BIND', 'Identity Binding Test', 'VERIFIED_PENDING_ANCHOR', 500);
  `);

  // 1. Attacker attempts to call confirm_blockchain_anchor supplying real verifier's ID
  await setSessionContext(db, "authenticated", attackerId);
  await assert.rejects(
    async () => {
      await db.exec(`
        SELECT public.confirm_blockchain_anchor(
          '${projectId}', '0x123', '0xabc', 100, 'Polygon Amoy', 'CONFIRMED', '${verifierId}', 500, '{"test": true}'::jsonb
        );
      `);
    },
    /Caller identity mismatch: auth.uid does not match verifier_id/,
    "Must fail closed when authenticated caller does not match supplied _verifier_id",
  );

  // 2. Attacker attempts to call record_blockchain_failure supplying real verifier's ID
  await assert.rejects(
    async () => {
      await db.exec(`
        SELECT public.record_blockchain_failure(
          '${projectId}', 'Malicious failure signal', '${verifierId}'
        );
      `);
    },
    /Caller identity mismatch: auth.uid does not match verifier_id/,
    "record_blockchain_failure must also bind identity strictly to auth.uid",
  );
});

test("DB Integration: confirm_blockchain_anchor rejects SIMULATED status and enforces genuine on-chain finality", async () => {
  const db = await initTestDatabase();

  const verifierId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const projectId = "dddddddd-dddd-dddd-dddd-dddddddddddd";

  await db.exec(`
    INSERT INTO public.user_roles (user_id, role) VALUES ('${verifierId}', 'verifier');
    INSERT INTO public.projects (id, owner_id, project_code, name, status, estimated_carbon)
    VALUES ('${projectId}', '${verifierId}', 'BC-MNG-SIM', 'Simulation Test', 'VERIFIED_PENDING_ANCHOR', 500);
  `);

  await setSessionContext(db, "authenticated", verifierId);

  // 1. Attempt to promote to VERIFIED with SIMULATED status -> RPC MUST REJECT!
  await assert.rejects(
    async () => {
      await db.exec(`
        SELECT public.confirm_blockchain_anchor(
          '${projectId}', '0x123', '0xsimulated', 0, 'Polygon Amoy', 'SIMULATED', '${verifierId}', 500, '{"simulated": true}'::jsonb
        );
      `);
    },
    /Rejected: Only genuine CONFIRMED blockchain records can promote project to VERIFIED/,
    "Confirmation RPC must strictly reject simulated records from promoting to VERIFIED",
  );

  // 2. Instead, record_simulated_demo_anchor transitions to distinct DEMO_SIMULATED status
  await db.exec(`
    SELECT public.record_simulated_demo_anchor(
      '${projectId}', '0x123', '0xsimulated', '${verifierId}', 500, '{"simulated": true}'::jsonb
    );
  `);

  const projCheck = await db.query(`SELECT status FROM public.projects WHERE id = '${projectId}';`);
  assert.strictEqual(
    projCheck.rows[0].status,
    "DEMO_SIMULATED",
    "Simulated anchoring must transition to DEMO_SIMULATED, never VERIFIED",
  );
});

test("DB Integration: Outbox worker safely claims jobs with lease and increments attempts", async () => {
  const db = await initTestDatabase();

  const verifierId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const projectId = "dddddddd-dddd-dddd-dddd-dddddddddddd";

  await db.exec(`
    INSERT INTO public.user_roles (user_id, role) VALUES ('${verifierId}', 'verifier');
    INSERT INTO public.projects (id, owner_id, project_code, name, status, estimated_carbon)
    VALUES ('${projectId}', '${verifierId}', 'BC-MNG-WORKER', 'Worker Test', 'VERIFIED_PENDING_ANCHOR', 500);
    INSERT INTO public.blockchain_outbox (project_id, payload, status)
    VALUES ('${projectId}', '{"project_code": "BC-MNG-WORKER"}'::jsonb, 'PENDING');
  `);

  await setSessionContext(db, "authenticated", verifierId);

  // Claim job as Worker 1
  const claimRes = await db.query(`
    SELECT * FROM public.claim_next_outbox_job('worker-alpha', 60);
  `);

  assert.strictEqual(claimRes.rows.length, 1);
  assert.strictEqual(claimRes.rows[0].attempts, 1);

  // Worker 2 attempts to claim simultaneously -> SKIP LOCKED ensures 0 rows returned
  const concurrentClaim = await db.query(`
    SELECT * FROM public.claim_next_outbox_job('worker-beta', 60);
  `);
  assert.strictEqual(
    concurrentClaim.rows.length,
    0,
    "Concurrent claim must skip locked leased job",
  );
});

test("DB Integration: Verification reviews and carbon impact records are strictly immutable", async () => {
  const db = await initTestDatabase();

  const verifierId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const ownerId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const projectId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const reviewId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
  const impactId = "ffffffff-ffff-ffff-ffff-ffffffffffff";

  await db.exec(`
    INSERT INTO public.user_roles (user_id, role) VALUES ('${verifierId}', 'verifier');
    INSERT INTO public.user_roles (user_id, role) VALUES ('${ownerId}', 'project_owner');
    INSERT INTO public.projects (id, owner_id, project_code, name, status, estimated_carbon)
    VALUES ('${projectId}', '${ownerId}', 'BC-MNG-IMMUT', 'Immutable Project', 'VERIFIED', 500);

    INSERT INTO public.verification_reviews (id, project_id, verifier_id, verifier_email, decision, comments)
    VALUES ('${reviewId}', '${projectId}', '${verifierId}', 'verifier@test.org', 'APPROVED', 'Initial review');

    INSERT INTO public.carbon_impact_records (id, project_id, verified_tco2e, verified_by, methodology)
    VALUES ('${impactId}', '${projectId}', 500, '${verifierId}', 'IPCC-2019');
  `);

  await setSessionContext(db, "authenticated", ownerId);

  const updateReviewRes = await db.query(`
    UPDATE public.verification_reviews SET comments = 'Tampered review' WHERE id = '${reviewId}';
  `);
  assert.strictEqual(updateReviewRes.affectedRows, 0, "No rows updated on verification_reviews");

  const deleteReviewRes = await db.query(`
    DELETE FROM public.verification_reviews WHERE id = '${reviewId}';
  `);
  assert.strictEqual(deleteReviewRes.affectedRows, 0, "No rows deleted from verification_reviews");

  const updateImpactRes = await db.query(`
    UPDATE public.carbon_impact_records SET verified_tco2e = 999999 WHERE id = '${impactId}';
  `);
  assert.strictEqual(updateImpactRes.affectedRows, 0, "No rows updated on carbon_impact_records");

  const deleteImpactRes = await db.query(`
    DELETE FROM public.carbon_impact_records WHERE id = '${impactId}';
  `);
  assert.strictEqual(deleteImpactRes.affectedRows, 0, "No rows deleted from carbon_impact_records");

  const updateProjRes = await db.query(`
    UPDATE public.projects SET estimated_carbon = 999999 WHERE id = '${projectId}';
  `);
  assert.strictEqual(updateProjRes.affectedRows, 0, "No rows updated on verified project by owner");
});
