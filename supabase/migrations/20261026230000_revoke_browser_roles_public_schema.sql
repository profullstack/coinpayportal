-- Take PostgREST's browser roles (anon, authenticated) off the public schema
-- (2026-10-26 fleet audit).
--
-- CoinPay never talks to PostgREST as anon or authenticated: every query runs
-- with the service role (src/lib/supabase/server.ts, service-client.ts), the
-- browser client in src/lib/supabase/client.ts is imported nowhere, and the
-- app has no Supabase Auth calls. The RLS policies written for auth.uid()
-- were therefore thought latent.
--
-- They are not. OAuth access and ID tokens (src/lib/oauth/tokens.ts) are
-- HS256 JWTs signed with OIDC_SIGNING_SECRET, falling back to JWT_SECRET,
-- and prod's JWT_SECRET is the Supabase JWT secret. PostgREST accepts them:
-- no role claim means the anon role, and sub sets auth.uid(). So anyone with
-- a CoinPay OAuth token for an account (the account owner via their own
-- OAuth client, or any "Sign in with CoinPay" app holding a user's token)
-- could, with the public anon key as apikey:
--   * PATCH merchants?id=eq.<sub> {"is_admin": true} (policy "Merchants can
--     update own data" is TO public), or change email/password_hash;
--   * read the merchant row, password_hash and reset_token included;
--   * insert affiliate_payouts, business_collection_payments, escrow_series,
--     wallet rows... for that account, skipping the API's validation.
-- GoTrue signup is also open (44 auth.users, none of them merchants) and its
-- tokens get the authenticated role.
--
-- Removing every table/sequence privilege from anon and authenticated closes
-- all of it without touching the service role, so payment flows are
-- unchanged. pg_stat_statements since 2026-09-25 shows only read probes from
-- these roles (table enumeration), no writes.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;

-- App functions (not extension members): service role only.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- Trigger and event-trigger functions are never RPCs.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype in ('trigger'::regtype, 'event_trigger'::regtype)
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- New functions are not executable by PUBLIC/anon/authenticated by default.
-- A new function the browser calls (or an RLS policy uses) needs an explicit
-- GRANT EXECUTE ... TO anon, authenticated.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
