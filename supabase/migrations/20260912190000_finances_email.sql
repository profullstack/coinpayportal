-- Finances: emailing reports and the CPA pack, and a weekly digest schedule.
--
-- Share links. An accountant has no CoinPay login, so a report they are
-- sent needs a way in that is not a session: a random token, stored only
-- as its SHA-256, that expires and counts its downloads. The bytes it serves
-- are the same artifact the merchant could download; the link is created
-- only by the merchant's own send action and can be revoked.
--
-- Schedules. One row per merchant and kind: which local weekdays and hour,
-- who receives it, and when the next run is due. The worker turns a due
-- schedule into an `email_report` job, so a slow provider or a mail outage
-- retries like any other job rather than being lost with a tick.

create table if not exists public.finance_share_links (
  id             uuid primary key default gen_random_uuid(),
  merchant_id    uuid not null references public.merchants(id) on delete cascade,
  kind           text not null check (kind in ('report', 'books')),
  report_id      uuid references public.finance_reports(id) on delete cascade,
  -- For a books link: the period/scope/timezone to render at download time.
  params         jsonb not null default '{}'::jsonb,
  formats        text[] not null default '{}',
  token_hash     text not null unique,
  expires_at     timestamptz not null,
  max_downloads  integer,
  downloads      integer not null default 0,
  recipients     text[] not null default '{}',
  revoked_at     timestamptz,
  last_used_at   timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists finance_share_links_merchant_idx
  on public.finance_share_links (merchant_id, created_at desc);

create table if not exists public.finance_email_schedules (
  id             uuid primary key default gen_random_uuid(),
  merchant_id    uuid not null references public.merchants(id) on delete cascade,
  kind           text not null default 'weekly_digest' check (kind in ('weekly_digest')),
  -- 0 = Sunday … 6 = Saturday, in the merchant's finance timezone.
  weekdays       integer[] not null default '{1,5}',
  hour           integer not null default 8 check (hour between 0 and 23),
  timezone       text not null default 'UTC',
  recipients     text[] not null default '{}',
  scope          text not null default 'business' check (scope in ('business', 'personal', 'all')),
  formats        text[] not null default '{pdf,csv}',
  active         boolean not null default true,
  last_sent_at   timestamptz,
  next_run_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (merchant_id, kind)
);

create index if not exists finance_email_schedules_due_idx
  on public.finance_email_schedules (next_run_at)
  where active;

alter table public.finance_jobs drop constraint if exists finance_jobs_kind_check;
alter table public.finance_jobs
  add constraint finance_jobs_kind_check
  check (kind in ('backfill', 'refresh', 'scheduled_sync', 'report', 'categorize', 'email_report'));

alter table public.finance_share_links     enable row level security;
alter table public.finance_email_schedules enable row level security;
revoke all on public.finance_share_links     from public, anon, authenticated;
revoke all on public.finance_email_schedules from public, anon, authenticated;
grant select, insert, update, delete on public.finance_share_links     to service_role;
grant select, insert, update, delete on public.finance_email_schedules to service_role;
