-- Nightly payment summary.
--
-- The column defaults to true, so every merchant created from here on gets
-- the digest without having to find a setting, and `email_notifications`
-- remains the master switch above it.
--
-- Existing merchants are deliberately NOT backfilled. There are hundreds of
-- them and they are other people's businesses, not ours; switching on a
-- recurring email for someone who never asked is a thing you cannot unsend.
-- `add column ... default` leaves existing rows at the default in Postgres,
-- so the explicit false below is what keeps them out until they opt in.
--
-- Our own accounts are opted in by name, which is the point of the feature.

alter table public.merchant_settings
  add column if not exists nightly_summary_enabled boolean not null default true;

alter table public.merchant_settings
  add column if not exists nightly_summary_last_sent_at timestamptz;

-- Everyone who already existed stays off until they choose it.
update public.merchant_settings s
   set nightly_summary_enabled = false
  from public.merchants m
 where m.id = s.merchant_id
   and m.created_at < now()
   and m.email not in ('anthony@profullstack.com', 'anthony@chovy.com');

-- ...and ours go on.
update public.merchant_settings s
   set nightly_summary_enabled = true
  from public.merchants m
 where m.id = s.merchant_id
   and m.email in ('anthony@profullstack.com', 'anthony@chovy.com');

-- The cron reads `where nightly_summary_enabled and email_notifications`,
-- so index the pair it filters on rather than either column alone.
create index if not exists merchant_settings_nightly_summary_idx
  on public.merchant_settings (merchant_id)
  where nightly_summary_enabled and email_notifications;

comment on column public.merchant_settings.nightly_summary_last_sent_at is
  'Set only after a send succeeds, so a provider outage retries next tick rather than skipping the day.';
