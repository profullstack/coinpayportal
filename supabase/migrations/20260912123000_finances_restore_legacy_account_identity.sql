-- Bridge until the reports/statements code is deployed.
--
-- 20260912120000_finances_reports_statements dropped the old account
-- identity, unique (connection_id, external_id), in favour of
-- (source_connection_id, external_id). The sync that was still running in
-- production at the time upserts on the OLD pair, and an upsert whose
-- ON CONFLICT target has no unique constraint fails outright — so between
-- applying that migration and deploying the new code, "Sync now" would have
-- been broken. This puts the old constraint back so both identities are
-- valid at once. It is harmless until a SimpleFIN 2.0 credential reports
-- the same external id under two upstream logins, which is exactly what
-- the next migration removes it for.
--
-- Applied to production 2026-09-12 via the Supabase MCP.

alter table public.finance_accounts
  drop constraint if exists finance_accounts_connection_id_external_id_key;

alter table public.finance_accounts
  add constraint finance_accounts_connection_id_external_id_key unique (connection_id, external_id);
