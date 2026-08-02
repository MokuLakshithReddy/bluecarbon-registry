-- Community stories -------------------------------------------------------
CREATE TYPE public.community_post_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE public.interest_status AS ENUM ('NEW', 'IN_DISCUSSION', 'CLOSED');

CREATE TABLE public.community_posts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  author_email TEXT,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 160),
  body TEXT CHECK (body IS NULL OR char_length(body) <= 4000),
  media_url TEXT,
  media_type TEXT NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'video')),
  place_name TEXT,
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  status public.community_post_status NOT NULL DEFAULT 'PENDING',
  moderator_note TEXT,
  moderated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  moderated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX community_posts_status_created_idx ON public.community_posts (status, created_at DESC);
CREATE INDEX community_posts_author_idx ON public.community_posts (author_id);

GRANT SELECT ON public.community_posts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_posts TO authenticated;
GRANT ALL ON public.community_posts TO service_role;

ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved community posts are public"
  ON public.community_posts FOR SELECT TO anon, authenticated
  USING (status = 'APPROVED');

CREATE POLICY "Authors can read their own posts"
  ON public.community_posts FOR SELECT TO authenticated
  USING (auth.uid() = author_id);

CREATE POLICY "Verifiers can read all posts"
  ON public.community_posts FOR SELECT TO authenticated
  USING (public.is_verifier() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Signed-in users can submit posts for review"
  ON public.community_posts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = author_id AND status = 'PENDING' AND moderated_by IS NULL AND moderated_at IS NULL);

CREATE POLICY "Authors can edit their pending posts"
  ON public.community_posts FOR UPDATE TO authenticated
  USING (auth.uid() = author_id AND status = 'PENDING')
  WITH CHECK (auth.uid() = author_id AND status = 'PENDING' AND moderated_by IS NULL);

CREATE POLICY "Authors can delete their pending posts"
  ON public.community_posts FOR DELETE TO authenticated
  USING (auth.uid() = author_id AND status = 'PENDING');

CREATE POLICY "Verifiers can moderate posts"
  ON public.community_posts FOR UPDATE TO authenticated
  USING (public.is_verifier() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.is_verifier() OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER community_posts_set_updated_at
  BEFORE UPDATE ON public.community_posts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Marketplace expressions of interest --------------------------------------
CREATE TABLE public.marketplace_interests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  requester_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL CHECK (char_length(btrim(company_name)) BETWEEN 2 AND 160),
  contact_name TEXT NOT NULL CHECK (char_length(btrim(contact_name)) BETWEEN 2 AND 160),
  contact_email TEXT NOT NULL CHECK (contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_phone TEXT CHECK (contact_phone IS NULL OR char_length(contact_phone) <= 32),
  requested_tco2e NUMERIC(14,2) CHECK (requested_tco2e IS NULL OR requested_tco2e > 0),
  intended_use TEXT CHECK (intended_use IS NULL OR char_length(intended_use) <= 160),
  message TEXT CHECK (message IS NULL OR char_length(message) <= 4000),
  status public.interest_status NOT NULL DEFAULT 'NEW',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX marketplace_interests_project_idx ON public.marketplace_interests (project_id);
CREATE INDEX marketplace_interests_requester_idx ON public.marketplace_interests (requester_id);

GRANT SELECT, INSERT, UPDATE ON public.marketplace_interests TO authenticated;
GRANT ALL ON public.marketplace_interests TO service_role;

ALTER TABLE public.marketplace_interests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Requesters can read their own enquiries"
  ON public.marketplace_interests FOR SELECT TO authenticated
  USING (auth.uid() = requester_id);

CREATE POLICY "Project owners can read enquiries for their projects"
  ON public.marketplace_interests FOR SELECT TO authenticated
  USING (public.owns_project(project_id));

CREATE POLICY "Verifiers can read all enquiries"
  ON public.marketplace_interests FOR SELECT TO authenticated
  USING (public.is_verifier() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Signed-in users can submit enquiries for verified projects"
  ON public.marketplace_interests FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = requester_id
    AND status = 'NEW'
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.status = 'VERIFIED'
    )
  );

CREATE POLICY "Verifiers can update enquiry status"
  ON public.marketplace_interests FOR UPDATE TO authenticated
  USING (public.is_verifier() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.is_verifier() OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER marketplace_interests_set_updated_at
  BEFORE UPDATE ON public.marketplace_interests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Private community media bucket policies ----------------------------------
CREATE POLICY "Users can upload community media in their own folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'community' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can read their own community media"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'community' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can update their own community media"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'community' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'community' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete their own community media"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'community' AND (storage.foldername(name))[1] = auth.uid()::text);