
CREATE POLICY "evidence upload" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'evidence');
CREATE POLICY "evidence read auth" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'evidence');
