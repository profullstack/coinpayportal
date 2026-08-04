-- Restrict public_landing_stats() to the service role, for real this time.
--
-- The previous migration said "service_role only" and did:
--
--   revoke all on function public.public_landing_stats() from public;
--   grant execute on function public.public_landing_stats() to service_role;
--
-- which does not achieve that on Supabase. `revoke ... from public` only drops
-- the PUBLIC pseudo-role's grant. Supabase ships default privileges that grant
-- EXECUTE on new functions in `public` to `anon` and `authenticated`, and those
-- are separate, explicit grants that survive the revoke. The resulting ACL was:
--
--   postgres=X/postgres  anon=X/postgres  authenticated=X/postgres  service_role=X/postgres
--
-- The function is SECURITY INVOKER, so an anonymous caller ran it under RLS,
-- saw no rows, and got a well-formed answer back:
--
--   {"payments_settled": 0, "settled_volume_usd": 0, "active_businesses": 0}
--
-- A public endpoint reporting the business as zero is the same failure the
-- landing-page work set out to remove — a number that looks measured and is
-- not. Revoked explicitly rather than trusting the default.
--
-- Kept SECURITY INVOKER deliberately: with anon and authenticated revoked, the
-- only caller is the service role, which bypasses RLS anyway. Adding DEFINER
-- would buy nothing and would make an accidental future re-grant far worse,
-- since it would then return the real figures instead of zeros.

revoke execute on function public.public_landing_stats() from anon, authenticated;

comment on function public.public_landing_stats() is
  'Aggregate-only counters for the public landing page. service_role only — see '
  'src/app/api/public-stats/route.ts. Do not grant to anon/authenticated: the '
  'function is SECURITY INVOKER and would silently return zeros under RLS.';
