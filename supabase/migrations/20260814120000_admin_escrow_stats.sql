-- Escrow statistics for the admin console.
--
-- Answers "what has this escrow service actually done, all time" in one place:
-- every escrow ever created, where each one stopped in the lifecycle, and how
-- much money is sitting in platform custody right now.
--
-- Three deliberate choices about money:
--
-- 1. `amount`, `deposited_amount` and `fee_amount` are denominated in each
--    chain's own units. Summing them across BTC, SOL and USDC_POL would give a
--    number with no meaning, so every USD figure here comes from `amount_usd`
--    and the chain-unit columns are only ever reported per-row.
-- 2. Created value and settled value are reported separately and never added.
--    An escrow that was quoted but never funded moved no money, and the two
--    figures differ by orders of magnitude on real data: most escrows expire
--    unfunded. A single "escrow volume" number would be dominated by escrows
--    that never existed economically.
-- 3. "Held" is the number an operator of a custodial escrow actually needs:
--    funded, and neither settled nor refunded. `stranded` narrows that to the
--    ones whose window has already closed, which is the set that needs a human
--    or a rescan.
--
-- Status is read from the data rather than assumed. The `escrows_status_check`
-- constraint is NOT VALID and rows exist with statuses outside it (e.g.
-- `settle_failed`), so the per-status breakdown groups over whatever is
-- actually stored and the UI builds its filter from that.

-- One page of escrows for the admin table.
create or replace function public.admin_escrow_stats(
  p_search text default null,
  p_status text default null,
  p_chain text default null,
  p_model text default null,
  p_sort text default 'created_at',
  p_dir text default 'desc',
  p_limit int default 50,
  p_offset int default 0
)
returns json
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  -- Inlined rather than kept as a view so this function stays the single
  -- object to grant, revoke and reason about, matching admin_user_stats().
  c_base constant text := $base$
    select
      e.id,
      e.chain,
      e.status,
      e.escrow_model,
      e.amount,
      e.amount_usd,
      e.deposited_amount,
      e.fee_amount,
      e.escrow_address,
      e.depositor_address,
      e.beneficiary_address,
      e.arbiter_address,
      e.depositor_email,
      e.beneficiary_email,
      e.deposit_tx_hash,
      e.settlement_tx_hash,
      e.dispute_status,
      e.dispute_reason,
      (e.series_id is not null) as in_series,
      e.allow_auto_release,
      coalesce(e.settle_attempts, 0) as settle_attempts,
      e.business_id,
      b.name as business_name,
      m.email as merchant_email,
      e.created_at,
      e.funded_at,
      e.released_at,
      e.settled_at,
      e.disputed_at,
      e.refunded_at,
      e.expires_at,
      -- Lifecycle timings, in hours, null until the milestone happens.
      extract(epoch from (e.funded_at - e.created_at)) / 3600.0  as hours_to_fund,
      extract(epoch from (e.settled_at - e.funded_at)) / 3600.0  as hours_to_settle,
      -- Money the platform is custodying: funded, not yet settled or refunded.
      (e.funded_at is not null and e.settled_at is null and e.refunded_at is null) as is_held,
      -- Held past its own expiry — the set that needs a rescan or a human.
      (e.funded_at is not null and e.settled_at is null and e.refunded_at is null
        and e.expires_at is not null and e.expires_at < now()) as is_stranded
    from escrows e
    left join businesses b on b.id = e.business_id
    left join merchants m on m.id = b.merchant_id
  $base$;

  v_sort_col text;
  v_dir text;
  v_limit int;
  v_offset int;
  v_search text;
  v_status text;
  v_chain text;
  v_model text;
  -- Always the same shape, with null meaning "no filter", so the four
  -- parameters can be bound unconditionally instead of assembled per call.
  c_where constant text :=
    ' where ($2 is null or s.status = $2)'
    || ' and ($3 is null or s.chain = $3)'
    || ' and ($4 is null or s.escrow_model = $4)'
    || ' and ($1 is null or ('
    || '      s.id::text ilike ''%'' || $1 || ''%'''
    || '   or s.escrow_address ilike ''%'' || $1 || ''%'''
    || '   or s.depositor_address ilike ''%'' || $1 || ''%'''
    || '   or s.beneficiary_address ilike ''%'' || $1 || ''%'''
    || '   or coalesce(s.depositor_email, '''') ilike ''%'' || $1 || ''%'''
    || '   or coalesce(s.beneficiary_email, '''') ilike ''%'' || $1 || ''%'''
    || '   or coalesce(s.deposit_tx_hash, '''') ilike ''%'' || $1 || ''%'''
    || '   or coalesce(s.settlement_tx_hash, '''') ilike ''%'' || $1 || ''%'''
    || '   or coalesce(s.business_name, '''') ilike ''%'' || $1 || ''%'''
    || '   or coalesce(s.merchant_email, '''') ilike ''%'' || $1 || ''%'''
    || ' ))';
  v_total bigint;
  v_rows json;
begin
  -- Whitelist, not quote_ident: the caller supplies a sort *key*, never a
  -- column name, so an unrecognised value falls back rather than reaching the
  -- statement text.
  v_sort_col := case p_sort
    when 'created_at'      then 'created_at'
    when 'funded_at'       then 'funded_at'
    when 'settled_at'      then 'settled_at'
    when 'expires_at'      then 'expires_at'
    when 'amount_usd'      then 'amount_usd'
    when 'chain'           then 'chain'
    when 'status'          then 'status'
    when 'escrow_model'    then 'escrow_model'
    when 'business_name'   then 'business_name'
    when 'settle_attempts' then 'settle_attempts'
    when 'hours_to_fund'   then 'hours_to_fund'
    when 'hours_to_settle' then 'hours_to_settle'
    else 'created_at'
  end;

  v_dir    := case when lower(coalesce(p_dir, '')) = 'asc' then 'asc' else 'desc' end;
  v_limit  := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  v_search := nullif(btrim(coalesce(p_search, '')), '');
  v_status := nullif(btrim(coalesce(p_status, '')), '');
  v_chain  := nullif(btrim(coalesce(p_chain, '')), '');
  v_model  := nullif(btrim(coalesce(p_model, '')), '');

  execute format('select count(*) from (%s) s %s', c_base, c_where)
    into v_total
    using v_search, v_status, v_chain, v_model;

  -- The id tiebreak keeps pagination stable when the sort column ties, which
  -- it does constantly: most escrows share a status and never funded.
  execute format(
    'select coalesce(json_agg(row_to_json(t)), ''[]''::json) from ('
      || 'select * from (%s) s %s order by s.%I %s nulls last, s.id asc limit %s offset %s'
    || ') t',
    c_base, c_where, v_sort_col, v_dir, v_limit, v_offset
  )
    into v_rows
    using v_search, v_status, v_chain, v_model;

  return json_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset, 'rows', v_rows);
end;
$fn$;

comment on function public.admin_escrow_stats(text, text, text, text, text, text, int, int) is
  'One page of escrows for the admin console, with lifecycle timings and custody '
  'flags. Admin-gated in the application layer (src/lib/auth/admin-guard.ts); '
  'service_role only here. Chain-unit amounts are per-row and never summed.';

-- All-time totals and breakdowns for the header of the same page. Deliberately
-- a separate function: none of it varies with the table's search or filters, so
-- folding it in would recompute a constant on every keystroke.
create or replace function public.admin_escrow_summary()
returns json
language sql
stable
security invoker
set search_path = public
as $fn$
  with e as (
    select
      *,
      (funded_at is not null and settled_at is null and refunded_at is null) as is_held
    from escrows
  ),
  totals as (
    select
      count(*)                                                as escrows_total,
      min(created_at)                                         as first_created_at,
      max(created_at)                                         as last_created_at,
      count(*) filter (where funded_at is not null)           as ever_funded,
      -- `settled_at` means a settlement transaction was sent, which happens on
      -- a refund as well as a release — 'disbursed' is the honest name for it.
      -- Where the money went is a question for `status`, below.
      count(*) filter (where settled_at is not null)          as ever_disbursed,
      count(*) filter (where released_at is not null)         as ever_released,
      count(*) filter (where disputed_at is not null)         as ever_disputed,
      count(*) filter (where status = 'settled')              as status_settled,
      count(*) filter (where status = 'refunded')             as status_refunded,
      count(*) filter (where status = 'expired')              as expired,
      count(*) filter (where is_held)                         as held_count,
      count(*) filter (where is_held and expires_at is not null and expires_at < now())
                                                              as stranded_count,
      count(*) filter (where dispute_status in ('open', 'under_review'))
                                                              as disputes_open,
      count(*) filter (where series_id is not null)           as in_series,
      count(*) filter (where allow_auto_release)              as auto_release,
      count(*) filter (where business_id is not null)         as with_business,
      count(distinct business_id)                             as businesses,
      count(*) filter (where created_at >= now() - interval '30 days')  as created_30d,
      count(*) filter (where settled_at >= now() - interval '30 days')  as settled_30d,
      -- Value quoted at creation. Includes escrows that never funded, so this
      -- is demand, not money, and is never added to the settled figure.
      coalesce(sum(amount_usd), 0)                                      as created_value_usd,
      coalesce(sum(amount_usd) filter (where funded_at is not null), 0) as funded_value_usd,
      -- Everything that left escrow, and where it went. The split is by status
      -- rather than by timestamp so the two halves reconcile exactly:
      -- released_value_usd + refunded_value_usd = disbursed_value_usd.
      coalesce(sum(amount_usd) filter (where settled_at is not null), 0)   as disbursed_value_usd,
      coalesce(sum(amount_usd) filter (where status = 'settled'), 0)       as released_value_usd,
      coalesce(sum(amount_usd) filter (where status = 'refunded'), 0)      as refunded_value_usd,
      coalesce(sum(amount_usd) filter (where is_held), 0)               as held_value_usd,
      coalesce(max(amount_usd), 0)                                      as largest_usd,
      coalesce(percentile_cont(0.5) within group (order by amount_usd), 0) as median_usd,
      percentile_cont(0.5) within group (
        order by extract(epoch from (funded_at - created_at)) / 3600.0
      )                                                                 as median_hours_to_fund,
      percentile_cont(0.5) within group (
        order by extract(epoch from (settled_at - funded_at)) / 3600.0
      )                                                                 as median_hours_to_settle
    from e
  ),
  by_status as (
    select coalesce(json_agg(row_to_json(r) order by r.total desc, r.status), '[]'::json) as j
    from (
      select status, count(*) as total, coalesce(sum(amount_usd), 0) as value_usd
      from e group by status
    ) r
  ),
  by_chain as (
    select coalesce(json_agg(row_to_json(r) order by r.total desc, r.chain), '[]'::json) as j
    from (
      select chain,
             count(*) as total,
             count(*) filter (where settled_at is not null) as settled,
             coalesce(sum(amount_usd) filter (where settled_at is not null), 0) as settled_usd,
             coalesce(sum(amount_usd) filter (where funded_at is not null
               and settled_at is null and refunded_at is null), 0) as held_usd
      from e group by chain
    ) r
  ),
  by_model as (
    select coalesce(json_agg(row_to_json(r) order by r.total desc, r.escrow_model), '[]'::json) as j
    from (
      select escrow_model,
             count(*) as total,
             count(*) filter (where settled_at is not null) as settled
      from e group by escrow_model
    ) r
  ),
  -- Zero-filled so a month with no escrows is a gap in the chart rather than a
  -- missing point that silently compresses the timeline.
  months as (
    select coalesce(json_agg(row_to_json(r) order by r.month), '[]'::json) as j
    from (
      select to_char(g.m, 'YYYY-MM') as month,
             count(e.id) filter (where date_trunc('month', e.created_at) = g.m) as created,
             count(e.id) filter (where date_trunc('month', e.funded_at)  = g.m) as funded,
             count(e.id) filter (where date_trunc('month', e.settled_at) = g.m) as settled,
             coalesce(sum(e.amount_usd) filter (where date_trunc('month', e.settled_at) = g.m), 0)
               as settled_usd
      from generate_series(
             (select date_trunc('month', min(created_at)) from e),
             date_trunc('month', now()),
             interval '1 month'
           ) g(m)
      left join e on date_trunc('month', e.created_at) = g.m
                  or date_trunc('month', e.funded_at)  = g.m
                  or date_trunc('month', e.settled_at) = g.m
      group by g.m
    ) r
  )
  select json_build_object(
    'escrows_total',           t.escrows_total,
    'first_created_at',        t.first_created_at,
    'last_created_at',         t.last_created_at,
    'ever_funded',             t.ever_funded,
    'ever_disbursed',          t.ever_disbursed,
    'ever_released',           t.ever_released,
    'ever_disputed',           t.ever_disputed,
    'status_settled',          t.status_settled,
    'status_refunded',         t.status_refunded,
    'expired',                 t.expired,
    'held_count',              t.held_count,
    'stranded_count',          t.stranded_count,
    'disputes_open',           t.disputes_open,
    'in_series',               t.in_series,
    'auto_release',            t.auto_release,
    'with_business',           t.with_business,
    'businesses',              t.businesses,
    'created_30d',             t.created_30d,
    'settled_30d',             t.settled_30d,
    'created_value_usd',       t.created_value_usd,
    'funded_value_usd',        t.funded_value_usd,
    'disbursed_value_usd',     t.disbursed_value_usd,
    'released_value_usd',      t.released_value_usd,
    'refunded_value_usd',      t.refunded_value_usd,
    'held_value_usd',          t.held_value_usd,
    'largest_usd',             t.largest_usd,
    'median_usd',              t.median_usd,
    'median_hours_to_fund',    t.median_hours_to_fund,
    'median_hours_to_settle',  t.median_hours_to_settle,
    'by_status',               (select j from by_status),
    'by_chain',                (select j from by_chain),
    'by_model',                (select j from by_model),
    'months',                  (select j from months)
  )
  from totals t;
$fn$;

comment on function public.admin_escrow_summary() is
  'All-time escrow totals, lifecycle funnel, per-chain and per-status breakdowns '
  'and a monthly history for the admin console header. service_role only. '
  'Created value and settled value are separate figures and must not be added.';

-- Both functions read every escrow on the platform — counterparty addresses,
-- emails and dispute text included — so neither is reachable from a browser.
-- They are called server-side with the service role, behind requireAdmin().
--
-- `revoke ... from public` alone is not enough here: Supabase's default
-- privileges grant EXECUTE on new public-schema functions directly to `anon`
-- and `authenticated`, and a revoke from PUBLIC does not remove a grant held
-- by a named role. Both roles are therefore revoked explicitly, the same way
-- public_landing_stats() is locked down.
--
-- Being `security invoker` is the backstop rather than the lock: an anon
-- caller would run under anon's own privileges and RLS on `escrows` would
-- return nothing. Revoking as well means the call fails outright instead of
-- quietly returning an empty page that looks like real data.
revoke all on function public.admin_escrow_stats(text, text, text, text, text, text, int, int) from public, anon, authenticated;
revoke all on function public.admin_escrow_summary() from public, anon, authenticated;
grant execute on function public.admin_escrow_stats(text, text, text, text, text, text, int, int) to service_role;
grant execute on function public.admin_escrow_summary() to service_role;
