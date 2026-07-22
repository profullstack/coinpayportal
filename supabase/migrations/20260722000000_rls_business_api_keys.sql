-- Fix Supabase linter finding: rls_disabled_in_public
--   Table `public.business_api_keys` is public (exposed to PostgREST) but RLS
--   was never enabled, so any anon/authenticated caller could read every
--   business's scoped API-key rows (hashes, prefixes, scopes).
--   https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public
--
-- The table is written/read server-side with the service role. We enable RLS
-- and add:
--   * service_role  -> full access (unchanged effective server behaviour)
--   * merchants     -> SELECT only their own business's keys (dashboard listing).
--     Raw keys are never stored (only HMAC hashes), so SELECT stays safe.
-- No anon access.

ALTER TABLE business_api_keys ENABLE ROW LEVEL SECURITY;

-- Merchants can list the keys belonging to businesses they own.
DROP POLICY IF EXISTS "merchants_select_own_business_api_keys" ON business_api_keys;
CREATE POLICY "merchants_select_own_business_api_keys" ON business_api_keys
  FOR SELECT TO authenticated
  USING (business_id IN (SELECT id FROM businesses WHERE merchant_id = auth.uid()));

-- Service role performs all mint/revoke/last_used bookkeeping.
DROP POLICY IF EXISTS "service_role_all_business_api_keys" ON business_api_keys;
CREATE POLICY "service_role_all_business_api_keys" ON business_api_keys
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
