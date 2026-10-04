-- Finances: CoinPay cloud statement fetching.
--
-- SimpleFIN carries balances and transactions only. To download the PDF
-- statements, CoinPay signs in to the bank on its own servers: the merchant
-- signs in once through a browser CoinPay runs and streams to the PWA, and
-- the bank's session (cookies and site storage, never a password) is kept
-- encrypted on the files volume, the same way the statement library keeps
-- PDFs. Scheduled fetches restore that session in a fresh headless browser
-- and save it again afterwards, since banks rotate their cookies.
--
-- This row is the index: which bank, where fetch starts, the encrypted
-- object's key, and what happened last. No secret material lives in it.

create table if not exists public.finance_bank_sessions (
  id                 uuid primary key default gen_random_uuid(),
  merchant_id        uuid not null references public.merchants(id) on delete cascade,
  institution_key    text not null check (institution_key ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  institution_label  text check (institution_label is null or char_length(institution_label) <= 120),
  -- The page the merchant finished on: where every fetch starts.
  start_url          text check (start_url is null or (char_length(start_url) <= 2000 and start_url ~ '^https://')),
  -- The encrypted session (files.ts kind 'bank-sessions'); null until a sign-in is saved.
  object_key         text unique,
  state              text not null default 'pending'
                       check (state in ('pending', 'active', 'login_needed', 'disconnected')),
  cookie_count       integer not null default 0 check (cookie_count >= 0),
  -- Candidate keys already fetched, so a row is never clicked twice.
  seen_keys          jsonb not null default '[]'::jsonb,
  schedule           text not null default 'weekly' check (schedule in ('weekly', 'off')),
  next_fetch_at      timestamptz,
  last_login_at      timestamptz,
  last_fetch_at      timestamptz,
  last_status        text,
  created_by         uuid references public.merchants(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (merchant_id, institution_key)
);

create index if not exists finance_bank_sessions_due_idx
  on public.finance_bank_sessions (next_fetch_at)
  where state = 'active' and schedule <> 'off';

alter table public.finance_bank_sessions enable row level security;
revoke all on public.finance_bank_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.finance_bank_sessions to service_role;

-- A fetch in the cloud is a job like any other.
alter table public.finance_jobs drop constraint if exists finance_jobs_kind_check;
alter table public.finance_jobs
  add constraint finance_jobs_kind_check
  check (kind in ('backfill', 'refresh', 'scheduled_sync', 'report', 'categorize', 'email_report', 'statement_fetch'));

-- The CoinPay CLI as a public OAuth 2.1 client: authorization code + PKCE
-- with a loopback redirect (any port, RFC 8252 section 7.3), no secret, and
-- rotating refresh tokens. `merchant` is the scope that lets it act as you.
insert into public.oauth_clients (client_id, client_secret, name, description, redirect_uris, scopes, is_active)
values (
  'coinpay-cli',
  '',
  'CoinPay CLI',
  'The coinpay command line, signing in with OAuth 2.1 (PKCE, loopback redirect).',
  array['http://127.0.0.1/callback', 'http://[::1]/callback'],
  array['openid', 'profile', 'email', 'merchant'],
  true
)
on conflict (client_id) do update
  set redirect_uris = excluded.redirect_uris,
      scopes = excluded.scopes,
      is_active = true;
