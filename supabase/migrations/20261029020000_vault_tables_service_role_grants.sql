-- The vault migrations only revoked anon/authenticated and relied on Supabase's
-- default privileges for service_role, which do not apply to tables created by
-- `postgres` over psql. Without these the operator vault page 500s with
-- "permission denied for table secret_vaults".
grant select, insert, update, delete on public.secret_vaults to service_role;
grant select, insert, update, delete on public.operator_sealed_secrets to service_role;
grant select, insert, update, delete on public.operator_address_pool to service_role;
grant select on public.admin_unsealed_user_secrets to service_role;
grant select on public.admin_unsealed_operator_keys to service_role;
