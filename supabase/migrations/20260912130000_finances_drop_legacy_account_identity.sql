-- Apply AFTER the reports/statements code (PR #340) is live in production.
--
-- Removes the bridging constraint restored by
-- 20260912123000_finances_restore_legacy_account_identity. Once the deployed
-- sync upserts on (source_connection_id, external_id), the old
-- (connection_id, external_id) identity is only in the way: two SimpleFIN 2.0
-- upstream logins can legitimately hand out the same account id under one
-- credential, and this constraint would make the second one a write error.
--
-- NOT yet applied to production. Apply with the Supabase MCP
-- (`apply_migration`, name `finances_drop_legacy_account_identity`) once the
-- deploy is confirmed to be serving the new sync.

alter table public.finance_accounts
  drop constraint if exists finance_accounts_connection_id_external_id_key;
