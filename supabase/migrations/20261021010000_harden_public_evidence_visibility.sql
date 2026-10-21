-- Enforce fail-closed public evidence visibility in get_public_project RPC
CREATE OR REPLACE FUNCTION public.get_public_project(_code text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'project', to_jsonb(x) - 'contact_email' - 'contact_phone' - 'owner_email' - 'owner_id' - 'notes',
    'blockchain', (SELECT to_jsonb(b) FROM public.blockchain_records b WHERE b.project_id = x.id ORDER BY b.created_at DESC LIMIT 1),
    'timeline', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', t.label, 'detail', t.detail, 'created_at', t.created_at) ORDER BY t.created_at)
                          FROM public.project_timeline t WHERE t.project_id = x.id), '[]'::jsonb),
    'evidence', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                            'id', e.id,
                            'file_name', e.file_name,
                            'file_url', e.file_url,
                            'evidence_type', e.evidence_type,
                            'capture_date', e.capture_date,
                            'latitude', e.latitude,
                            'longitude', e.longitude,
                            'is_public', e.is_public
                          ) ORDER BY e.created_at)
                          FROM public.evidence e WHERE e.project_id = x.id AND e.is_public IS TRUE), '[]'::jsonb)
  )
  FROM public.projects x WHERE x.project_code = _code AND x.status = 'VERIFIED';
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_project(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_project(text) TO anon, authenticated;
