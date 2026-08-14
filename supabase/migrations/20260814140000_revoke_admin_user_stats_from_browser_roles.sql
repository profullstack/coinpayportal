-- Close the browser-role grants on the admin user-stats functions.
--
-- `20260813120000_admin_user_stats.sql` revoked both functions from PUBLIC and
-- granted them to `service_role`, which reads as locked down but is not:
-- Supabase's default privileges grant EXECUTE on new public-schema functions
-- directly to `anon` and `authenticated`, and a revoke from PUBLIC does not
-- remove a grant held by a named role. Both roles could therefore still call
-- them. `admin_escrow_stats()` was written with the explicit revoke from the
-- start; this brings the older pair in line.
--
-- Not a leak in the meantime: both are `security invoker`, so an anon caller
-- runs under anon's own privileges and RLS on `merchants`, `businesses`,
-- `payments` and `escrows` returns nothing. The point of revoking as well is
-- that the call fails outright instead of quietly returning an empty result
-- that looks like real data — and that the next `security definer` function
-- copied from this pattern does not inherit a hole.
--
-- Verify with:
--   select has_function_privilege('anon', p.oid, 'execute')
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname like 'admin_%stats';

revoke all on function public.admin_user_stats(text, text, text, int, int) from public, anon, authenticated;
revoke all on function public.admin_platform_stats() from public, anon, authenticated;

grant execute on function public.admin_user_stats(text, text, text, int, int) to service_role;
grant execute on function public.admin_platform_stats() to service_role;
