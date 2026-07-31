-- Recovered from supabase_migrations.schema_migrations on prod.
-- Applied 20260722014014 outside the repo (dashboard SQL editor) and never
-- committed, which desynced the CLI's migration history. Restored verbatim.

-- Revoke EXECUTE on create_default_org_for_merchant() trigger fn from
-- PUBLIC/anon/authenticated; closes lints 0028/0029. Trigger still fires
-- (runs as table owner); SECURITY DEFINER kept intentionally.
REVOKE EXECUTE ON FUNCTION public.create_default_org_for_merchant() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_default_org_for_merchant() FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_default_org_for_merchant() FROM authenticated;;
