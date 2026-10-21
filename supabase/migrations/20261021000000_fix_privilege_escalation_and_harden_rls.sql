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

-- 3. SECURE ROLE MANAGEMENT PROCEDURE (ADMIN ONLY)
CREATE OR REPLACE FUNCTION public.admin_assign_role(
  _target_user_id uuid,
  _new_role public.app_role
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR current_user = 'service_role') THEN
    RAISE EXCEPTION 'Unauthorized: only registry administrators can assign roles.';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_target_user_id, _new_role)
  ON CONFLICT (user_id, role) DO NOTHING;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_assign_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_assign_role(uuid, public.app_role) TO authenticated, service_role;

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
  _expected_status public.project_status
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
    current_user = 'service_role'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Caller % is not an authorized verifier.', _verifier_id;
  END IF;

  -- Ensure caller matches auth.uid() when not service_role
  IF current_user != 'service_role' AND auth.uid() IS DISTINCT FROM _verifier_id THEN
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

    v_new_status := 'VERIFIED';
    v_review_decision := 'APPROVED';
    v_verified_carbon := _confirmed_carbon;
    v_action := 'Project verified';
    v_timeline_label := 'Project Verified';
    v_timeline_detail := format('Verified carbon impact confirmed: %s tCO2e', round(v_verified_carbon, 2));
    v_notify_title := format('Project %s has been verified', v_project.project_code);
    v_notify_body := format('Verified carbon impact: %s tCO2e.', round(v_verified_carbon, 2));

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
