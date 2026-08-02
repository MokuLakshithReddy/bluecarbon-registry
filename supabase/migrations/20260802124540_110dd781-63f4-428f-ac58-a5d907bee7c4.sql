REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_verifier() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.owns_project(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.project_visible(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.next_project_code(public.ecosystem_type) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_public_project(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_public_projects() FROM PUBLIC;

-- Helpers required by row-level security policies (evaluated as the signed-in role)
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_verifier() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owns_project(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.project_visible(uuid) TO authenticated;

-- Intentionally public verification lookups
GRANT EXECUTE ON FUNCTION public.get_public_project(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_public_projects() TO anon, authenticated;

-- Server-side only
GRANT EXECUTE ON FUNCTION public.next_project_code(public.ecosystem_type) TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO service_role;