-- Finances: calendar-period reports, durable sync jobs and the statement library.
--
-- Everything here is additive. The three original finance tables keep their
-- rows and their uuids; what changes is how an account is identified and
-- what surrounds it.
--
-- Identity. A `finance_connections` row is a *credential* (one SimpleFIN
-- access URL, one Plaid item). Behind one credential the SimpleFIN 2.0 draft
-- can expose several upstream bank logins, and two logins at the same bank
-- can hand out the same account id. Keying accounts on
-- `(connection_id, external_id)` would then overwrite one account with the
-- other, balances and all. So a `finance_source_connections` row now sits
-- between the credential and its accounts, and accounts are unique on
-- `(source_connection_id, external_id)`. Every existing account is moved in
-- place under a `legacy` source for its credential — same uuid, same
-- transaction foreign keys — so nothing a merchant has already reported on
-- changes identity.
--
-- Jobs. Backfilling a quarter is several provider requests spread over
-- minutes, against a budget of about twenty a day; it cannot live inside one
-- HTTP request. `finance_jobs` is a Postgres-backed queue in the same shape as
-- `webhook_deliveries`: a partial index on due work, bounded attempts, and a
-- lease with a fencing version so a worker that stalls and wakes up cannot
-- commit over the one that took its job.
--
-- Coverage. A 200 from the provider says nothing about how much history the
-- bank actually handed over. `finance_fetch_windows` records every interval
-- that was asked for and what came back, per account, so a report can say
-- which part of its period was ever fetched rather than inferring it from
-- the first and last transaction it happens to hold.
--
-- Reports and statements. A report is an immutable snapshot: its selected
-- rows are frozen into `dataset` at generation time by one SQL statement (one
-- Postgres snapshot, exact `numeric` totals), and every rendered format is
-- derived from that. An uploaded bank statement is bytes the user supplied,
-- stored encrypted on the private volume with only metadata here; nothing
-- about it is treated as verified.
--
-- Access. RLS is on with no policies, and the browser roles are revoked, the
-- same way the original finance tables are locked. CoinPay authenticates with
-- its own JWT, so ownership is enforced in the application by `merchant_id`,
-- and every table that can be reached by id carries `merchant_id` directly so
-- a route never has to trust a parent it did not look up.

-- ---------------------------------------------------------------------------
-- Per-merchant finance settings (the report timezone lives here).
-- ---------------------------------------------------------------------------

create table if not exists public.finance_settings (
  merchant_id   uuid primary key references public.merchants(id) on delete cascade,
  timezone      text not null default 'UTC',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on column public.finance_settings.timezone is
  'IANA zone used to resolve calendar months and quarters for this merchant. Never the server zone.';

-- ---------------------------------------------------------------------------
-- Credentials: protocol selection, consent, lifecycle.
-- ---------------------------------------------------------------------------

alter table public.finance_connections
  add column if not exists protocol_version  integer check (protocol_version in (1, 2)),
  add column if not exists sync_consent_at   timestamptz,
  add column if not exists sync_minute       integer check (sync_minute between 0 and 1439),
  add column if not exists next_sync_at      timestamptz,
  add column if not exists lifecycle_state   text not null default 'active'
    check (lifecycle_state in ('active', 'reconnect_required', 'payment_required', 'disconnected')),
  add column if not exists disconnected_at   timestamptz,
  add column if not exists key_version       integer not null default 1;

comment on column public.finance_connections.protocol_version is
  'SimpleFIN protocol shape this credential is fetched with. NULL means the tested default (1). Never upgraded implicitly.';
comment on column public.finance_connections.sync_consent_at is
  'When the merchant opted into a daily background sync. NULL = no scheduled work for this credential.';
comment on column public.finance_connections.lifecycle_state is
  'disconnected = credential removed locally, history retained. reconnect_required / payment_required come from the provider.';

create index if not exists finance_connections_scheduled_idx
  on public.finance_connections (next_sync_at)
  where sync_consent_at is not null and lifecycle_state = 'active' and is_active;

-- ---------------------------------------------------------------------------
-- Upstream sources beneath a credential.
-- ---------------------------------------------------------------------------

create table if not exists public.finance_source_connections (
  id              uuid primary key default gen_random_uuid(),
  connection_id   uuid not null references public.finance_connections(id) on delete cascade,
  merchant_id     uuid not null references public.merchants(id) on delete cascade,

  -- 'legacy'      : accounts imported before sources existed, one per credential
  -- 'simplefin_v2': a conn_id from the 2.0 draft response
  -- 'plaid'       : the Plaid item behind the credential
  namespace       text not null check (namespace in ('legacy', 'simplefin_v2', 'plaid')),
  upstream_id     text not null,

  name            text,
  org_id          text,
  org_url         text,
  sfin_url        text,

  state           text not null default 'ok'
                    check (state in ('ok', 'reconnect_required', 'failed', 'unknown')),
  last_error_code text,
  last_error      text,
  last_seen_at    timestamptz,
  created_at      timestamptz not null default now(),

  unique (connection_id, namespace, upstream_id)
);

create index if not exists finance_source_connections_merchant_idx
  on public.finance_source_connections (merchant_id);

alter table public.finance_accounts
  add column if not exists source_connection_id uuid references public.finance_source_connections(id) on delete cascade,
  add column if not exists identity_state text not null default 'ok'
    check (identity_state in ('ok', 'identity_review_required'));

-- Move every existing account under a legacy source for its credential.
insert into public.finance_source_connections (connection_id, merchant_id, namespace, upstream_id)
select c.id, c.merchant_id, 'legacy', c.id::text
  from public.finance_connections c
on conflict (connection_id, namespace, upstream_id) do nothing;

update public.finance_accounts a
   set source_connection_id = s.id
  from public.finance_source_connections s
 where s.connection_id = a.connection_id
   and s.namespace = 'legacy'
   and a.source_connection_id is null;

alter table public.finance_accounts
  alter column source_connection_id set not null;

create unique index if not exists finance_accounts_source_external_idx
  on public.finance_accounts (source_connection_id, external_id);

-- The old identity. Two upstream logins may legitimately share an external
-- id under one credential now, so this constraint has to go.
alter table public.finance_accounts
  drop constraint if exists finance_accounts_connection_id_external_id_key;

create index if not exists finance_accounts_identity_review_idx
  on public.finance_accounts (identity_state)
  where identity_state <> 'ok';

-- ---------------------------------------------------------------------------
-- Transactions: pending rows without a post date, content hashes, revisions.
-- ---------------------------------------------------------------------------

-- A pending item that has not posted has no post date. Storing 1970 or today
-- would put it into some period's posted ledger; NULL keeps it in the
-- pending appendix until the provider dates it.
alter table public.finance_transactions
  alter column posted drop not null;

alter table public.finance_transactions
  add column if not exists source_hash  text,
  add column if not exists revision     integer not null default 1,
  add column if not exists superseded_by text;

alter table public.finance_transactions
  drop constraint if exists finance_transactions_posted_when_not_pending;
alter table public.finance_transactions
  add constraint finance_transactions_posted_when_not_pending
  check (pending or posted is not null);

create index if not exists finance_transactions_pending_idx
  on public.finance_transactions (account_id)
  where pending;

create table if not exists public.finance_transaction_revisions (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  uuid not null references public.finance_transactions(id) on delete cascade,
  revision        integer not null,
  observed_at     timestamptz not null default now(),
  prior           jsonb not null,
  current         jsonb not null,
  unique (transaction_id, revision)
);

-- ---------------------------------------------------------------------------
-- Balance history.
-- ---------------------------------------------------------------------------

create table if not exists public.finance_balance_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.finance_accounts(id) on delete cascade,
  currency            text not null,
  balance             numeric(20,4),
  available_balance   numeric(20,4),
  -- The provider's own timestamp for the balance, when it sent one.
  provider_balance_at timestamptz,
  observed_at         timestamptz not null default now(),
  -- sha256 over (currency, balance, available_balance, provider_balance_at).
  -- Identical repeats collapse; a corrected value at the same provider
  -- timestamp hashes differently and stays distinguishable.
  content_hash        text not null,
  unique (account_id, content_hash)
);

create index if not exists finance_balance_snapshots_account_idx
  on public.finance_balance_snapshots (account_id, coalesce(provider_balance_at, observed_at) desc);

-- ---------------------------------------------------------------------------
-- Durable jobs.
-- ---------------------------------------------------------------------------

create table if not exists public.finance_jobs (
  id                uuid primary key default gen_random_uuid(),
  merchant_id       uuid not null references public.merchants(id) on delete cascade,
  connection_id     uuid references public.finance_connections(id) on delete cascade,

  kind              text not null check (kind in ('backfill', 'refresh', 'scheduled_sync', 'report')),
  -- Safe parameters only: periods, account ids, formats. Never a credential.
  params            jsonb not null default '{}'::jsonb,

  status            text not null default 'queued'
                      check (status in ('queued', 'running', 'waiting_for_budget', 'partial', 'failed', 'completed', 'cancelled')),
  progress          jsonb not null default '{}'::jsonb,
  result            jsonb,
  error_code        text,
  error_message     text,

  attempts          integer not null default 0,
  max_attempts      integer not null default 8,
  run_after         timestamptz not null default now(),

  lease_owner       text,
  lease_expires_at  timestamptz,
  -- Bumped on every claim. A worker commits only where the version still
  -- matches the one it was handed; a stale worker's write matches zero rows.
  lease_version     integer not null default 0,

  cancel_requested  boolean not null default false,
  idempotency_key   text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  started_at        timestamptz,
  finished_at       timestamptz
);

create unique index if not exists finance_jobs_idempotency_idx
  on public.finance_jobs (merchant_id, kind, idempotency_key)
  where idempotency_key is not null;

create index if not exists finance_jobs_due_idx
  on public.finance_jobs (run_after)
  where status in ('queued', 'waiting_for_budget');

create index if not exists finance_jobs_running_idx
  on public.finance_jobs (lease_expires_at)
  where status = 'running';

create index if not exists finance_jobs_merchant_idx
  on public.finance_jobs (merchant_id, created_at desc);

create index if not exists finance_jobs_connection_active_idx
  on public.finance_jobs (connection_id)
  where status in ('queued', 'running', 'waiting_for_budget');

-- One provider request, one row. Counted over a rolling 24 hours per
-- credential; interactive and background work draw on the same budget.
create table if not exists public.finance_request_usage (
  id             uuid primary key default gen_random_uuid(),
  connection_id  uuid not null references public.finance_connections(id) on delete cascade,
  job_id         uuid references public.finance_jobs(id) on delete set null,
  request_class  text not null check (request_class in ('interactive', 'background')),
  outcome        text,
  requested_at   timestamptz not null default now()
);

create index if not exists finance_request_usage_window_idx
  on public.finance_request_usage (connection_id, requested_at desc);

-- What was asked for and what came back, per account. Coverage is derived
-- from these rows, never from HTTP status or from the data itself.
create table if not exists public.finance_fetch_windows (
  id                     uuid primary key default gen_random_uuid(),
  job_id                 uuid references public.finance_jobs(id) on delete set null,
  connection_id          uuid not null references public.finance_connections(id) on delete cascade,
  source_connection_id   uuid references public.finance_source_connections(id) on delete cascade,
  -- NULL for the credential-level record of the request itself.
  account_id             uuid references public.finance_accounts(id) on delete cascade,

  requested_start        timestamptz not null,
  requested_end          timestamptz not null,
  observed_first_posted  timestamptz,
  observed_last_posted   timestamptz,

  rows_returned          integer not null default 0,
  rows_rejected          integer not null default 0,
  capped                 boolean not null default false,
  warnings               jsonb not null default '[]'::jsonb,

  outcome                text not null check (outcome in ('fetched', 'partial', 'failed')),
  fetched_at             timestamptz not null default now()
);

create index if not exists finance_fetch_windows_account_idx
  on public.finance_fetch_windows (account_id, requested_start, requested_end)
  where account_id is not null;

create index if not exists finance_fetch_windows_connection_idx
  on public.finance_fetch_windows (connection_id, fetched_at desc);

-- ---------------------------------------------------------------------------
-- Reports.
-- ---------------------------------------------------------------------------

create table if not exists public.finance_reports (
  id                      uuid primary key default gen_random_uuid(),
  merchant_id             uuid not null references public.merchants(id) on delete cascade,
  job_id                  uuid references public.finance_jobs(id) on delete set null,

  revision                integer not null default 1,
  supersedes_report_id    uuid references public.finance_reports(id) on delete set null,
  superseded_by_report_id uuid,

  period_kind             text not null check (period_kind in ('month', 'quarter', 'custom')),
  period_selector         text not null,
  period_label            text not null,
  timezone                text not null,
  requested_start         timestamptz not null,
  requested_end           timestamptz not null,
  effective_end           timestamptz not null,
  period_to_date          boolean not null default false,
  cutoff                  timestamptz not null,

  scope                   text not null default 'all' check (scope in ('all', 'business', 'personal')),
  -- The frozen account list. Resolved once from scope/selection/hidden flags.
  account_ids             uuid[] not null,
  include_hidden          boolean not null default false,
  include_pending         boolean not null default true,
  strict                  boolean not null default false,

  status                  text not null default 'queued'
                            check (status in ('queued', 'generating', 'ready', 'failed', 'superseded', 'deleted')),
  local_export_complete   boolean,
  provider_coverage       text check (provider_coverage in ('unknown', 'partial', 'available_window_fetched')),
  reconciliation_status   text not null default 'not_attempted'
                            check (reconciliation_status in ('not_attempted', 'unavailable', 'mismatch', 'user_reconciled')),

  -- The canonical dataset: accounts, posted rows, pending rows, per-currency
  -- totals as decimal strings. Every artifact is derived from this.
  dataset                 jsonb,
  dataset_hash            text,
  row_count               integer,
  pending_count           integer,
  totals                  jsonb,
  warnings                jsonb not null default '[]'::jsonb,
  renderer_version        text,
  error_code              text,
  error_message           text,
  idempotency_key         text,

  created_at              timestamptz not null default now(),
  generated_at            timestamptz,
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz
);

create unique index if not exists finance_reports_idempotency_idx
  on public.finance_reports (merchant_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists finance_reports_merchant_idx
  on public.finance_reports (merchant_id, created_at desc);

create index if not exists finance_reports_period_idx
  on public.finance_reports (merchant_id, requested_start, requested_end)
  where status = 'ready';

create table if not exists public.finance_report_artifacts (
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid not null references public.finance_reports(id) on delete cascade,
  format        text not null check (format in ('pdf', 'html', 'csv', 'json')),
  object_key    text not null,
  bytes         bigint not null,
  content_hash  text not null,
  state         text not null default 'staging' check (state in ('staging', 'ready', 'failed', 'deleted')),
  created_at    timestamptz not null default now(),
  unique (report_id, format)
);

-- ---------------------------------------------------------------------------
-- Imported statements and reconciliation evidence.
-- ---------------------------------------------------------------------------

create table if not exists public.finance_statements (
  id                 uuid primary key default gen_random_uuid(),
  merchant_id        uuid not null references public.merchants(id) on delete cascade,
  account_id         uuid not null references public.finance_accounts(id) on delete cascade,

  institution_label  text,
  cycle              text not null default 'monthly' check (cycle in ('monthly', 'quarterly', 'custom')),
  -- The statement's own period as the user entered it, [period_start, period_end).
  period_start       date not null,
  period_end         date not null,
  timezone           text not null,
  notes              text,

  original_filename  text,
  content_type       text not null default 'application/pdf',
  bytes              bigint not null,
  content_hash       text not null,
  object_key         text not null,
  key_version        integer not null default 1,

  scan_state         text not null default 'quarantined' check (scan_state in ('quarantined', 'clean', 'rejected')),
  scan_reason        text,
  -- What we know about where it came from. Only ever 'user_supplied' in v1.
  provenance         text not null default 'user_supplied',

  state              text not null default 'active' check (state in ('active', 'deleted')),
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  check (period_end > period_start)
);

create index if not exists finance_statements_lookup_idx
  on public.finance_statements (merchant_id, account_id, period_start desc)
  where state = 'active';

create index if not exists finance_statements_hash_idx
  on public.finance_statements (merchant_id, content_hash)
  where state = 'active';

create table if not exists public.finance_reconciliations (
  id                   uuid primary key default gen_random_uuid(),
  merchant_id          uuid not null references public.merchants(id) on delete cascade,
  statement_id         uuid not null references public.finance_statements(id) on delete cascade,
  account_id           uuid not null references public.finance_accounts(id) on delete cascade,
  report_id            uuid not null references public.finance_reports(id) on delete cascade,

  currency             text not null,
  -- Exactly what the user typed, before any sign normalisation.
  entered_opening      text not null,
  entered_closing      text not null,
  entered_credits      text,
  entered_debits       text,
  sign_convention      text not null check (sign_convention in ('as_stated', 'liability_positive')),
  normalized_opening   text not null,
  normalized_closing   text not null,
  expected_closing     text not null,
  difference           text not null,

  state                text not null
                         check (state in ('matched', 'mismatch', 'unavailable', 'user_reconciled', 'invalidated')),
  acknowledged         boolean not null default false,
  actor_merchant_id    uuid,
  dataset_hash         text,
  version              integer not null default 1,
  created_at           timestamptz not null default now(),
  invalidated_at       timestamptz
);

create index if not exists finance_reconciliations_statement_idx
  on public.finance_reconciliations (statement_id, created_at desc);

-- Metadata-only audit trail. No amounts, no descriptions, no file names.
create table if not exists public.finance_audit_events (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references public.merchants(id) on delete cascade,
  action       text not null,
  object_type  text not null,
  object_id    uuid,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists finance_audit_events_merchant_idx
  on public.finance_audit_events (merchant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Functions.
-- ---------------------------------------------------------------------------

-- Claim one due job for a worker. Due = queued/waiting and past run_after,
-- or running with an expired lease (its worker died). SKIP LOCKED lets
-- several workers poll without contending; the returned lease_version is the
-- fence every subsequent write must carry.
create or replace function public.finance_claim_job(
  p_worker         text,
  p_lease_seconds  integer default 300,
  p_kinds          text[]  default null
)
returns setof public.finance_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select j.id into v_id
    from public.finance_jobs j
   where j.cancel_requested = false
     and (
       (j.status in ('queued', 'waiting_for_budget') and j.run_after <= now())
       or (j.status = 'running' and j.lease_expires_at is not null and j.lease_expires_at < now())
     )
     and (p_kinds is null or j.kind = any(p_kinds))
   order by j.run_after asc, j.created_at asc
   for update skip locked
   limit 1;

  if v_id is null then
    return;
  end if;

  return query
    update public.finance_jobs
       set status           = 'running',
           lease_owner      = p_worker,
           lease_expires_at = now() + make_interval(secs => p_lease_seconds),
           lease_version    = lease_version + 1,
           attempts         = attempts + 1,
           started_at       = coalesce(started_at, now()),
           updated_at       = now()
     where id = v_id
     returning *;
end;
$$;

-- The report snapshot. One statement, one Postgres snapshot: the rows,
-- their count and the per-currency totals all describe the same instant, and
-- the totals are summed as numeric and returned as text so no double ever
-- touches them. Accounts not owned by p_merchant are simply absent — the
-- caller compares the returned account list with what it asked for.
create or replace function public.finance_report_dataset(
  p_merchant        uuid,
  p_account_ids     uuid[],
  p_start           timestamptz,
  p_end             timestamptz,
  p_include_pending boolean default true
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with owned as (
    select a.id, a.connection_id, a.source_connection_id, a.external_id,
           a.org_name, a.org_domain, a.name, a.currency,
           a.balance::text as balance, a.available_balance::text as available_balance,
           a.balance_date, a.kind, a.kind_override, a.scope_override, a.is_hidden,
           a.identity_state
      from public.finance_accounts a
      join public.finance_connections c on c.id = a.connection_id
     where c.merchant_id = p_merchant
       and a.id = any(p_account_ids)
  ),
  posted as (
    select t.id, t.account_id, t.external_id, t.posted, t.transacted_at,
           t.amount::text as amount, t.description, t.payee, t.memo, t.mcc,
           t.category, t.revision
      from public.finance_transactions t
      join owned a on a.id = t.account_id
     where t.pending = false
       and t.posted >= p_start
       and t.posted <  p_end
  ),
  pend as (
    select t.id, t.account_id, t.external_id, t.posted, t.transacted_at,
           t.amount::text as amount, t.description, t.payee, t.memo, t.mcc,
           t.category, t.revision
      from public.finance_transactions t
      join owned a on a.id = t.account_id
     where p_include_pending
       and t.pending = true
       and (
         (t.posted is null and (t.transacted_at is null or (t.transacted_at >= p_start and t.transacted_at < p_end)))
         or (t.posted is not null and t.posted >= p_start and t.posted < p_end)
       )
  ),
  totals as (
    select a.currency,
           sum(case when t.amount > 0 then t.amount else 0 end)::text  as credits,
           sum(case when t.amount < 0 then -t.amount else 0 end)::text as debits,
           sum(t.amount)::text                                          as net,
           count(*)::integer                                            as rows
      from public.finance_transactions t
      join owned a on a.id = t.account_id
     where t.pending = false
       and t.posted >= p_start
       and t.posted <  p_end
     group by a.currency
  ),
  account_totals as (
    select t.account_id,
           sum(case when t.amount > 0 then t.amount else 0 end)::text  as credits,
           sum(case when t.amount < 0 then -t.amount else 0 end)::text as debits,
           sum(t.amount)::text                                          as net,
           count(*)::integer                                            as rows
      from public.finance_transactions t
      join owned a on a.id = t.account_id
     where t.pending = false
       and t.posted >= p_start
       and t.posted <  p_end
     group by t.account_id
  )
  select jsonb_build_object(
    'snapshot_at',   now(),
    'accounts',      (select coalesce(jsonb_agg(to_jsonb(o) order by o.org_name, o.name, o.id), '[]'::jsonb) from owned o),
    'posted',        (select coalesce(jsonb_agg(to_jsonb(p) order by p.posted, p.id), '[]'::jsonb) from posted p),
    'pending',       (select coalesce(jsonb_agg(to_jsonb(q) order by q.transacted_at, q.id), '[]'::jsonb) from pend q),
    'totals',        (select coalesce(jsonb_agg(to_jsonb(t) order by t.currency), '[]'::jsonb) from totals t),
    'account_totals',(select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from account_totals x),
    'posted_count',  (select count(*) from posted),
    'pending_count', (select count(*) from pend)
  );
$$;

-- ---------------------------------------------------------------------------
-- Access.
-- ---------------------------------------------------------------------------

alter table public.finance_settings              enable row level security;
alter table public.finance_source_connections    enable row level security;
alter table public.finance_transaction_revisions enable row level security;
alter table public.finance_balance_snapshots     enable row level security;
alter table public.finance_jobs                  enable row level security;
alter table public.finance_request_usage         enable row level security;
alter table public.finance_fetch_windows         enable row level security;
alter table public.finance_reports               enable row level security;
alter table public.finance_report_artifacts      enable row level security;
alter table public.finance_statements            enable row level security;
alter table public.finance_reconciliations       enable row level security;
alter table public.finance_audit_events          enable row level security;

revoke all on public.finance_settings              from public, anon, authenticated;
revoke all on public.finance_source_connections    from public, anon, authenticated;
revoke all on public.finance_transaction_revisions from public, anon, authenticated;
revoke all on public.finance_balance_snapshots     from public, anon, authenticated;
revoke all on public.finance_jobs                  from public, anon, authenticated;
revoke all on public.finance_request_usage         from public, anon, authenticated;
revoke all on public.finance_fetch_windows         from public, anon, authenticated;
revoke all on public.finance_reports               from public, anon, authenticated;
revoke all on public.finance_report_artifacts      from public, anon, authenticated;
revoke all on public.finance_statements            from public, anon, authenticated;
revoke all on public.finance_reconciliations       from public, anon, authenticated;
revoke all on public.finance_audit_events          from public, anon, authenticated;

grant select, insert, update, delete on public.finance_settings              to service_role;
grant select, insert, update, delete on public.finance_source_connections    to service_role;
grant select, insert, update, delete on public.finance_transaction_revisions to service_role;
grant select, insert, update, delete on public.finance_balance_snapshots     to service_role;
grant select, insert, update, delete on public.finance_jobs                  to service_role;
grant select, insert, update, delete on public.finance_request_usage         to service_role;
grant select, insert, update, delete on public.finance_fetch_windows         to service_role;
grant select, insert, update, delete on public.finance_reports               to service_role;
grant select, insert, update, delete on public.finance_report_artifacts      to service_role;
grant select, insert, update, delete on public.finance_statements            to service_role;
grant select, insert, update, delete on public.finance_reconciliations       to service_role;
grant select, insert, update, delete on public.finance_audit_events          to service_role;

revoke all on function public.finance_claim_job(text, integer, text[]) from public, anon, authenticated;
revoke all on function public.finance_report_dataset(uuid, uuid[], timestamptz, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.finance_claim_job(text, integer, text[]) to service_role;
grant execute on function public.finance_report_dataset(uuid, uuid[], timestamptz, timestamptz, boolean) to service_role;
