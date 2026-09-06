-- Nightly payment summary.
--
-- Enabled by default: a merchant should get the digest without having to
-- find a setting, and the existing `email_notifications` flag still acts as
-- the master switch, so anyone who has already opted out of email stays out.
--
-- Backfilled to true for existing rows as well as new ones. Unlike a
-- cadence someone deliberately chose, this option did not exist until now,
-- so there is no preference to overwrite.

alter table public.merchant_settings
  add column if not exists nightly_summary_enabled boolean not null default true;

alter table public.merchant_settings
  add column if not exists nightly_summary_last_sent_at timestamptz;

update public.merchant_settings
  set nightly_summary_enabled = true
  where nightly_summary_enabled is null;

-- The cron reads `where nightly_summary_enabled and email_notifications`,
-- so index the pair it filters on rather than either column alone.
create index if not exists merchant_settings_nightly_summary_idx
  on public.merchant_settings (merchant_id)
  where nightly_summary_enabled and email_notifications;

comment on column public.merchant_settings.nightly_summary_last_sent_at is
  'Set only after a send succeeds, so a provider outage retries next tick rather than skipping the day.';
