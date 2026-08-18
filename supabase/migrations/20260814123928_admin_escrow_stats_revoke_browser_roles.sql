revoke all on function public.admin_escrow_stats(text, text, text, text, text, text, int, int) from public, anon, authenticated;
revoke all on function public.admin_escrow_summary() from public, anon, authenticated;
grant execute on function public.admin_escrow_stats(text, text, text, text, text, text, int, int) to service_role;
grant execute on function public.admin_escrow_summary() to service_role;
