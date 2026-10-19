-- Finances: the weekly digest becomes a default account report, like the
-- daily summary (20261017200000).
--
-- 1. `weekly_digest_opted_out_at`: set when the owner turns the weekly digest
--    off (the settings toggle, DELETE, `active: false`, the one-click link in
--    every digest). While it is set nothing automatic (the worker backfill,
--    linking another bank) creates the digest again; only the owner turning
--    it back on clears it.
-- 2. A digest that is already paused counts as turned off, so the opt-out is
--    remembered even if the paused row is later deleted.
--
-- The schedules themselves are created by the app (`daily-subscriptions.ts`):
-- every merchant with a live connection and no weekly_digest row gets
-- Monday and Friday 08:00 in their finance timezone (America/Los_Angeles when
-- none is saved), all accounts, PDF + CSV, to their own login address only.
-- Existing rows are never touched.
--
-- Additive only.

alter table public.finance_email_preferences
  add column if not exists weekly_digest_opted_out_at timestamptz;

comment on column public.finance_email_preferences.weekly_digest_opted_out_at is
  'When the owner turned the weekly digest off or unsubscribed. While set, it is never re-created automatically.';

insert into public.finance_email_preferences (merchant_id, weekly_digest_opted_out_at)
select s.merchant_id, s.updated_at
  from public.finance_email_schedules s
 where s.kind = 'weekly_digest' and not s.active
on conflict (merchant_id) do update
  set weekly_digest_opted_out_at = coalesce(public.finance_email_preferences.weekly_digest_opted_out_at, excluded.weekly_digest_opted_out_at),
      updated_at = now();
