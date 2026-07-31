
DROP POLICY "owners update own projects" ON public.projects;
CREATE POLICY "owners update own projects" ON public.projects FOR UPDATE TO authenticated
USING (owner_id = auth.uid() OR lower(owner_email) = lower(coalesce(auth.jwt()->>'email','')) OR (public.is_verifier() AND status <> 'DRAFT'))
WITH CHECK (owner_id = auth.uid() OR lower(owner_email) = lower(coalesce(auth.jwt()->>'email','')) OR public.is_verifier());

DROP POLICY "evidence update" ON public.evidence;
CREATE POLICY "evidence update" ON public.evidence FOR UPDATE TO authenticated
USING (public.project_visible(project_id)) WITH CHECK (public.project_visible(project_id));

DROP POLICY "notif update" ON public.notifications;
CREATE POLICY "notif update" ON public.notifications FOR UPDATE TO authenticated
USING (lower(recipient_email) = lower(coalesce(auth.jwt()->>'email','')))
WITH CHECK (lower(recipient_email) = lower(coalesce(auth.jwt()->>'email','')));

DROP POLICY "notif write" ON public.notifications;
CREATE POLICY "notif write" ON public.notifications FOR INSERT TO authenticated
WITH CHECK (project_id IS NULL OR public.project_visible(project_id));

DROP POLICY "audit write" ON public.audit_logs;
CREATE POLICY "audit write" ON public.audit_logs FOR INSERT TO authenticated
WITH CHECK (project_id IS NULL OR public.project_visible(project_id));
