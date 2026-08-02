-- 1. Storage: ownership-scoped evidence access (path convention: <project_id>/<file>)
DROP POLICY IF EXISTS "evidence read auth" ON storage.objects;
DROP POLICY IF EXISTS "evidence upload" ON storage.objects;

CREATE POLICY "evidence read scoped" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'evidence'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  AND public.project_visible(((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "evidence upload scoped" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'evidence'
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  AND public.owns_project(((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "evidence update scoped" ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'evidence'
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  AND public.owns_project(((storage.foldername(name))[1])::uuid)
)
WITH CHECK (
  bucket_id = 'evidence'
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  AND public.owns_project(((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "evidence delete scoped" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'evidence'
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  AND public.owns_project(((storage.foldername(name))[1])::uuid)
);

-- 2. Notifications: null-project inserts must be self-addressed
DROP POLICY IF EXISTS "notif write" ON public.notifications;
CREATE POLICY "notif write" ON public.notifications FOR INSERT TO authenticated
WITH CHECK (
  (project_id IS NOT NULL AND public.project_visible(project_id))
  OR (
    project_id IS NULL
    AND lower(recipient_email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
  )
);

-- 3. Verification reviews are append-only (explicit deny)
DROP POLICY IF EXISTS "review no update" ON public.verification_reviews;
DROP POLICY IF EXISTS "review no delete" ON public.verification_reviews;
CREATE POLICY "review no update" ON public.verification_reviews FOR UPDATE TO authenticated USING (false);
CREATE POLICY "review no delete" ON public.verification_reviews FOR DELETE TO authenticated USING (false);

-- 4. Restrict EXECUTE on SECURITY DEFINER helpers
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_verifier() FROM anon;
REVOKE EXECUTE ON FUNCTION public.owns_project(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.project_visible(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.next_project_code(public.ecosystem_type) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, authenticated;

-- Public lookups stay callable by everyone
GRANT EXECUTE ON FUNCTION public.get_public_project(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_public_projects() TO anon, authenticated;