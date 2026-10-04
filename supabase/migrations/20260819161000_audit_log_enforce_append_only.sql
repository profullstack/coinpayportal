-- The append-only grant in 20260819160000_audit_log.sql did not take effect.
--
-- Supabase's default privileges grant ALL on a new public-schema table directly
-- to `service_role`, and revoking from PUBLIC/anon/authenticated does not remove
-- a grant held by a named role. So `grant insert, select to service_role` added
-- nothing that was not already there, and service_role kept UPDATE, DELETE and
-- TRUNCATE — precisely the privileges an audit log must not hand to the
-- credential that writes it.
--
-- Caught by reading `information_schema.role_table_grants` after applying,
-- rather than trusting the migration to have meant what it said. Same trap as
-- the admin functions elsewhere in this project: a REVOKE must name every role
-- that actually holds the grant.

revoke update, delete, truncate on table public.audit_log from service_role;
revoke update, delete, truncate on table public.audit_log from public, anon, authenticated;
