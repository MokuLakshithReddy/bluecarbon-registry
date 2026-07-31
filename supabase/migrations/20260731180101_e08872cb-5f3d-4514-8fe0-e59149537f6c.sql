
-- ENUMS
CREATE TYPE public.app_role AS ENUM ('project_owner','verifier','admin');
CREATE TYPE public.project_status AS ENUM ('DRAFT','SUBMITTED','UNDER_REVIEW','CORRECTION_REQUIRED','VERIFIED','REJECTED');
CREATE TYPE public.ecosystem_type AS ENUM ('MANGROVE','SEAGRASS','SALT_MARSH','COASTAL_WETLAND','OTHER');

-- UPDATED_AT HELPER
CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

-- PROFILES
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  full_name text,
  organization text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile read" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "own profile write" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE TRIGGER profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- USER ROLES
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_verifier() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'verifier') OR public.has_role(auth.uid(), 'admin');
$$;

-- new user handling
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, organization, phone)
  VALUES (NEW.id, NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'organization',
    NEW.raw_user_meta_data->>'phone')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, COALESCE(NULLIF(NEW.raw_user_meta_data->>'role',''),'project_owner')::public.app_role)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- PROJECTS
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_code text NOT NULL UNIQUE,
  owner_id uuid,
  owner_email text NOT NULL,
  name text NOT NULL,
  organization text,
  description text,
  owner_name text,
  contact_email text,
  contact_phone text,
  ecosystem public.ecosystem_type NOT NULL DEFAULT 'MANGROVE',
  state text,
  district text,
  coastal_area text,
  latitude double precision,
  longitude double precision,
  area_hectares numeric,
  restoration_start date,
  restoration_end date,
  restoration_method text,
  species text,
  plant_count integer,
  survival_rate numeric,
  estimated_carbon numeric,
  verified_carbon numeric,
  notes text,
  status public.project_status NOT NULL DEFAULT 'DRAFT',
  submitted_at timestamptz,
  verified_at timestamptz,
  verifier_id uuid,
  verifier_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER projects_updated BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.owns_project(_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = _project_id
      AND (p.owner_id = auth.uid() OR lower(p.owner_email) = lower(coalesce(auth.jwt()->>'email','')))
  );
$$;

CREATE OR REPLACE FUNCTION public.project_visible(_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.owns_project(_project_id) OR (
    public.is_verifier() AND EXISTS (
      SELECT 1 FROM public.projects p WHERE p.id = _project_id AND p.status <> 'DRAFT')
  );
$$;

CREATE POLICY "owners read own projects" ON public.projects FOR SELECT TO authenticated
USING (owner_id = auth.uid() OR lower(owner_email) = lower(coalesce(auth.jwt()->>'email','')) OR (public.is_verifier() AND status <> 'DRAFT'));
CREATE POLICY "owners insert projects" ON public.projects FOR INSERT TO authenticated
WITH CHECK (owner_id = auth.uid());
CREATE POLICY "owners update own projects" ON public.projects FOR UPDATE TO authenticated
USING (owner_id = auth.uid() OR lower(owner_email) = lower(coalesce(auth.jwt()->>'email','')) OR (public.is_verifier() AND status <> 'DRAFT'))
WITH CHECK (true);
CREATE POLICY "owners delete draft projects" ON public.projects FOR DELETE TO authenticated
USING ((owner_id = auth.uid() OR lower(owner_email) = lower(coalesce(auth.jwt()->>'email',''))) AND status = 'DRAFT');

-- project code generator
CREATE SEQUENCE public.project_code_seq START 1;
CREATE OR REPLACE FUNCTION public.next_project_code(_eco public.ecosystem_type) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prefix text; n int;
BEGIN
  prefix := CASE _eco WHEN 'MANGROVE' THEN 'MNG' WHEN 'SEAGRASS' THEN 'SEA' WHEN 'SALT_MARSH' THEN 'SLT'
    WHEN 'COASTAL_WETLAND' THEN 'WET' ELSE 'OTH' END;
  n := nextval('public.project_code_seq');
  RETURN 'BC-' || prefix || '-' || lpad(n::text, 4, '0');
END; $$;
GRANT EXECUTE ON FUNCTION public.next_project_code(public.ecosystem_type) TO authenticated;

-- EVIDENCE
CREATE TABLE public.evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  evidence_code text,
  file_name text NOT NULL,
  file_url text,
  file_hash text,
  file_size integer,
  evidence_type text NOT NULL DEFAULT 'FIELD_PHOTO',
  latitude double precision,
  longitude double precision,
  capture_date date,
  uploaded_by uuid,
  uploaded_by_email text,
  review_status text NOT NULL DEFAULT 'PENDING',
  reviewer_comment text,
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.evidence TO authenticated;
GRANT ALL ON public.evidence TO service_role;
ALTER TABLE public.evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "evidence read" ON public.evidence FOR SELECT TO authenticated USING (public.project_visible(project_id));
CREATE POLICY "evidence insert" ON public.evidence FOR INSERT TO authenticated WITH CHECK (public.owns_project(project_id));
CREATE POLICY "evidence update" ON public.evidence FOR UPDATE TO authenticated USING (public.project_visible(project_id)) WITH CHECK (true);
CREATE POLICY "evidence delete" ON public.evidence FOR DELETE TO authenticated USING (public.owns_project(project_id));

-- VALIDATION RESULTS
CREATE TABLE public.validation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  score integer NOT NULL DEFAULT 0,
  checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.validation_results TO authenticated;
GRANT ALL ON public.validation_results TO service_role;
ALTER TABLE public.validation_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "validation read" ON public.validation_results FOR SELECT TO authenticated USING (public.project_visible(project_id));
CREATE POLICY "validation write" ON public.validation_results FOR INSERT TO authenticated WITH CHECK (public.project_visible(project_id));

-- AI ASSESSMENTS
CREATE TABLE public.ai_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  risk_level text NOT NULL DEFAULT 'LOW',
  risk_score integer NOT NULL DEFAULT 0,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  engine text NOT NULL DEFAULT 'RULE_BASED',
  summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_assessments TO authenticated;
GRANT ALL ON public.ai_assessments TO service_role;
ALTER TABLE public.ai_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai read" ON public.ai_assessments FOR SELECT TO authenticated USING (public.project_visible(project_id));
CREATE POLICY "ai write" ON public.ai_assessments FOR INSERT TO authenticated WITH CHECK (public.project_visible(project_id));

-- VERIFICATION REVIEWS
CREATE TABLE public.verification_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  verifier_id uuid,
  verifier_email text,
  decision text NOT NULL,
  comments text,
  confirmed_carbon numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.verification_reviews TO authenticated;
GRANT ALL ON public.verification_reviews TO service_role;
ALTER TABLE public.verification_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "review read" ON public.verification_reviews FOR SELECT TO authenticated USING (public.project_visible(project_id));
CREATE POLICY "review write" ON public.verification_reviews FOR INSERT TO authenticated WITH CHECK (public.is_verifier());

-- CARBON IMPACT RECORDS
CREATE TABLE public.carbon_impact_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  estimated_tco2e numeric,
  verified_tco2e numeric,
  methodology text NOT NULL DEFAULT 'DEMONSTRATION_COEFFICIENTS_V1',
  verified_by uuid,
  verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.carbon_impact_records TO authenticated;
GRANT ALL ON public.carbon_impact_records TO service_role;
ALTER TABLE public.carbon_impact_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carbon read" ON public.carbon_impact_records FOR SELECT TO authenticated USING (public.project_visible(project_id));
CREATE POLICY "carbon write" ON public.carbon_impact_records FOR INSERT TO authenticated WITH CHECK (public.is_verifier());

-- BLOCKCHAIN RECORDS
CREATE TABLE public.blockchain_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  record_hash text NOT NULL,
  tx_hash text NOT NULL,
  block_number bigint,
  network text NOT NULL DEFAULT 'Testnet (Simulated)',
  status text NOT NULL DEFAULT 'CONFIRMED',
  anchored_payload jsonb,
  verifier_id uuid,
  verified_tco2e numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.blockchain_records TO authenticated;
GRANT ALL ON public.blockchain_records TO service_role;
ALTER TABLE public.blockchain_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chain read" ON public.blockchain_records FOR SELECT TO authenticated USING (public.project_visible(project_id));
CREATE POLICY "chain write" ON public.blockchain_records FOR INSERT TO authenticated WITH CHECK (public.is_verifier());

-- TIMELINE
CREATE TABLE public.project_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  label text NOT NULL,
  detail text,
  actor_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.project_timeline TO authenticated;
GRANT ALL ON public.project_timeline TO service_role;
ALTER TABLE public.project_timeline ENABLE ROW LEVEL SECURITY;
CREATE POLICY "timeline read" ON public.project_timeline FOR SELECT TO authenticated USING (public.project_visible(project_id));
CREATE POLICY "timeline write" ON public.project_timeline FOR INSERT TO authenticated WITH CHECK (public.project_visible(project_id));

-- AUDIT LOGS
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  project_code text,
  actor_email text,
  action text NOT NULL,
  previous_status text,
  new_status text,
  comments text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit read" ON public.audit_logs FOR SELECT TO authenticated
USING (public.is_verifier() OR (project_id IS NOT NULL AND public.owns_project(project_id)));
CREATE POLICY "audit write" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (true);

-- NOTIFICATIONS
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email text NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif read" ON public.notifications FOR SELECT TO authenticated
USING (lower(recipient_email) = lower(coalesce(auth.jwt()->>'email','')));
CREATE POLICY "notif write" ON public.notifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "notif update" ON public.notifications FOR UPDATE TO authenticated
USING (lower(recipient_email) = lower(coalesce(auth.jwt()->>'email',''))) WITH CHECK (true);

-- PUBLIC READ FUNCTIONS (no PII)
CREATE OR REPLACE FUNCTION public.get_public_project(_code text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'project', to_jsonb(x) - 'contact_email' - 'contact_phone' - 'owner_email' - 'owner_id' - 'notes',
    'blockchain', (SELECT to_jsonb(b) FROM public.blockchain_records b WHERE b.project_id = x.id ORDER BY b.created_at DESC LIMIT 1),
    'timeline', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', t.label, 'detail', t.detail, 'created_at', t.created_at) ORDER BY t.created_at)
                          FROM public.project_timeline t WHERE t.project_id = x.id), '[]'::jsonb),
    'evidence', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'file_name', e.file_name, 'file_url', e.file_url,
                          'evidence_type', e.evidence_type, 'capture_date', e.capture_date, 'latitude', e.latitude, 'longitude', e.longitude) ORDER BY e.created_at)
                          FROM public.evidence e WHERE e.project_id = x.id AND e.is_public), '[]'::jsonb)
  )
  FROM public.projects x WHERE x.project_code = _code AND x.status = 'VERIFIED';
$$;
GRANT EXECUTE ON FUNCTION public.get_public_project(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_public_projects() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'project_code', p.project_code, 'name', p.name, 'organization', p.organization,
    'ecosystem', p.ecosystem, 'state', p.state, 'district', p.district,
    'latitude', p.latitude, 'longitude', p.longitude, 'area_hectares', p.area_hectares,
    'verified_carbon', p.verified_carbon, 'verified_at', p.verified_at, 'status', p.status
  ) ORDER BY p.verified_at DESC NULLS LAST), '[]'::jsonb)
  FROM public.projects p WHERE p.status = 'VERIFIED';
$$;
GRANT EXECUTE ON FUNCTION public.list_public_projects() TO anon, authenticated;

-- DEMO DATA
INSERT INTO public.projects (project_code, owner_email, name, organization, description, owner_name, contact_email, contact_phone,
 ecosystem, state, district, coastal_area, latitude, longitude, area_hectares, restoration_start, restoration_end,
 restoration_method, species, plant_count, survival_rate, estimated_carbon, verified_carbon, status, submitted_at, verified_at, verifier_name) VALUES
('BC-MNG-0001','owner@bluecarbon.demo','Coringa Mangrove Restoration','Coastal Green Foundation','Community-led mangrove replanting across degraded creek banks of the Coringa wildlife sanctuary buffer.','Demo Project Owner','owner@bluecarbon.demo','+91 90000 00001','MANGROVE','Andhra Pradesh','Kakinada','Coringa Creek',16.7550,82.3300,125,'2024-06-01','2025-12-31','Community plantation + hydrological restoration','Avicennia marina, Rhizophora mucronata',180000,88,18420,18420,'VERIFIED','2026-06-12','2026-07-02','NCCR Verifier'),
('BC-MNG-0002','owner@bluecarbon.demo','Sundarbans Fringe Rehabilitation','Delta Livelihood Trust','Restoration of degraded fringe mangroves with village-level nurseries.','Demo Project Owner','owner@bluecarbon.demo','+91 90000 00001','MANGROVE','West Bengal','South 24 Parganas','Gosaba Block',21.9497,88.7900,240,'2024-01-15','2026-03-31','Nursery raised saplings','Sonneratia apetala, Avicennia officinalis',320000,84,31200,31200,'VERIFIED','2026-05-20','2026-06-28','NCCR Verifier'),
('BC-SEA-0003','owner@bluecarbon.demo','Gulf of Mannar Seagrass Recovery','Marine Habitat Society','Seagrass meadow recovery through transplanting and anchor-damage control zones.','Demo Project Owner','owner@bluecarbon.demo','+91 90000 00001','SEAGRASS','Tamil Nadu','Ramanathapuram','Gulf of Mannar',9.2800,79.1200,86,'2024-09-01','2026-06-30','Sprig transplantation','Cymodocea serrulata, Thalassia hemprichii',54000,76,9640,9640,'VERIFIED','2026-04-11','2026-06-05','NCCR Verifier'),
('BC-WET-0004','owner@bluecarbon.demo','Chilika Wetland Carbon Project','Odisha Wetland Alliance','Coastal wetland hydrology restoration and invasive species removal around Chilika lagoon.','Demo Project Owner','owner@bluecarbon.demo','+91 90000 00001','COASTAL_WETLAND','Odisha','Puri','Chilika Lagoon',19.7160,85.3200,310,'2025-02-01','2027-01-31','Hydrological restoration','Mixed halophytes',0,0,24800,NULL,'UNDER_REVIEW','2026-07-14',NULL,NULL),
('BC-MNG-0005','owner@bluecarbon.demo','Bhitarkanika Buffer Plantation','Green Coast Collective','Buffer-zone mangrove plantation with participatory monitoring.','Demo Project Owner','owner@bluecarbon.demo','+91 90000 00001','MANGROVE','Odisha','Kendrapara','Bhitarkanika',20.7100,86.9000,152,'2025-03-10','2027-03-09','Direct seeding + saplings','Heritiera fomes, Excoecaria agallocha',210000,79,15300,NULL,'UNDER_REVIEW','2026-07-18',NULL,NULL),
('BC-SLT-0006','owner@bluecarbon.demo','Gulf of Khambhat Salt Marsh Revival','Saurashtra Coastal Trust','Salt marsh revival on abandoned salt pans with tidal channel reconnection.','Demo Project Owner','owner@bluecarbon.demo','+91 90000 00001','SALT_MARSH','Gujarat','Bharuch','Gulf of Khambhat',21.7500,72.4500,198,'2025-05-01','2027-04-30','Tidal reconnection','Salicornia brachiata, Suaeda maritima',0,0,11750,NULL,'SUBMITTED','2026-07-25',NULL,NULL),
('BC-MNG-0007','owner@bluecarbon.demo','Pichavaram Mangrove Expansion','Tamil Coastal Foundation','Expansion of the Pichavaram mangrove belt with fisher-community stewardship.','Demo Project Owner','owner@bluecarbon.demo','+91 90000 00001','MANGROVE','Tamil Nadu','Cuddalore','Pichavaram',11.4270,79.7900,94,'2025-06-15','2027-06-14','Canal-bank plantation','Rhizophora apiculata',130000,81,9880,NULL,'SUBMITTED','2026-07-28',NULL,NULL),
('BC-WET-0008','owner@bluecarbon.demo','Ashtamudi Wetland Restoration','Kerala Backwater Initiative','Backwater wetland restoration and sediment management.','Demo Project Owner','owner@bluecarbon.demo','+91 90000 00001','COASTAL_WETLAND','Kerala','Kollam','Ashtamudi Lake',8.9500,76.6000,64,'2025-08-01','2027-07-31','Sediment management','Mixed wetland flora',0,0,5200,NULL,'CORRECTION_REQUIRED','2026-07-10',NULL,NULL),
('BC-SEA-0009','owner@bluecarbon.demo','Lakshadweep Seagrass Monitoring','Island Reef Watch','Seagrass monitoring and small-scale restoration around lagoon margins.','Demo Project Owner','owner@bluecarbon.demo','+91 90000 00001','SEAGRASS','Lakshadweep','Kavaratti','Kavaratti Lagoon',10.5600,72.6400,28,'2025-10-01','2027-09-30','Lagoon transplantation','Thalassia hemprichii',18000,68,2100,NULL,'CORRECTION_REQUIRED','2026-07-05',NULL,NULL),
('BC-SLT-0010','owner@bluecarbon.demo','Sindhudurg Salt Marsh Pilot','Konkan Blue Trust','Pilot salt marsh restoration; submission lacked verifiable field evidence.','Demo Project Owner','owner@bluecarbon.demo','+91 90000 00001','SALT_MARSH','Maharashtra','Sindhudurg','Malvan Coast',16.0600,73.4600,41,'2025-11-01','2026-10-31','Manual planting','Salicornia sp.',9000,42,3100,NULL,'REJECTED','2026-06-30',NULL,NULL);

SELECT setval('public.project_code_seq', 10, true);

INSERT INTO public.project_timeline (project_id, label, detail, actor_email, created_at)
SELECT p.id, 'Project Registered', 'Project record created in the registry', p.owner_email, p.created_at FROM public.projects p;
INSERT INTO public.project_timeline (project_id, label, detail, actor_email, created_at)
SELECT p.id, 'Evidence Submitted', 'Field evidence attached to project', p.owner_email, p.submitted_at FROM public.projects p WHERE p.submitted_at IS NOT NULL;
INSERT INTO public.project_timeline (project_id, label, detail, actor_email, created_at)
SELECT p.id, 'Automated Validation Completed', 'Evidence quality score computed', 'system', p.submitted_at + interval '1 hour' FROM public.projects p WHERE p.submitted_at IS NOT NULL;
INSERT INTO public.project_timeline (project_id, label, detail, actor_email, created_at)
SELECT p.id, 'NCCR Review', 'Reviewed by NCCR verifier', 'verifier@nccr.demo', p.verified_at - interval '1 day' FROM public.projects p WHERE p.verified_at IS NOT NULL;
INSERT INTO public.project_timeline (project_id, label, detail, actor_email, created_at)
SELECT p.id, 'Project Verified', 'Verified carbon impact confirmed', 'verifier@nccr.demo', p.verified_at FROM public.projects p WHERE p.verified_at IS NOT NULL;

INSERT INTO public.evidence (project_id, evidence_code, file_name, file_url, evidence_type, latitude, longitude, capture_date, uploaded_by_email, review_status)
SELECT p.id, p.project_code || '-EV' || g, 'field-photo-' || g || '.jpg',
  'https://images.unsplash.com/photo-' || (ARRAY['1441974231531-c6227db76b6e','1500375592092-40eb2168fd21','1502082553048-f009c37129b9','1470071459604-3b5ec3a7fe05'])[g] || '?w=1200&q=70',
  (ARRAY['FIELD_PHOTO','DRONE_IMAGERY','SURVEY_REPORT','FIELD_PHOTO'])[g],
  p.latitude + (g * 0.001), p.longitude + (g * 0.001), p.restoration_start + (g * 15),
  p.owner_email, CASE WHEN p.status = 'VERIFIED' THEN 'VALID' ELSE 'PENDING' END
FROM public.projects p, generate_series(1,4) g WHERE p.status <> 'REJECTED';

INSERT INTO public.carbon_impact_records (project_id, estimated_tco2e, verified_tco2e, verified_at)
SELECT p.id, p.estimated_carbon, p.verified_carbon, p.verified_at FROM public.projects p WHERE p.status = 'VERIFIED';

INSERT INTO public.blockchain_records (project_id, record_hash, tx_hash, block_number, verified_tco2e, anchored_payload)
SELECT p.id, encode(digest(p.project_code || p.name || coalesce(p.verified_carbon,0)::text, 'sha256'),'hex'),
  '0x' || encode(digest(p.project_code || 'tx', 'sha256'),'hex'), 4800000 + (row_number() over ())::bigint * 137,
  p.verified_carbon,
  jsonb_build_object('project_code', p.project_code, 'verified_tco2e', p.verified_carbon, 'verifier','NCCR Verifier')
FROM public.projects p WHERE p.status = 'VERIFIED';

INSERT INTO public.audit_logs (project_id, project_code, actor_email, action, previous_status, new_status, comments)
SELECT p.id, p.project_code, p.owner_email, 'Project submitted', 'DRAFT', 'SUBMITTED', NULL FROM public.projects p WHERE p.submitted_at IS NOT NULL;
INSERT INTO public.audit_logs (project_id, project_code, actor_email, action, previous_status, new_status, comments)
SELECT p.id, p.project_code, 'verifier@nccr.demo', 'Project verified', 'UNDER_REVIEW', 'VERIFIED', 'Evidence and carbon impact confirmed' FROM public.projects p WHERE p.status = 'VERIFIED';
