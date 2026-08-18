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
      coalesce(sum(amount_usd), 0)                                      as created_value_usd,
      coalesce(sum(amount_usd) filter (where funded_at is not null), 0) as funded_value_usd,
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
  'All-time escrow totals, lifecycle funnel, per-chain and per-status breakdowns and a monthly history for the admin console header. service_role only. Created value and settled value are separate figures and must not be added.';

revoke all on function public.admin_escrow_summary() from public;
grant execute on function public.admin_escrow_summary() to service_role;
