-- Finances: raw provider payloads, and the books (review + tax categories).
--
-- Payloads. Every provider response is now kept, byte for byte, encrypted on
-- the private volume, with a row here pointing at it. The normalised tables
-- are a view of that history, not the history itself: if a categorisation
-- rule or a parser changes, the original is still there to re-read, and a
-- fetch window can name the exact payload it came from.
--
-- Books. A transaction now carries where its category came from (`auto`
-- heuristics, a merchant `rule`, the `model`, or the `user`), how confident
-- that source was, a tax category, an optional per-transaction scope, and a
-- review stamp. The review queue is "rows with no `reviewed_at`"; nothing a
-- person confirmed is ever re-derived. Rules are per merchant, matched on
-- the normalised payee or the description, and are what turns one review
-- into every future sync agreeing with it.

create table if not exists public.finance_provider_payloads (
  id                uuid primary key default gen_random_uuid(),
  merchant_id       uuid not null references public.merchants(id) on delete cascade,
  connection_id     uuid not null references public.finance_connections(id) on delete cascade,
  job_id            uuid references public.finance_jobs(id) on delete set null,
  request_class     text not null check (request_class in ('interactive', 'background')),
  provider          text not null,
  protocol_version  integer,
  requested_start   timestamptz,
  requested_end     timestamptz,
  fetched_at        timestamptz not null default now(),
  bytes             bigint not null,
  content_hash      text not null,
  object_key        text not null,
  key_version       integer not null default 1,
  accounts          integer not null default 0,
  transactions      integer not null default 0,
  errors            integer not null default 0,
  created_at        timestamptz not null default now()
);

create index if not exists finance_provider_payloads_connection_idx
  on public.finance_provider_payloads (connection_id, fetched_at desc);

create index if not exists finance_provider_payloads_merchant_idx
  on public.finance_provider_payloads (merchant_id, fetched_at desc);

alter table public.finance_fetch_windows
  add column if not exists payload_id uuid references public.finance_provider_payloads(id) on delete set null;

alter table public.finance_transactions
  add column if not exists category_source        text not null default 'auto'
    check (category_source in ('auto', 'rule', 'model', 'user')),
  add column if not exists category_confidence    numeric(4,3),
  add column if not exists tax_category           text,
  add column if not exists scope_override         text check (scope_override in ('business', 'personal')),
  add column if not exists reviewed_at            timestamptz,
  add column if not exists review_note            text,
  add column if not exists suggested_category     text,
  add column if not exists suggested_tax_category text,
  add column if not exists suggested_confidence   numeric(4,3),
  add column if not exists suggested_by           text;

comment on column public.finance_transactions.category_source is
  'auto = keyword/MCC heuristic, rule = merchant rule, model = language model, user = confirmed by a person. A user value is never re-derived.';
comment on column public.finance_transactions.scope_override is
  'Per-transaction business/personal, overriding the account scope for the books only.';

create index if not exists finance_transactions_unreviewed_idx
  on public.finance_transactions (account_id, posted desc)
  where reviewed_at is null;

create table if not exists public.finance_category_rules (
  id                          uuid primary key default gen_random_uuid(),
  merchant_id                 uuid not null references public.merchants(id) on delete cascade,
  match_field                 text not null check (match_field in ('payee', 'description')),
  match_type                  text not null check (match_type in ('exact', 'contains')),
  -- Lower-cased, whitespace-collapsed.
  pattern                     text not null check (length(btrim(pattern)) > 0),
  category                    text not null,
  tax_category                text,
  scope                       text check (scope in ('business', 'personal')),
  hits                        integer not null default 0,
  created_from_transaction_id uuid references public.finance_transactions(id) on delete set null,
  active                      boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (merchant_id, match_field, match_type, pattern)
);

create index if not exists finance_category_rules_merchant_idx
  on public.finance_category_rules (merchant_id)
  where active;

-- A categorisation run is a job like a backfill: it pages through every
-- unreviewed row and may call the model, so it belongs in the worker.
alter table public.finance_jobs drop constraint if exists finance_jobs_kind_check;
alter table public.finance_jobs
  add constraint finance_jobs_kind_check
  check (kind in ('backfill', 'refresh', 'scheduled_sync', 'report', 'categorize'));

alter table public.finance_provider_payloads enable row level security;
alter table public.finance_category_rules    enable row level security;
revoke all on public.finance_provider_payloads from public, anon, authenticated;
revoke all on public.finance_category_rules    from public, anon, authenticated;
grant select, insert, update, delete on public.finance_provider_payloads to service_role;
grant select, insert, update, delete on public.finance_category_rules    to service_role;
