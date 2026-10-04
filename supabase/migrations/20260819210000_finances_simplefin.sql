-- /finances — bank account and credit card aggregation via SimpleFIN.
--
-- CoinPay knows what it *earns* (payments, invoices, escrows) but nothing about
-- where that money lands or what it is spent against. This is the other side of
-- the ledger: read-only balances and transactions pulled from the institutions
-- themselves through SimpleFIN (https://www.simplefin.org/protocol.html).
--
-- Design notes:
--
--  * This is house financial data, not merchant data. Every table is RLS-enabled
--    with **no policies at all**, so `anon` and `authenticated` can read nothing
--    even if a key leaks; the app reaches it only through the service client
--    behind `requireAdmin()`. That is the same posture as the admin-only
--    Postgres functions, and it is why there are no `merchant_id` columns to
--    scope on — there is nothing to scope, the whole table is privileged.
--
--  * The access URL is the whole credential — it carries HTTP Basic
--    credentials inline (`https://user:pass@host/simplefin`) and is
--    non-recoverable, since a SimpleFIN setup token can be claimed exactly
--    once. It is stored AES-256-GCM encrypted under `ENCRYPTION_KEY` rather
--    than in the clear, so a database dump alone does not hand over a live
--    read feed into someone's bank.
--
--  * Amounts are `numeric(20,4)`, never float. SimpleFIN sends amounts as
--    decimal *strings* precisely so they survive the trip; parsing them into a
--    double here would undo that. Unlike the crypto money columns elsewhere in
--    this schema, these are all in `currency` (ISO 4217) and a same-currency
--    sum is meaningful.
--
--  * Sign convention is SimpleFIN's and is preserved verbatim: a credit card
--    balance is **negative** when money is owed, and a transaction amount is
--    negative for a withdrawal. Normalising signs at import would destroy the
--    only thing that distinguishes an asset from a liability, since SimpleFIN
--    has no account-type field at all.
--
--  * `(account_id, external_id)` is unique so a re-sync is idempotent. Overlap
--    is the normal case, not the exception: pending transactions get rewritten
--    when they post, and every sync deliberately re-reads a window that has
--    already been read.

-- ---------------------------------------------------------------------------
-- Connections — one row per claimed SimpleFIN access URL.
-- ---------------------------------------------------------------------------
create table if not exists public.finance_connections (
  id                 uuid primary key default gen_random_uuid(),

  provider           text not null default 'simplefin'
                       check (provider in ('simplefin')),

  -- Human label for the console; the access URL itself is never displayed.
  label              text,

  -- AES-256-GCM, format `iv:authTag:ciphertext` — see src/lib/crypto/encryption.ts.
  access_url_encrypted text not null,

  -- Which admin added it. `set null` rather than cascade: losing the operator
  -- must not silently delete the connection feeding the balance sheet.
  created_by         uuid references public.merchants(id) on delete set null,

  is_active          boolean not null default true,

  created_at         timestamptz not null default now(),
  last_synced_at     timestamptz,
  last_sync_status   text check (last_sync_status in ('ok', 'partial', 'error')),
  last_sync_error    text,

  -- Cheap "what did the last run do" counters for the UI, so the common case
  -- needs no join against a run-history table.
  last_sync_accounts     integer,
  last_sync_transactions integer
);

comment on table public.finance_connections is
  'SimpleFIN access URLs (encrypted). Admin-only; RLS on with no policies.';

-- ---------------------------------------------------------------------------
-- Accounts — one row per account the connection exposes.
-- ---------------------------------------------------------------------------
create table if not exists public.finance_accounts (
  id             uuid primary key default gen_random_uuid(),
  connection_id  uuid not null references public.finance_connections(id) on delete cascade,

  -- SimpleFIN's account id. Unique within a connection, not globally.
  external_id    text not null,

  -- Institution, denormalised from the per-account `org` object SimpleFIN
  -- repeats on every response. Kept flat because there is no stable org table
  -- to key against and the fields are display-only.
  org_id         text,
  org_name       text,
  org_domain     text,
  org_url        text,

  name           text not null,
  currency       text not null default 'USD',

  balance            numeric(20,4),
  available_balance  numeric(20,4),
  balance_date       timestamptz,

  -- SimpleFIN carries no account type, so `kind` is *derived* on every sync
  -- from the account name, the institution and the sign of the balance.
  -- `kind_override` is the operator's correction and always wins; keeping them
  -- in separate columns means re-deriving never clobbers a manual fix.
  kind           text not null default 'unknown'
                   check (kind in ('checking','savings','credit','loan','investment','cash','unknown')),
  kind_override  text
                   check (kind_override in ('checking','savings','credit','loan','investment','cash','unknown')),

  -- Hidden accounts stay synced but drop out of totals and listings — for
  -- closed cards and duplicates that would otherwise distort net worth.
  is_hidden      boolean not null default false,

  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),

  unique (connection_id, external_id)
);

create index if not exists finance_accounts_connection_idx
  on public.finance_accounts (connection_id);

comment on column public.finance_accounts.balance is
  'SimpleFIN sign convention: negative means money owed (credit cards, loans).';

-- ---------------------------------------------------------------------------
-- Transactions.
-- ---------------------------------------------------------------------------
create table if not exists public.finance_transactions (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.finance_accounts(id) on delete cascade,

  external_id   text not null,

  -- `posted` is when the institution booked it; `transacted_at` is when it
  -- actually happened. They differ by days on card purchases, so both are kept
  -- and `posted` is what the ledger orders by.
  posted        timestamptz not null,
  transacted_at timestamptz,

  amount        numeric(20,4) not null,

  description   text,
  payee         text,
  memo          text,

  -- Merchant Category Code, when the institution supplies one. The single most
  -- reliable categorisation signal available; string, not int, because leading
  -- zeros are significant.
  mcc           text,

  pending       boolean not null default false,

  -- Derived at import from mcc + payee/description. Nullable: an
  -- uncategorisable row is honest, an 'other' bucket pretending to be a
  -- decision is not.
  category      text,

  imported_at   timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (account_id, external_id)
);

-- The ledger view: one account, newest first.
create index if not exists finance_transactions_account_posted_idx
  on public.finance_transactions (account_id, posted desc);

-- The cross-account cashflow view, and every date-windowed aggregate.
create index if not exists finance_transactions_posted_idx
  on public.finance_transactions (posted desc);

create index if not exists finance_transactions_category_idx
  on public.finance_transactions (category)
  where category is not null;

-- ---------------------------------------------------------------------------
-- Lock everything down.
--
-- RLS on with zero policies denies every browser-side role outright. The
-- explicit revokes matter as well: Supabase's default privileges grant new
-- public-schema objects to `anon`/`authenticated` directly, and RLS is the only
-- thing standing between those grants and the data. Belt and braces, because
-- the failure mode here is somebody's bank feed.
-- ---------------------------------------------------------------------------
alter table public.finance_connections  enable row level security;
alter table public.finance_accounts     enable row level security;
alter table public.finance_transactions enable row level security;

revoke all on public.finance_connections  from public, anon, authenticated;
revoke all on public.finance_accounts     from public, anon, authenticated;
revoke all on public.finance_transactions from public, anon, authenticated;

grant select, insert, update, delete on public.finance_connections  to service_role;
grant select, insert, update, delete on public.finance_accounts     to service_role;
grant select, insert, update, delete on public.finance_transactions to service_role;
