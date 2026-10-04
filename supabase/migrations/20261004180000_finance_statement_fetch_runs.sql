-- Finances: what happened each time a statement fetcher visited a bank.
--
-- SimpleFIN carries balances and transactions only, so the original PDF
-- statements are downloaded from each bank by `coinpay finances statements
-- fetch`, on the merchant's own machine: the bank session lives in a Chrome
-- profile there and never reaches CoinPay. What CoinPay receives is the PDFs
-- (through the statement library, unchanged) and one row per bank per run,
-- so the PWA can say which bank needs signing in again and which months are
-- still missing. No URL, cookie or page content is stored, only counts.

create table if not exists public.finance_statement_fetch_runs (
  id                 uuid primary key default gen_random_uuid(),
  merchant_id        uuid not null references public.merchants(id) on delete cascade,
  institution_key    text not null check (institution_key ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  institution_label  text check (institution_label is null or char_length(institution_label) <= 120),
  status             text not null check (status in ('ok', 'login_needed', 'no_statements', 'error')),
  candidates         integer not null default 0 check (candidates >= 0),
  filed              integer not null default 0 check (filed >= 0),
  duplicates         integer not null default 0 check (duplicates >= 0),
  unmatched          integer not null default 0 check (unmatched >= 0),
  silent             integer not null default 0 check (silent >= 0),
  message            text check (message is null or char_length(message) <= 500),
  client             text check (client is null or char_length(client) <= 80),
  started_at         timestamptz not null,
  finished_at        timestamptz not null,
  reported_by        uuid references public.merchants(id) on delete set null,
  created_at         timestamptz not null default now(),
  check (finished_at >= started_at)
);

create index if not exists finance_statement_fetch_runs_lookup_idx
  on public.finance_statement_fetch_runs (merchant_id, institution_key, finished_at desc);

alter table public.finance_statement_fetch_runs enable row level security;
revoke all on public.finance_statement_fetch_runs from public, anon, authenticated;
grant select, insert, update, delete on public.finance_statement_fetch_runs to service_role;
