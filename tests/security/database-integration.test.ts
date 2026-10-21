import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Database Authorization & RLS Integration Tests running directly against
 * the sequential repository migration files (supabase/migrations/*.sql).
 *
 * Audit Reference:
 * - P1 Automated database tests are proof of a production migration: executes disk migrations.
 * - P1 Retry scheduling needs tighter guarantees: backoff, next_retry_at, max_attempts, expired leases.
 * - P1 Outbox is the actual source of truth: idempotent confirming, safe claiming, and failure recording.
 * - P0 Authorization: Binds verifier identity to auth.uid() in confirm_blockchain_anchor and record_blockchain_failure.
 * - P0 Verification integrity: Rejects simulated anchors in confirm_blockchain_anchor, keeping DEMO_SIMULATED distinct.
 */

async function initTestDatabase() {
  const db = new PGlite();

  // Create baseline Supabase roles & schemas
  await db.exec(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin BYPASSRLS; END IF;
    END $$;
    ALTER ROLE service_role BYPASSRLS;
    ALTER ROLE supabase_auth_admin BYPASSRLS;

    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS storage;
    CREATE SCHEMA IF NOT EXISTS extensions;

    DO $$ BEGIN
      CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
    EXCEPTION WHEN OTHERS THEN
      CREATE OR REPLACE FUNCTION public.digest(msg text, type text) RETURNS bytea
      LANGUAGE sql IMMUTABLE AS $f$
        SELECT decode(md5(msg), 'hex');
      $f$;
    END $$;

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

    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text,
      raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text,
      name text,
      owner uuid,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      last_accessed_at timestamptz DEFAULT now(),
      metadata jsonb DEFAULT '{}'::jsonb
    );

    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

    CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
    LANGUAGE sql IMMUTABLE AS $$
      SELECT string_to_array(name, '/');
    $$;

    CREATE OR REPLACE FUNCTION storage.filename(name text) RETURNS text
    LANGUAGE sql IMMUTABLE AS $$
      SELECT (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)];
    $$;

    CREATE OR REPLACE FUNCTION storage.extension(name text) RETURNS text
    LANGUAGE sql IMMUTABLE AS $$
      SELECT split_part(name, '.', 2);
    $$;
  `);

  // Sequentially execute all SQL migration files in supabase/migrations
  const migrationsDir = path.resolve("./supabase/migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    await db.exec(sql);
  }

  // Grant access on public schema
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
    GRANT SELECT ON public.projects TO anon;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
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

  await setSessionContext(db, "service_role");
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

  await setSessionContext(db, "service_role");
  await db.exec(`
    INSERT INTO public.user_roles (user_id, role) VALUES ('${verifierId}', 'verifier');
    INSERT INTO public.user_roles (user_id, role) VALUES ('${ownerId}', 'project_owner');
    INSERT INTO public.projects (id, owner_id, owner_email, project_code, name, status, estimated_carbon)
    VALUES ('${projectId}', '${ownerId}', 'owner@test.org', 'BC-MNG-INTG', 'Integration Mangrove', 'UNDER_REVIEW', 500);
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

  await setSessionContext(db, "service_role");
  await db.exec(`
    INSERT INTO public.user_roles (user_id, role) VALUES ('${verifierId}', 'verifier');
    INSERT INTO public.user_roles (user_id, role) VALUES ('${attackerId}', 'project_owner');
    INSERT INTO public.projects (id, owner_id, owner_email, project_code, name, status, estimated_carbon)
    VALUES ('${projectId}', '${attackerId}', 'owner@test.org', 'BC-MNG-BIND', 'Identity Binding Test', 'VERIFIED_PENDING_ANCHOR', 500);
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

  await setSessionContext(db, "service_role");
  await db.exec(`
    INSERT INTO public.user_roles (user_id, role) VALUES ('${verifierId}', 'verifier');
    INSERT INTO public.projects (id, owner_id, owner_email, project_code, name, status, estimated_carbon)
    VALUES ('${projectId}', '${verifierId}', 'verifier@test.org', 'BC-MNG-SIM', 'Simulation Test', 'VERIFIED_PENDING_ANCHOR', 500);
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

  await setSessionContext(db, "service_role");
  await db.exec(`
    INSERT INTO public.user_roles (user_id, role) VALUES ('${verifierId}', 'verifier');
    INSERT INTO public.projects (id, owner_id, owner_email, project_code, name, status, estimated_carbon)
    VALUES ('${projectId}', '${verifierId}', 'verifier@test.org', 'BC-MNG-WORKER', 'Worker Test', 'VERIFIED_PENDING_ANCHOR', 500);
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

  await setSessionContext(db, "service_role");
  await db.exec(`
    INSERT INTO public.user_roles (user_id, role) VALUES ('${verifierId}', 'verifier');
    INSERT INTO public.user_roles (user_id, role) VALUES ('${ownerId}', 'project_owner');
    INSERT INTO public.projects (id, owner_id, owner_email, project_code, name, status, estimated_carbon)
    VALUES ('${projectId}', '${ownerId}', 'owner@test.org', 'BC-MNG-IMMUT', 'Immutable Project', 'VERIFIED', 500);

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

test("DB Integration: Tighter retry scheduling prevents manual retry from bypassing scheduled delay", async () => {
  const db = await initTestDatabase();

  const verifierId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const projectId = "dddddddd-dddd-dddd-dddd-dddddddddddd";

  await setSessionContext(db, "service_role");
  await db.exec(`
    INSERT INTO public.user_roles (user_id, role) VALUES ('${verifierId}', 'verifier');
    INSERT INTO public.projects (id, owner_id, owner_email, project_code, name, status, estimated_carbon)
    VALUES ('${projectId}', '${verifierId}', 'verifier@test.org', 'BC-MNG-DELAY', 'Retry Delay Test', 'VERIFIED_PENDING_ANCHOR', 500);

    -- Outbox job with scheduled retry in the future
    INSERT INTO public.blockchain_outbox (project_id, payload, status, next_retry_at, attempts)
    VALUES ('${projectId}', '{"test": 1}'::jsonb, 'PENDING', now() + interval '5 minutes', 1);
  `);

  await setSessionContext(db, "authenticated", verifierId);

  // 1. claim_project_outbox_job MUST NOT claim job while next_retry_at is in the future
  const claimRes = await db.query(`
    SELECT * FROM public.claim_project_outbox_job('${projectId}', 'verifier-manual-retry', 60);
  `);
  assert.strictEqual(
    claimRes.rows.length,
    0,
    "claim_project_outbox_job must respect next_retry_at and reject claims before scheduled backoff",
  );

  // 2. claim_next_outbox_job also ignores this job
  const generalClaimRes = await db.query(`
    SELECT * FROM public.claim_next_outbox_job('worker-1', 60);
  `);
  assert.strictEqual(
    generalClaimRes.rows.length,
    0,
    "claim_next_outbox_job must also respect next_retry_at backoff",
  );
});

test("DB Integration: record_blockchain_failure applies exponential backoff and terminates to FAILED at max attempts", async () => {
  const db = await initTestDatabase();

  const verifierId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const projectId = "dddddddd-dddd-dddd-dddd-dddddddddddd";

  await setSessionContext(db, "service_role");
  await db.exec(`
    INSERT INTO public.user_roles (user_id, role) VALUES ('${verifierId}', 'verifier');
    INSERT INTO public.projects (id, owner_id, owner_email, project_code, name, status, estimated_carbon)
    VALUES ('${projectId}', '${verifierId}', 'verifier@test.org', 'BC-MNG-BACKOFF', 'Exponential Backoff Test', 'VERIFIED_PENDING_ANCHOR', 500);
    INSERT INTO public.blockchain_outbox (project_id, payload, status, attempts)
    VALUES ('${projectId}', '{"test": 1}'::jsonb, 'PENDING', 0);
  `);

  await setSessionContext(db, "authenticated", verifierId);

  // Attempt 1 failure: backoff applied
  await db.query(`
    SELECT public.record_blockchain_failure('${projectId}', 'Network congestion', '${verifierId}', 3);
  `);

  const jobAfter1 = await db.query(
    `SELECT attempts, status, next_retry_at > now() as in_future FROM public.blockchain_outbox WHERE project_id = '${projectId}';`,
  );
  assert.strictEqual(jobAfter1.rows[0].attempts, 1);
  assert.strictEqual(jobAfter1.rows[0].status, "PENDING");
  assert.strictEqual(jobAfter1.rows[0].in_future, true);

  // Fast forward attempts to max attempts (3)
  await db.query(`
    SELECT public.record_blockchain_failure('${projectId}', 'Network congestion 2', '${verifierId}', 3);
  `);
  await db.query(`
    SELECT public.record_blockchain_failure('${projectId}', 'Final gas failure', '${verifierId}', 3);
  `);

  const jobTerminal = await db.query(
    `SELECT attempts, status, next_retry_at FROM public.blockchain_outbox WHERE project_id = '${projectId}';`,
  );
  assert.strictEqual(jobTerminal.rows[0].attempts, 3);
  assert.strictEqual(
    jobTerminal.rows[0].status,
    "FAILED",
    "Job must transition to terminal FAILED status when max attempts are exhausted",
  );
  assert.strictEqual(jobTerminal.rows[0].next_retry_at, null);
});

test("DB Integration: Expired leases can be safely reclaimed after worker crashes", async () => {
  const db = await initTestDatabase();

  const verifierId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const projectId = "dddddddd-dddd-dddd-dddd-dddddddddddd";

  await setSessionContext(db, "service_role");
  await db.exec(`
    INSERT INTO public.user_roles (user_id, role) VALUES ('${verifierId}', 'verifier');
    INSERT INTO public.projects (id, owner_id, owner_email, project_code, name, status, estimated_carbon)
    VALUES ('${projectId}', '${verifierId}', 'verifier@test.org', 'BC-MNG-LEASE', 'Lease Expiry Test', 'VERIFIED_PENDING_ANCHOR', 500);

    -- Job that was locked by crashed worker and lease expired 1 minute ago
    INSERT INTO public.blockchain_outbox (project_id, payload, status, attempts, locked_until, locked_by, next_retry_at)
    VALUES ('${projectId}', '{"test": 1}'::jsonb, 'PENDING', 1, now() - interval '1 minute', 'crashed-worker', now() - interval '2 minutes');
  `);

  await setSessionContext(db, "authenticated", verifierId);

  // Recovery worker claims the job whose lease expired
  const claimRes = await db.query(`
    SELECT * FROM public.claim_next_outbox_job('recovery-worker', 60);
  `);

  assert.strictEqual(claimRes.rows.length, 1);
  assert.strictEqual(claimRes.rows[0].attempts, 2);

  const outboxCheck = await db.query(
    `SELECT locked_by, locked_until > now() as active_lease FROM public.blockchain_outbox WHERE project_id = '${projectId}';`,
  );
  assert.strictEqual(outboxCheck.rows[0].locked_by, "recovery-worker");
  assert.strictEqual(outboxCheck.rows[0].active_lease, true);
});

test("DB Integration: confirm_blockchain_anchor handles duplicate delivery idempotently", async () => {
  const db = await initTestDatabase();

  const verifierId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const projectId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const txHash = "0x" + "a".repeat(64);
  const recordHash = "0x" + "b".repeat(64);

  await setSessionContext(db, "service_role");
  await db.exec(`
    INSERT INTO public.user_roles (user_id, role) VALUES ('${verifierId}', 'verifier');
    INSERT INTO public.projects (id, owner_id, owner_email, project_code, name, status, estimated_carbon)
    VALUES ('${projectId}', '${verifierId}', 'verifier@test.org', 'BC-MNG-IDEMP', 'Idempotency Test', 'VERIFIED_PENDING_ANCHOR', 500);
    INSERT INTO public.blockchain_outbox (project_id, payload, status)
    VALUES ('${projectId}', '{"test": 1}'::jsonb, 'PENDING');
  `);

  await setSessionContext(db, "authenticated", verifierId);

  // First confirmation delivery
  const res1 = await db.query(`
    SELECT public.confirm_blockchain_anchor(
      '${projectId}', '${recordHash}', '${txHash}', 100, 'Polygon Amoy', 'CONFIRMED', '${verifierId}', 500, '{"test": 1}'::jsonb
    ) as result;
  `);

  const r1 = (res1.rows[0] as { result: { status: string } }).result;
  assert.strictEqual(r1.status, "VERIFIED");

  // Duplicate delivery of the same on-chain confirmation
  const res2 = await db.query(`
    SELECT public.confirm_blockchain_anchor(
      '${projectId}', '${recordHash}', '${txHash}', 100, 'Polygon Amoy', 'CONFIRMED', '${verifierId}', 500, '{"test": 1}'::jsonb
    ) as result;
  `);

  const r2 = (res2.rows[0] as { result: { status: string; idempotent?: boolean } }).result;
  assert.strictEqual(r2.status, "VERIFIED");
  assert.strictEqual(r2.idempotent, true, "Duplicate delivery must be flagged as idempotent");

  // Verify only 1 row exists in blockchain_records
  const records = await db.query(
    `SELECT count(*)::int as count FROM public.blockchain_records WHERE project_id = '${projectId}';`,
  );
  assert.strictEqual(records.rows[0].count, 1, "Must never insert duplicate blockchain records");
});

test("DB Integration: complete_outbox_job explicitly marks job complete and clears worker locks", async () => {
  const db = await initTestDatabase();

  const verifierId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const nonVerifierId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const projectId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const jobId = "11111111-2222-3333-4444-555555555555";
  const txHash = "0x" + "c".repeat(64);
  const recordHash = "0x" + "d".repeat(64);

  await setSessionContext(db, "service_role");
  await db.exec(`
    INSERT INTO public.user_roles (user_id, role) VALUES ('${verifierId}', 'verifier');
    INSERT INTO public.user_roles (user_id, role) VALUES ('${nonVerifierId}', 'project_owner');
    INSERT INTO public.projects (id, owner_id, owner_email, project_code, name, status, estimated_carbon)
    VALUES ('${projectId}', '${nonVerifierId}', 'owner@test.org', 'BC-MNG-CLEANUP', 'Cleanup Test', 'VERIFIED', 500);
    INSERT INTO public.blockchain_records (project_id, record_hash, tx_hash, block_number, network, status, verifier_id, verified_tco2e, anchored_payload)
    VALUES ('${projectId}', '${recordHash}', '${txHash}', 1234, 'Polygon Amoy', 'CONFIRMED', '${verifierId}', 500, '{}'::jsonb);
    INSERT INTO public.blockchain_outbox (id, project_id, payload, status, locked_by, locked_until)
    VALUES ('${jobId}', '${projectId}', '{"test": 1}'::jsonb, 'PENDING', 'stale-worker', now() + interval '5 minutes');
  `);

  // 1. Authenticated user (non-service-role) cannot execute complete_outbox_job (permission revoked)
  await setSessionContext(db, "authenticated", nonVerifierId);
  await assert.rejects(async () => {
    await db.query(`SELECT public.complete_outbox_job('${jobId}');`);
  }, /permission denied for function complete_outbox_job/);

  // Verifier without service-role is also blocked from direct RPC completion
  await setSessionContext(db, "authenticated", verifierId);
  await assert.rejects(async () => {
    await db.query(`SELECT public.complete_outbox_job('${jobId}');`);
  }, /permission denied for function complete_outbox_job/);

  // 2. Service-role background worker completes outbox job (cleanup)
  await setSessionContext(db, "service_role");
  await db.query(`SELECT public.complete_outbox_job('${jobId}');`);

  const jobRes = await db.query(`
    SELECT status, locked_by, locked_until, completed_at, tx_hash, record_hash
    FROM public.blockchain_outbox
    WHERE id = '${jobId}';
  `);

  assert.strictEqual(jobRes.rows.length, 1);
  const completedJob = jobRes.rows[0];
  assert.strictEqual(completedJob.status, "CONFIRMED");
  assert.strictEqual(completedJob.locked_by, null);
  assert.strictEqual(completedJob.locked_until, null);
  assert.ok(completedJob.completed_at != null);
  assert.strictEqual(completedJob.tx_hash, txHash);
  assert.strictEqual(completedJob.record_hash, recordHash);

  // 3. Fabricated hash check: service-role attempting to complete with unverified tx_hash fails
  const unverifiedTxHash = "0x" + "f".repeat(64);
  const bogusJobId = "22222222-3333-4444-5555-666666666666";
  await db.exec(`
    INSERT INTO public.blockchain_outbox (id, project_id, payload, status)
    VALUES ('${bogusJobId}', '${projectId}', '{"test": 2}'::jsonb, 'PENDING');
  `);
  await assert.rejects(async () => {
    await db.query(`SELECT public.complete_outbox_job('${bogusJobId}', '${unverifiedTxHash}');`);
  }, /Integrity Error: Cannot complete outbox job with unverified transaction hash/);

  // 4. Mismatched record hash check: supplied record_hash does not match confirmed record
  const mismatchedRecordHash = "0x" + "e".repeat(64);
  await assert.rejects(async () => {
    await db.query(
      `SELECT public.complete_outbox_job('${bogusJobId}', '${txHash}', '${mismatchedRecordHash}');`,
    );
  }, /Integrity Error: Supplied record hash/);

  // 5. Unrelated project check: confirmed txHash from another project is rejected
  const otherProjectId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
  const otherJobId = "33333333-4444-5555-6666-777777777777";
  await db.exec(`
    INSERT INTO public.projects (id, owner_id, owner_email, project_code, name, status, estimated_carbon)
    VALUES ('${otherProjectId}', '${nonVerifierId}', 'owner@test.org', 'BC-MNG-OTHER', 'Other Project', 'VERIFIED_PENDING_ANCHOR', 200);
    INSERT INTO public.blockchain_outbox (id, project_id, payload, status)
    VALUES ('${otherJobId}', '${otherProjectId}', '{"test": 3}'::jsonb, 'PENDING');
  `);
  await assert.rejects(async () => {
    await db.query(`SELECT public.complete_outbox_job('${otherJobId}', '${txHash}');`);
  }, /Integrity Error: Cannot complete outbox job with unverified transaction hash/);
});

test("DB Integration: Durable shared SIWE nonces and KYC cumulative ledger prevent replay and smurfing in PostgreSQL", async () => {
  const db = await initTestDatabase();

  // 1. SIWE: Issue nonce into shared DB table
  const testNonce = "abcdef1234567890abcdef1234567890";
  const boundWallet = "0x1111111111111111111111111111111111111111";
  await db.query(`
    INSERT INTO public.siwe_nonces (nonce, bound_address, expires_at)
    VALUES ('${testNonce}', '${boundWallet}', now() + interval '5 minutes');
  `);

  // 2. First consumption: returns true
  const res1 = await db.query(
    `SELECT public.consume_siwe_nonce('${testNonce}', '${boundWallet}') as ok;`,
  );
  assert.strictEqual(res1.rows[0].ok, true, "First consumption must return true");

  // 3. Second consumption (replay attack): returns false atomically
  const res2 = await db.query(
    `SELECT public.consume_siwe_nonce('${testNonce}', '${boundWallet}') as ok;`,
  );
  assert.strictEqual(
    res2.rows[0].ok,
    false,
    "Second consumption must return false (replay prevented)",
  );

  // 4. Mismatched address consumption: returns false
  const otherNonce = "1234567890abcdef1234567890abcdef";
  await db.query(`
    INSERT INTO public.siwe_nonces (nonce, bound_address, expires_at)
    VALUES ('${otherNonce}', '${boundWallet}', now() + interval '5 minutes');
  `);
  const mismatchRes = await db.query(
    `SELECT public.consume_siwe_nonce('${otherNonce}', '0x2222222222222222222222222222222222222222') as ok;`,
  );
  assert.strictEqual(mismatchRes.rows[0].ok, false, "Mismatched address must return false");

  // 5. KYC Compliance: record transactions in shared DB ledger
  const kycWallet = "0x3333333333333333333333333333333333333333";
  await db.query(
    `SELECT public.record_compliance_transaction('${kycWallet}', 'PURCHASE', 600000);`,
  );
  await db.query(
    `SELECT public.record_compliance_transaction('${kycWallet}', 'TRANSFER', 300000);`,
  );

  // Query cumulative 365-day volume
  const cumRes = await db.query(
    `SELECT public.get_cumulative_annual_volume('${kycWallet}') as vol;`,
  );
  assert.strictEqual(
    BigInt(cumRes.rows[0].vol),
    900000n,
    "Cumulative volume reflects total of 900,000 milli-tCO2e",
  );

  // Old transaction (> 365 days ago) is excluded
  await db.query(`
    INSERT INTO public.kyc_compliance_transactions (wallet_address, action, amount_milli_tco2e, timestamp)
    VALUES (lower('${kycWallet}'), 'PURCHASE', 500000, now() - interval '400 days');
  `);
  const cumAfterOldRes = await db.query(
    `SELECT public.get_cumulative_annual_volume('${kycWallet}') as vol;`,
  );
  assert.strictEqual(
    BigInt(cumAfterOldRes.rows[0].vol),
    900000n,
    "Expired rolling window transaction is excluded",
  );
});
