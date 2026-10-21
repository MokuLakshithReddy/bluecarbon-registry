-- ==============================================================================
-- Migration: Fix Privilege Escalation & Harden Authorization Policies
-- Audit Reference: Findings 1, 2, 5 (Security Containment & Data Integrity)
-- ==============================================================================

-- 1. FIX PRIVILEGE ESCALATION IN SIGNUP TRIGGER
-- Users can no longer control or influence their initial role via raw_user_meta_data.
-- Every newly registered user is strictly granted the least-privileged 'project_owner' role.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Insert or sync profile with safe user metadata
  INSERT INTO public.profiles (id, email, full_name, organization, phone)
  VALUES (
    NEW.id,
    NEW.email,
    NULLIF(btrim(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(btrim(NEW.raw_user_meta_data->>'organization'), ''),
    NULLIF(btrim(NEW.raw_user_meta_data->>'phone'), '')
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
    organization = COALESCE(EXCLUDED.organization, profiles.organization),
    phone = COALESCE(EXCLUDED.phone, profiles.phone);

  -- STRICT LEAST-PRIVILEGE ROLE ASSIGNMENT:
  -- Any 'role' field passed in raw_user_meta_data is intentionally and completely ignored.
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'project_owner'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END; $$;

-- 2. HARDEN USER_ROLES RLS POLICIES
-- Only administrators or service_role can assign or modify roles.
DROP POLICY IF EXISTS "read own roles" ON public.user_roles;
CREATE POLICY "read own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admin assign roles" ON public.user_roles;
CREATE POLICY "admin assign roles" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admin update roles" ON public.user_roles;
CREATE POLICY "admin update roles" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admin delete roles" ON public.user_roles;
CREATE POLICY "admin delete roles" ON public.user_roles
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2b. SERVICE ROLE CALLER IDENTIFICATION HELPER
-- In PostgreSQL SECURITY DEFINER functions, current_user becomes the function owner.
-- Checking definer role fails to identify service-role callers.
-- We reliably check session_user, request.jwt.claim.role, and auth.jwt()->>'role'.
CREATE OR REPLACE FUNCTION public.is_service_role() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (
    session_user = 'service_role' OR
    coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' OR
    coalesce(auth.jwt()->>'role', '') = 'service_role'
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_service_role() TO authenticated, service_role, anon;
DO $$ BEGIN
  GRANT USAGE ON SCHEMA auth TO authenticated, service_role, anon;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 3. SECURE ROLE MANAGEMENT PROCEDURE (ADMIN ONLY)
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

REVOKE EXECUTE ON FUNCTION public.admin_assign_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_assign_role(uuid, public.app_role) TO authenticated, service_role;

-- 3b. STATE MACHINE EXTENSION & DURABLE BLOCKCHAIN OUTBOX
DO $$
BEGIN
  ALTER TYPE public.project_status ADD VALUE IF NOT EXISTS 'VERIFIED_PENDING_ANCHOR' BEFORE 'VERIFIED';
  ALTER TYPE public.project_status ADD VALUE IF NOT EXISTS 'DEMO_SIMULATED';
  CREATE TYPE public.review_decision AS ENUM ('APPROVED', 'CORRECTION_REQUESTED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS public.blockchain_outbox (
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
  next_retry_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.blockchain_outbox ALTER COLUMN next_retry_at DROP NOT NULL;
ALTER TABLE public.blockchain_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "outbox verifier read" ON public.blockchain_outbox;
CREATE POLICY "outbox verifier read" ON public.blockchain_outbox FOR SELECT TO authenticated USING (public.is_verifier() OR public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "outbox service all" ON public.blockchain_outbox;
CREATE POLICY "outbox service all" ON public.blockchain_outbox FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT ON public.blockchain_outbox TO authenticated;
GRANT ALL ON public.blockchain_outbox TO service_role;

-- 4. ATOMIC VERIFICATION DECISION TRANSACTION
-- Guarantees atomic updates across projects, verification reviews, carbon impact records,
-- audit logs, timeline and notifications. Enforces strict state machine transitions and concurrency protection.
CREATE OR REPLACE FUNCTION public.perform_verification_decision(
  _project_id uuid,
  _decision text,                 -- 'APPROVE', 'REQUEST_CORRECTION', 'REJECT'
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
  v_verified_carbon numeric;
  v_now timestamptz := now();
  v_action text;
  v_timeline_label text;
  v_timeline_detail text;
  v_notify_title text;
  v_notify_body text;
  v_review_decision public.review_decision;
BEGIN
  -- A. Verify caller authorization
  IF NOT (
    public.has_role(_verifier_id, 'verifier') OR
    public.has_role(_verifier_id, 'admin') OR
    public.is_service_role()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Caller % is not an authorized verifier.', _verifier_id;
  END IF;

  -- Ensure caller matches auth.uid() when not service_role
  IF NOT public.is_service_role() AND auth.uid() IS DISTINCT FROM _verifier_id THEN
    RAISE EXCEPTION 'Caller identity mismatch: auth.uid does not match verifier_id.';
  END IF;

  -- B. Concurrency check: lock row for update and verify current status
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

  -- C. Validate state transitions and prepare decision payloads
  IF _decision = 'APPROVE' THEN
    IF v_project.status != 'UNDER_REVIEW' THEN
      RAISE EXCEPTION 'Invalid transition: Project must be UNDER_REVIEW before approval (current: %).', v_project.status;
    END IF;

    IF _confirmed_carbon IS NULL OR _confirmed_carbon <= 0 THEN
      RAISE EXCEPTION 'Invalid carbon value: Confirmed carbon must be a positive number.';
    END IF;

    v_new_status := 'VERIFIED_PENDING_ANCHOR';
    v_review_decision := 'APPROVED';
    v_verified_carbon := _confirmed_carbon;
    v_action := 'Project verified (pending anchor)';
    v_timeline_label := 'Verification Decision Approved';
    v_timeline_detail := format('Verification confirmed (%s tCO2e). Queued for durable on-chain anchor.', round(v_verified_carbon, 2));
    v_notify_title := format('Project %s verification approved', v_project.project_code);
    v_notify_body := format('Verified carbon impact: %s tCO2e. Queued for blockchain anchoring.', round(v_verified_carbon, 2));

    -- Enqueue durable blockchain anchoring outbox record (storing canonical payload as source of truth)
    INSERT INTO public.blockchain_outbox (project_id, payload, status)
    VALUES (
      v_project.id,
      COALESCE(
        _anchor_payload,
        jsonb_build_object(
          'project_code', v_project.project_code,
          'verified_carbon', v_verified_carbon,
          'verifier_id', _verifier_id,
          'verifier_email', _verifier_email,
          'comments', _comments
        )
      ),
      'PENDING'
    );

  ELSIF _decision = 'REQUEST_CORRECTION' THEN
    IF v_project.status != 'UNDER_REVIEW' THEN
      RAISE EXCEPTION 'Invalid transition: Project must be UNDER_REVIEW before requesting correction (current: %).', v_project.status;
    END IF;

    IF _comments IS NULL OR btrim(_comments) = '' THEN
      RAISE EXCEPTION 'Verifier comments are strictly required when requesting correction.';
    END IF;

    v_new_status := 'CORRECTION_REQUIRED';
    v_review_decision := 'CORRECTION_REQUESTED';
    v_verified_carbon := NULL;
    v_action := 'Correction requested';
    v_timeline_label := 'Correction Requested';
    v_timeline_detail := _comments;
    v_notify_title := format('Correction required for %s', v_project.project_code);
    v_notify_body := _comments;

  ELSIF _decision = 'REJECT' THEN
    IF v_project.status != 'UNDER_REVIEW' AND v_project.status != 'SUBMITTED' THEN
      RAISE EXCEPTION 'Invalid transition: Project must be UNDER_REVIEW or SUBMITTED before rejection (current: %).', v_project.status;
    END IF;

    IF _comments IS NULL OR btrim(_comments) = '' THEN
      RAISE EXCEPTION 'Verifier comments are strictly required when rejecting a project.';
    END IF;

    v_new_status := 'REJECTED';
    v_review_decision := 'REJECTED';
    v_verified_carbon := NULL;
    v_action := 'Project rejected';
    v_timeline_label := 'Project Rejected';
    v_timeline_detail := _comments;
    v_notify_title := format('Project %s was rejected', v_project.project_code);
    v_notify_body := _comments;

  ELSE
    RAISE EXCEPTION 'Unknown verification decision: %', _decision;
  END IF;

  -- D. Atomic updates across all registry tables
  -- 1. Update Project
  UPDATE public.projects
  SET
    status = v_new_status,
    verified_carbon = COALESCE(v_verified_carbon, verified_carbon),
    verified_at = CASE WHEN v_new_status = 'VERIFIED' THEN v_now ELSE verified_at END,
    verifier_id = _verifier_id,
    verifier_name = _verifier_email,
    updated_at = v_now
  WHERE id = _project_id;

  -- 2. Insert Verification Review (append-only)
  INSERT INTO public.verification_reviews (
    project_id,
    verifier_id,
    verifier_email,
    decision,
    comments,
    confirmed_carbon,
    created_at
  )
  VALUES (
    _project_id,
    _verifier_id,
    _verifier_email,
    v_review_decision,
    _comments,
    v_verified_carbon,
    v_now
  );

  -- 3. Insert Carbon Impact Record if verified
  IF v_new_status = 'VERIFIED' THEN
    INSERT INTO public.carbon_impact_records (
      project_id,
      estimated_tco2e,
      verified_tco2e,
      verified_by,
      verified_at
    )
    VALUES (
      _project_id,
      v_project.estimated_carbon,
      v_verified_carbon,
      _verifier_id,
      v_now
    );
  END IF;

  -- 4. Durable Audit Log
  INSERT INTO public.audit_logs (
    project_id,
    project_code,
    actor_email,
    action,
    previous_status,
    new_status,
    comments,
    created_at
  )
  VALUES (
    _project_id,
    v_project.project_code,
    _verifier_email,
    v_action,
    v_project.status::text,
    v_new_status::text,
    _comments,
    v_now
  );

  -- 5. Project Timeline
  INSERT INTO public.project_timeline (
    project_id,
    label,
    detail,
    actor_email,
    created_at
  )
  VALUES (
    _project_id,
    v_timeline_label,
    v_timeline_detail,
    _verifier_email,
    v_now
  );

  -- 6. Notification to Owner
  IF v_project.owner_email IS NOT NULL AND v_notify_title IS NOT NULL THEN
    INSERT INTO public.notifications (
      recipient_email,
      project_id,
      title,
      body,
      created_at
    )
    VALUES (
      v_project.owner_email,
      _project_id,
      v_notify_title,
      v_notify_body,
      v_now
    );
  END IF;

  RETURN jsonb_build_object(
    'status', v_new_status,
    'verified_carbon', v_verified_carbon,
    'verified_at', v_now,
    'project_code', v_project.project_code
  );
END; $$;

REVOKE EXECUTE ON FUNCTION public.perform_verification_decision FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.perform_verification_decision TO authenticated, service_role;

-- 4b. CONFIRM ON-CHAIN ANCHOR PROCEDURE (WITH IDEMPOTENCY)
-- Promotes project from VERIFIED_PENDING_ANCHOR to VERIFIED upon genuine blockchain confirmation.
-- Strictly requires genuine CONFIRMED status from real EVM provider.
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
  v_now timestamptz := now();
BEGIN
  -- 1. STRICT AUTHORIZATION & IDENTITY BINDING
  IF NOT (
    public.has_role(_verifier_id, 'verifier') OR
    public.has_role(_verifier_id, 'admin') OR
    public.is_service_role()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an authorized verifier.';
  END IF;

  -- Ensure authenticated caller matches _verifier_id (prevents supplying another verifier's UUID)
  IF NOT public.is_service_role() AND auth.uid() IS DISTINCT FROM _verifier_id THEN
    RAISE EXCEPTION 'Caller identity mismatch: auth.uid does not match verifier_id.';
  END IF;

  -- 2. REJECT SIMULATED OR NON-CONFIRMED ANCHORS
  -- Only genuine CONFIRMED on-chain transactions qualify for VERIFIED state
  IF _status != 'CONFIRMED' THEN
    RAISE EXCEPTION 'Rejected: Only genuine CONFIRMED blockchain records can promote project to VERIFIED. Status "%" cannot be confirmed as on-chain finality.', _status;
  END IF;

  -- 3. Lock project row
  SELECT * INTO v_project
  FROM public.projects
  WHERE id = _project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found: %', _project_id;
  END IF;

  -- IDEMPOTENCY: If project is already VERIFIED and record already exists for this tx, return success cleanly
  IF v_project.status = 'VERIFIED' THEN
    IF EXISTS (SELECT 1 FROM public.blockchain_records WHERE project_id = _project_id AND tx_hash = _tx_hash) THEN
      UPDATE public.blockchain_outbox
      SET
        status = 'CONFIRMED',
        record_hash = _record_hash,
        tx_hash = _tx_hash,
        locked_until = NULL,
        locked_by = NULL,
        completed_at = COALESCE(completed_at, v_now),
        updated_at = v_now
      WHERE project_id = _project_id AND status = 'PENDING';

      RETURN jsonb_build_object(
        'project_id', _project_id,
        'status', 'VERIFIED',
        'tx_hash', _tx_hash,
        'record_hash', _record_hash,
        'idempotent', true
      );
    END IF;
  END IF;

  IF v_project.status != 'VERIFIED_PENDING_ANCHOR' AND v_project.status != 'VERIFIED' THEN
    RAISE EXCEPTION 'Invalid transition: Project % is in state %, expected VERIFIED_PENDING_ANCHOR.', v_project.project_code, v_project.status;
  END IF;

  -- 4. Insert into blockchain_records
  INSERT INTO public.blockchain_records (
    project_id,
    record_hash,
    tx_hash,
    block_number,
    network,
    status,
    verifier_id,
    verified_tco2e,
    anchored_payload,
    created_at
  ) VALUES (
    _project_id,
    _record_hash,
    _tx_hash,
    _block_number,
    _network,
    'CONFIRMED',
    _verifier_id,
    _verified_tco2e,
    _anchored_payload,
    v_now
  );

  -- 5. Update project status to VERIFIED
  UPDATE public.projects
  SET
    status = 'VERIFIED',
    verified_carbon = _verified_tco2e,
    updated_at = v_now
  WHERE id = _project_id;

  -- 6. Update outbox record to CONFIRMED
  UPDATE public.blockchain_outbox
  SET
    status = 'CONFIRMED',
    record_hash = _record_hash,
    tx_hash = _tx_hash,
    locked_until = NULL,
    locked_by = NULL,
    completed_at = v_now,
    updated_at = v_now
  WHERE project_id = _project_id AND status = 'PENDING';

  -- 7. Add timeline entry
  INSERT INTO public.project_timeline (
    project_id,
    label,
    detail,
    actor_email,
    created_at
  ) VALUES (
    _project_id,
    'On-Chain Anchoring Confirmed',
    format('Record anchored on %s (tx: %s, block: %s).', _network, substring(_tx_hash from 1 for 10) || '...', coalesce(_block_number::text, 'pending')),
    'system',
    v_now
  );

  RETURN jsonb_build_object(
    'project_id', _project_id,
    'status', 'VERIFIED',
    'tx_hash', _tx_hash,
    'record_hash', _record_hash
  );
END; $$;

REVOKE EXECUTE ON FUNCTION public.confirm_blockchain_anchor FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_blockchain_anchor TO authenticated, service_role;

-- 4b-ii. EXPONENTIAL BACKOFF CALCULATION HELPER
CREATE OR REPLACE FUNCTION public.calculate_retry_backoff(
  _attempts int,
  _base_seconds int DEFAULT 30,
  _max_seconds int DEFAULT 3600
)
RETURNS interval
LANGUAGE sql
IMMUTABLE AS $$
  SELECT (LEAST(_base_seconds * (1 << LEAST(GREATEST(_attempts, 1) - 1, 10)), _max_seconds) || ' seconds')::interval;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_retry_backoff TO authenticated, service_role;

-- 4c. RECORD BLOCKCHAIN FAILURE PROCEDURE (PRESERVES RETRY STATE, EXPONENTIAL BACKOFF & IDENTITY BINDING)
CREATE OR REPLACE FUNCTION public.record_blockchain_failure(
  _project_id uuid,
  _error_message text,
  _verifier_id uuid,
  _max_attempts int DEFAULT 5
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now timestamptz := now();
  v_job public.blockchain_outbox%ROWTYPE;
  v_project public.projects%ROWTYPE;
  v_new_attempts int := 1;
  v_new_status text := 'PENDING';
  v_backoff interval;
BEGIN
  -- Strict caller authorization
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

  SELECT * INTO v_project FROM public.projects WHERE id = _project_id;

  SELECT * INTO v_job
  FROM public.blockchain_outbox
  WHERE project_id = _project_id
    AND status = 'PENDING'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_new_attempts := v_job.attempts + 1;
    IF v_new_attempts >= _max_attempts THEN
      v_new_status := 'FAILED';
    ELSE
      v_new_status := 'PENDING';
    END IF;

    v_backoff := public.calculate_retry_backoff(v_new_attempts, 30, 3600);

    UPDATE public.blockchain_outbox
    SET
      attempts = v_new_attempts,
      status = v_new_status,
      last_error = _error_message,
      locked_until = NULL,
      locked_by = NULL,
      next_retry_at = CASE WHEN v_new_status = 'FAILED' THEN NULL ELSE v_now + v_backoff END,
      updated_at = v_now
    WHERE id = v_job.id;
  END IF;

  INSERT INTO public.audit_logs (
    project_id,
    project_code,
    actor_email,
    action,
    previous_status,
    new_status,
    comments,
    created_at
  ) VALUES (
    _project_id,
    v_project.project_code,
    COALESCE(
      (SELECT email FROM public.profiles WHERE id = _verifier_id),
      coalesce(auth.jwt()->>'email', 'verifier')
    ),
    'BLOCKCHAIN_ANCHOR_FAILED',
    v_project.status::text,
    v_project.status::text,
    format('Blockchain anchor attempt %s failed: %s (Status: %s)', v_new_attempts, _error_message, v_new_status),
    v_now
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', v_new_status,
    'attempts', v_new_attempts
  );
END; $$;

REVOKE EXECUTE ON FUNCTION public.record_blockchain_failure FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_blockchain_failure TO authenticated, service_role;

-- 4d. RECORD SIMULATED DEMO ANCHOR (DEMO MODE ONLY)
-- Explicitly transitions project to distinct DEMO_SIMULATED status (never production VERIFIED).
CREATE OR REPLACE FUNCTION public.record_simulated_demo_anchor(
  _project_id uuid,
  _record_hash text,
  _tx_hash text,
  _verifier_id uuid,
  _verified_tco2e numeric,
  _anchored_payload jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_project public.projects%ROWTYPE;
  v_now timestamptz := now();
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

  SELECT * INTO v_project FROM public.projects WHERE id = _project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found: %', _project_id;
  END IF;

  -- Idempotency check for demo simulation
  IF v_project.status = 'DEMO_SIMULATED' THEN
    IF EXISTS (SELECT 1 FROM public.blockchain_records WHERE project_id = _project_id AND tx_hash = _tx_hash) THEN
      RETURN jsonb_build_object('project_id', _project_id, 'status', 'DEMO_SIMULATED', 'simulated', true, 'idempotent', true);
    END IF;
  END IF;

  INSERT INTO public.blockchain_records (
    project_id,
    record_hash,
    tx_hash,
    block_number,
    network,
    status,
    verifier_id,
    verified_tco2e,
    anchored_payload,
    created_at
  ) VALUES (
    _project_id,
    _record_hash,
    _tx_hash,
    0,
    'Simulated Testnet Demo',
    'SIMULATED',
    _verifier_id,
    _verified_tco2e,
    _anchored_payload,
    v_now
  );

  -- Transition project to distinct DEMO_SIMULATED status (strictly distinct from VERIFIED)
  UPDATE public.projects
  SET
    status = 'DEMO_SIMULATED',
    verified_carbon = _verified_tco2e,
    updated_at = v_now
  WHERE id = _project_id;

  UPDATE public.blockchain_outbox
  SET
    status = 'SIMULATED',
    record_hash = _record_hash,
    tx_hash = _tx_hash,
    locked_until = NULL,
    locked_by = NULL,
    completed_at = v_now,
    updated_at = v_now
  WHERE project_id = _project_id AND status = 'PENDING';

  INSERT INTO public.project_timeline (
    project_id,
    label,
    detail,
    actor_email,
    created_at
  ) VALUES (
    _project_id,
    'Simulated Demo Record (Unverified On-Chain)',
    'Project evaluated in simulated demo mode. No genuine on-chain transaction was submitted.',
    'system',
    v_now
  );

  RETURN jsonb_build_object(
    'project_id', _project_id,
    'status', 'DEMO_SIMULATED',
    'simulated', true
  );
END; $$;

REVOKE EXECUTE ON FUNCTION public.record_simulated_demo_anchor FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_simulated_demo_anchor TO authenticated, service_role;

-- 4e. OUTBOX WORKER LEASING & JOB MANAGEMENT WITH UNIFIED RETRY POLICY
CREATE OR REPLACE FUNCTION public.claim_next_outbox_job(
  _worker_id text,
  _lease_seconds int DEFAULT 60,
  _max_attempts int DEFAULT 5
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
    AND (public.blockchain_outbox.next_retry_at IS NULL OR public.blockchain_outbox.next_retry_at <= now())
    AND public.blockchain_outbox.attempts < _max_attempts
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

GRANT EXECUTE ON FUNCTION public.claim_next_outbox_job TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_project_outbox_job(
  _project_id uuid,
  _worker_id text,
  _lease_seconds int DEFAULT 60,
  _max_attempts int DEFAULT 5,
  _force_retry_failed boolean DEFAULT false
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

  -- Optional admin/verifier reset of a terminally FAILED job
  IF _force_retry_failed THEN
    UPDATE public.blockchain_outbox
    SET
      status = 'PENDING',
      attempts = 0,
      next_retry_at = now(),
      locked_until = NULL,
      locked_by = NULL,
      updated_at = now()
    WHERE public.blockchain_outbox.project_id = _project_id
      AND public.blockchain_outbox.status = 'FAILED';
  END IF;

  -- UNIFIED ELIGIBILITY RULES: Identical to claim_next_outbox_job
  SELECT * INTO v_job
  FROM public.blockchain_outbox
  WHERE public.blockchain_outbox.project_id = _project_id
    AND public.blockchain_outbox.status = 'PENDING'
    AND (public.blockchain_outbox.locked_until IS NULL OR public.blockchain_outbox.locked_until < now())
    AND (public.blockchain_outbox.next_retry_at IS NULL OR public.blockchain_outbox.next_retry_at <= now())
    AND public.blockchain_outbox.attempts < _max_attempts
  ORDER BY public.blockchain_outbox.created_at DESC
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
    SELECT v_job.id, v_job.project_id, v_job.payload, 'PENDING'::text, v_job.attempts + 1;
  END IF;

  RETURN;
END; $$;

GRANT EXECUTE ON FUNCTION public.claim_project_outbox_job TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fail_outbox_job(
  _job_id uuid,
  _error_message text,
  _base_delay_seconds int DEFAULT 30,
  _max_attempts int DEFAULT 5
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_job public.blockchain_outbox%ROWTYPE;
  v_backoff interval;
BEGIN
  IF NOT (public.is_verifier() OR public.has_role(auth.uid(), 'admin') OR public.is_service_role()) THEN
    RAISE EXCEPTION 'Unauthorized: Only verifiers or service-role can update outbox jobs.';
  END IF;

  SELECT * INTO v_job FROM public.blockchain_outbox WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Outbox job not found: %', _job_id;
  END IF;

  IF v_job.attempts >= _max_attempts THEN
    UPDATE public.blockchain_outbox
    SET
      status = 'FAILED',
      locked_until = NULL,
      locked_by = NULL,
      next_retry_at = NULL,
      last_error = _error_message,
      updated_at = now()
    WHERE id = _job_id;
  ELSE
    v_backoff := public.calculate_retry_backoff(v_job.attempts, _base_delay_seconds, 3600);
    UPDATE public.blockchain_outbox
    SET
      status = 'PENDING',
      locked_until = NULL,
      locked_by = NULL,
      next_retry_at = now() + v_backoff,
      last_error = _error_message,
      updated_at = now()
    WHERE id = _job_id;
  END IF;
END; $$;

GRANT EXECUTE ON FUNCTION public.fail_outbox_job TO authenticated, service_role;

-- 4f. COMPLETE OUTBOX JOB (STRICT SERVICE-ROLE BOUNDARY & RECORD VERIFICATION)
-- Prevents privileged or unauthenticated callers from fabricating blockchain confirmations.
-- Must be invoked by service-role, and if tx_hash is provided, it must match an existing verified blockchain_record.
CREATE OR REPLACE FUNCTION public.complete_outbox_job(
  _job_id uuid,
  _tx_hash text DEFAULT NULL,
  _record_hash text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_job public.blockchain_outbox%ROWTYPE;
  v_rec public.blockchain_records%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  -- Strict boundary: Only service-role (the background worker) or admin may complete outbox jobs
  IF NOT (public.is_service_role() OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Unauthorized: Only service-role background worker can complete outbox jobs.';
  END IF;

  SELECT * INTO v_job FROM public.blockchain_outbox WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Outbox job not found: %', _job_id;
  END IF;

  -- Validate that confirmation corresponds to a genuine existing blockchain_records entry
  IF _tx_hash IS NOT NULL THEN
    SELECT * INTO v_rec FROM public.blockchain_records
    WHERE project_id = v_job.project_id AND tx_hash = _tx_hash AND status = 'CONFIRMED'
    LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Integrity Error: Cannot complete outbox job with unverified transaction hash %', _tx_hash;
    END IF;
  ELSE
    SELECT * INTO v_rec FROM public.blockchain_records
    WHERE project_id = v_job.project_id AND status = 'CONFIRMED'
    ORDER BY created_at DESC LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Integrity Error: No confirmed blockchain record found for project %', v_job.project_id;
    END IF;
    _tx_hash := v_rec.tx_hash;
    _record_hash := v_rec.record_hash;
  END IF;

  UPDATE public.blockchain_outbox
  SET
    status = 'CONFIRMED',
    tx_hash = _tx_hash,
    record_hash = COALESCE(_record_hash, v_rec.record_hash),
    locked_until = NULL,
    locked_by = NULL,
    completed_at = COALESCE(completed_at, v_now),
    updated_at = v_now
  WHERE id = _job_id;
END; $$;

REVOKE EXECUTE ON FUNCTION public.complete_outbox_job FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_outbox_job FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_outbox_job TO service_role;

-- 5. HARDEN PROJECTS RLS: PREVENT MODIFICATION OF VERIFIED PROJECTS BY OWNERS
-- Project owners may only update their projects while in 'DRAFT' or 'CORRECTION_REQUIRED' status.
-- Once SUBMITTED, UNDER_REVIEW, VERIFIED, or REJECTED, owners cannot alter the project record.
DROP POLICY IF EXISTS "owners update own projects" ON public.projects;
CREATE POLICY "owners update own projects" ON public.projects FOR UPDATE TO authenticated
  USING (
    (
      (owner_id = auth.uid() OR lower(owner_email) = lower(coalesce(auth.jwt()->>'email','')))
      AND status IN ('DRAFT', 'CORRECTION_REQUIRED')
    )
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    (
      (owner_id = auth.uid() OR lower(owner_email) = lower(coalesce(auth.jwt()->>'email','')))
      AND status IN ('DRAFT', 'CORRECTION_REQUIRED', 'SUBMITTED')
    )
    OR public.has_role(auth.uid(), 'admin')
  );

-- 6. IMMUTABILITY OF VERIFICATION AND CARBON IMPACT RECORDS
DROP POLICY IF EXISTS "review no update" ON public.verification_reviews;
CREATE POLICY "review no update" ON public.verification_reviews FOR UPDATE TO authenticated USING (false);

DROP POLICY IF EXISTS "review no delete" ON public.verification_reviews;
CREATE POLICY "review no delete" ON public.verification_reviews FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS "carbon impact no update" ON public.carbon_impact_records;
CREATE POLICY "carbon impact no update" ON public.carbon_impact_records FOR UPDATE TO authenticated USING (false);

DROP POLICY IF EXISTS "carbon impact no delete" ON public.carbon_impact_records;
CREATE POLICY "carbon impact no delete" ON public.carbon_impact_records FOR DELETE TO authenticated USING (false);

