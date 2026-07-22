-- Fix Supabase linter findings:
--   anon_security_definer_function_executable          (lint 0028)
--   authenticated_security_definer_function_executable (lint 0029)
--
-- public.create_default_org_for_merchant() is a TRIGGER function fired by
-- `merchant_create_default_org` AFTER INSERT ON merchants. It is SECURITY
-- DEFINER because it must write across organizations / organization_members /
-- merchants regardless of the inserting caller's RLS.
--
-- PostgREST still exposes it as an RPC (/rest/v1/rpc/create_default_org_for_merchant),
-- so anon/authenticated could invoke this privileged function directly. It is
-- never meant to be called by clients — only by the trigger.
--
-- Revoking EXECUTE does NOT disable the trigger: triggers execute the function
-- as the table owner, independent of the RPC EXECUTE grant. SECURITY DEFINER is
-- kept intentionally.
--   https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable

REVOKE EXECUTE ON FUNCTION public.create_default_org_for_merchant() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_default_org_for_merchant() FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_default_org_for_merchant() FROM authenticated;
