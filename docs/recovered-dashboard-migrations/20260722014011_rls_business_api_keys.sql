-- Recovered from supabase_migrations.schema_migrations on prod.
-- Applied 20260722014011 outside the repo (dashboard SQL editor) and never
-- committed, which desynced the CLI's migration history. Restored verbatim.

-- Enable RLS on public.business_api_keys (service_role full access +
-- merchants SELECT own business keys); closes rls_disabled_in_public.
ALTER TABLE business_api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "merchants_select_own_business_api_keys" ON business_api_keys;
CREATE POLICY "merchants_select_own_business_api_keys" ON business_api_keys
  FOR SELECT TO authenticated
  USING (business_id IN (SELECT id FROM businesses WHERE merchant_id = auth.uid()));

DROP POLICY IF EXISTS "service_role_all_business_api_keys" ON business_api_keys;
CREATE POLICY "service_role_all_business_api_keys" ON business_api_keys
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);;
