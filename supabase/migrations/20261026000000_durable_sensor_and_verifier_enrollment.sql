-- ==============================================================================
-- Migration: Durable Sensor Device & Accredited Verifier Trust Registries
-- Audit Reference: Issue 3 — Production Persistence, Authority Validation,
--                  Immutable Audit Logs, Key Revocation & Certificate Expiration
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ENROLLED SENSOR DEVICES TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.enrolled_sensor_devices (
  device_id text PRIMARY KEY,
  signer_address text NOT NULL UNIQUE,
  device_model text NOT NULL,
  manufacturer text NOT NULL,
  project_code text NOT NULL,
  organization text NOT NULL,
  calibration_certificate text NOT NULL,
  calibration_expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED')),
  public_key_hex text,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  enrolled_by uuid REFERENCES auth.users(id),
  revoked_at timestamptz,
  revocation_reason text,
  revoked_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT check_signer_address_lowercase CHECK (signer_address = lower(signer_address))
);

CREATE INDEX IF NOT EXISTS idx_sensor_devices_signer ON public.enrolled_sensor_devices (signer_address);
CREATE INDEX IF NOT EXISTS idx_sensor_devices_project ON public.enrolled_sensor_devices (project_code);
CREATE INDEX IF NOT EXISTS idx_sensor_devices_status ON public.enrolled_sensor_devices (status);

-- ------------------------------------------------------------------------------
-- 2. ENROLLED VERIFIERS TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.enrolled_verifiers (
  verifier_id text PRIMARY KEY,
  organization text NOT NULL,
  accreditation_number text NOT NULL,
  accreditation_expires_at timestamptz NOT NULL,
  authorized_biomes text[] NOT NULL DEFAULT '{}',
  signer_address text UNIQUE,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED')),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  enrolled_by uuid REFERENCES auth.users(id),
  revoked_at timestamptz,
  revocation_reason text,
  revoked_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT check_verifier_id_lowercase CHECK (verifier_id = lower(verifier_id)),
  CONSTRAINT check_verifier_signer_lowercase CHECK (signer_address IS NULL OR signer_address = lower(signer_address))
);

CREATE INDEX IF NOT EXISTS idx_verifiers_status ON public.enrolled_verifiers (status);
CREATE INDEX IF NOT EXISTS idx_verifiers_signer ON public.enrolled_verifiers (signer_address);

-- ------------------------------------------------------------------------------
-- 3. IMMUTABLE ENROLLMENT AUDIT LOG
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.enrollment_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('SENSOR', 'VERIFIER')),
  entity_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('ENROLLED', 'STATUS_CHANGE', 'SUSPENDED', 'REVOKED', 'EXPIRED', 'CERTIFICATE_RENEWED')),
  previous_status text,
  new_status text NOT NULL,
  reason text,
  actor_id uuid REFERENCES auth.users(id),
  actor_role text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enrollment_audit_entity ON public.enrollment_audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_enrollment_audit_created ON public.enrollment_audit_log (created_at DESC);

-- ------------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- ------------------------------------------------------------------------------
ALTER TABLE public.enrolled_sensor_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrolled_verifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollment_audit_log ENABLE ROW LEVEL SECURITY;

-- Sensor devices: Public read to allow anyone to verify telemetry authenticity
DROP POLICY IF EXISTS "public read enrolled_sensor_devices" ON public.enrolled_sensor_devices;
CREATE POLICY "public read enrolled_sensor_devices" ON public.enrolled_sensor_devices
  FOR SELECT TO public
  USING (true);

-- Sensor devices: Only admin or service_role can enroll, update or revoke
DROP POLICY IF EXISTS "admin manage enrolled_sensor_devices" ON public.enrolled_sensor_devices;
CREATE POLICY "admin manage enrolled_sensor_devices" ON public.enrolled_sensor_devices
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role full access to enrolled_sensor_devices" ON public.enrolled_sensor_devices;
CREATE POLICY "service_role full access to enrolled_sensor_devices" ON public.enrolled_sensor_devices
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Verifiers: Public read to allow anyone to verify accredited auditor status
DROP POLICY IF EXISTS "public read enrolled_verifiers" ON public.enrolled_verifiers;
CREATE POLICY "public read enrolled_verifiers" ON public.enrolled_verifiers
  FOR SELECT TO public
  USING (true);

-- Verifiers: Only admin or service_role can enroll or revoke
DROP POLICY IF EXISTS "admin manage enrolled_verifiers" ON public.enrolled_verifiers;
CREATE POLICY "admin manage enrolled_verifiers" ON public.enrolled_verifiers
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role full access to enrolled_verifiers" ON public.enrolled_verifiers;
CREATE POLICY "service_role full access to enrolled_verifiers" ON public.enrolled_verifiers
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Audit Log: Authenticated users can inspect audit records; NO UPDATE OR DELETE ALLOWED
DROP POLICY IF EXISTS "authenticated read enrollment_audit_log" ON public.enrollment_audit_log;
CREATE POLICY "authenticated read enrollment_audit_log" ON public.enrollment_audit_log
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "service_role full access to enrollment_audit_log" ON public.enrollment_audit_log;
CREATE POLICY "service_role full access to enrollment_audit_log" ON public.enrollment_audit_log
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "admin append to enrollment_audit_log" ON public.enrollment_audit_log;
CREATE POLICY "admin append to enrollment_audit_log" ON public.enrollment_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ------------------------------------------------------------------------------
-- 5. AUDIT LOGGING TRIGGERS (IMMUTABILITY & PROVENANCE)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_sensor_device_changes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO public.enrollment_audit_log (
      entity_type, entity_id, action, previous_status, new_status, reason, actor_id, metadata
    ) VALUES (
      'SENSOR',
      NEW.device_id,
      'ENROLLED',
      NULL,
      NEW.status,
      'Initial device enrollment',
      auth.uid(),
      jsonb_build_object(
        'signer_address', NEW.signer_address,
        'project_code', NEW.project_code,
        'calibration_expires_at', NEW.calibration_expires_at
      )
    );
    RETURN NEW;
  ELSIF (TG_OP = 'UPDATE') THEN
    IF (OLD.status IS DISTINCT FROM NEW.status OR OLD.revocation_reason IS DISTINCT FROM NEW.revocation_reason) THEN
      INSERT INTO public.enrollment_audit_log (
        entity_type, entity_id, action, previous_status, new_status, reason, actor_id, metadata
      ) VALUES (
        'SENSOR',
        NEW.device_id,
        CASE 
          WHEN NEW.status = 'REVOKED' THEN 'REVOKED'
          WHEN NEW.status = 'SUSPENDED' THEN 'SUSPENDED'
          ELSE 'STATUS_CHANGE'
        END,
        OLD.status,
        NEW.status,
        NEW.revocation_reason,
        COALESCE(NEW.revoked_by, auth.uid()),
        jsonb_build_object(
          'signer_address', NEW.signer_address,
          'calibration_certificate', NEW.calibration_certificate,
          'calibration_expires_at', NEW.calibration_expires_at
        )
      );
    END IF;
    NEW.updated_at = now();
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_sensor_device_changes ON public.enrolled_sensor_devices;
CREATE TRIGGER trg_audit_sensor_device_changes
  AFTER INSERT OR UPDATE ON public.enrolled_sensor_devices
  FOR EACH ROW EXECUTE FUNCTION public.audit_sensor_device_changes();

CREATE OR REPLACE FUNCTION public.audit_verifier_changes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO public.enrollment_audit_log (
      entity_type, entity_id, action, previous_status, new_status, reason, actor_id, metadata
    ) VALUES (
      'VERIFIER',
      NEW.verifier_id,
      'ENROLLED',
      NULL,
      NEW.status,
      'Initial verifier accreditation enrollment',
      auth.uid(),
      jsonb_build_object(
        'organization', NEW.organization,
        'accreditation_number', NEW.accreditation_number,
        'accreditation_expires_at', NEW.accreditation_expires_at,
        'authorized_biomes', NEW.authorized_biomes
      )
    );
    RETURN NEW;
  ELSIF (TG_OP = 'UPDATE') THEN
    IF (OLD.status IS DISTINCT FROM NEW.status OR OLD.revocation_reason IS DISTINCT FROM NEW.revocation_reason) THEN
      INSERT INTO public.enrollment_audit_log (
        entity_type, entity_id, action, previous_status, new_status, reason, actor_id, metadata
      ) VALUES (
        'VERIFIER',
        NEW.verifier_id,
        CASE 
          WHEN NEW.status = 'REVOKED' THEN 'REVOKED'
          WHEN NEW.status = 'SUSPENDED' THEN 'SUSPENDED'
          ELSE 'STATUS_CHANGE'
        END,
        OLD.status,
        NEW.status,
        NEW.revocation_reason,
        COALESCE(NEW.revoked_by, auth.uid()),
        jsonb_build_object(
          'accreditation_number', NEW.accreditation_number,
          'accreditation_expires_at', NEW.accreditation_expires_at
        )
      );
    END IF;
    NEW.updated_at = now();
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_verifier_changes ON public.enrolled_verifiers;
CREATE TRIGGER trg_audit_verifier_changes
  AFTER INSERT OR UPDATE ON public.enrolled_verifiers
  FOR EACH ROW EXECUTE FUNCTION public.audit_verifier_changes();

-- Enforce audit log strict immutability (no updates or deletes allowed under any circumstances)
CREATE OR REPLACE FUNCTION public.prevent_enrollment_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'enrollment_audit_log entries are strictly immutable and cannot be updated or deleted';
END;
$$;

DROP TRIGGER IF EXISTS trg_immutable_enrollment_audit_log ON public.enrollment_audit_log;
CREATE TRIGGER trg_immutable_enrollment_audit_log
  BEFORE UPDATE OR DELETE ON public.enrollment_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.prevent_enrollment_audit_log_mutation();

-- ------------------------------------------------------------------------------
-- 6. PRE-SEED DEFAULT REFERENCE IDENTITIES
-- ------------------------------------------------------------------------------
INSERT INTO public.enrolled_sensor_devices (
  device_id,
  signer_address,
  device_model,
  manufacturer,
  project_code,
  organization,
  calibration_certificate,
  calibration_expires_at,
  status,
  public_key_hex,
  enrolled_at
) VALUES (
  'YSI-EXO2-LOTHIAN-JETTY-01',
  '0x2e988a386a799f506693793c6a5af6b54dfaabfb',
  'EXO2 Multi-Parameter Water Quality Sonde',
  'YSI / Xylem',
  'PRJ-LOTH-2024',
  'YSI / Xylem Field Services & NCCR Marine Observatories',
  'CAL-YSI-2024-8891-SYNTHETIC',
  '2028-12-31T23:59:59Z',
  'ACTIVE',
  '0x04e90c7d3640a1568839c31b70a893ab6714ef8415b9de90cedfc1c8f353a6983e625529392df7fa514bdd65a2003f6619567d79bee89830e63e932dbd42362d34',
  '2024-11-01T00:00:00Z'
) ON CONFLICT (device_id) DO NOTHING;

INSERT INTO public.enrolled_verifiers (
  verifier_id,
  organization,
  accreditation_number,
  accreditation_expires_at,
  authorized_biomes,
  status,
  enrolled_at
) VALUES (
  'nccr-auditor-dr-das',
  'National Centre for Coastal Research (NCCR) Estuarine Division',
  'VVB-NCCR-IND-2024-001',
  '2028-12-31T23:59:59Z',
  ARRAY['MANGROVE', 'SEAGRASS', 'SALT_MARSH', 'COASTAL_WETLAND'],
  'ACTIVE',
  '2024-01-01T00:00:00Z'
) ON CONFLICT (verifier_id) DO NOTHING;

INSERT INTO public.enrolled_verifiers (
  verifier_id,
  organization,
  accreditation_number,
  accreditation_expires_at,
  authorized_biomes,
  signer_address,
  status,
  enrolled_at
) VALUES (
  '0x2222222222222222222222222222222222222222',
  'Accredited Blue Carbon Validation Body (VVB-001)',
  'VVB-ISO-14064-2024',
  '2028-12-31T23:59:59Z',
  ARRAY['MANGROVE', 'SEAGRASS', 'SALT_MARSH', 'COASTAL_WETLAND'],
  '0x2222222222222222222222222222222222222222',
  'ACTIVE',
  '2024-01-01T00:00:00Z'
) ON CONFLICT (verifier_id) DO NOTHING;
