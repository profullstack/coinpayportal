-- Snapshot of the never-funded, inflated-amount escrows before removing them.
--
-- Kept in a `backup` schema rather than `public` on purpose: these rows carry
-- `release_token` and `beneficiary_token` (bearer credentials that can release
-- an escrow) plus counterparty emails. PostgREST exposes `public` only, so a
-- backup table there would be reachable over the REST API.
create schema if not exists backup;

revoke all on schema backup from public, anon, authenticated;

create table backup.escrows_inflated_20260814 as
  select * from public.escrows where amount_usd >= 1000000;

create table backup.escrow_events_inflated_20260814 as
  select * from public.escrow_events
  where escrow_id in (select id from public.escrows where amount_usd >= 1000000);

comment on table backup.escrows_inflated_20260814 is
  'Snapshot taken 2026-08-14 before deleting 12 never-funded escrows whose amount_usd '
  'ranged from $32.7M to $9.86B. None had a deposit transaction, so no funds were involved. '
  'Restore with: insert into public.escrows select * from backup.escrows_inflated_20260814;';

revoke all on all tables in schema backup from public, anon, authenticated;
