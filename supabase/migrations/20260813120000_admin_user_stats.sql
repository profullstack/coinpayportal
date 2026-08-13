-- Per-user statistics for the admin console.
--
-- Answers "what is every user actually doing on this platform" in one query:
-- signup, last activity, and their counts and USD volume across the four
-- things a merchant can transact with (crypto payments, invoices, escrows,
-- Stripe).
--
-- Two deliberate choices about money:
--
-- 1. `payments.fee_amount` and `escrows.fee_amount` are denominated in the
--    chain's own units, not USD. Summing them across BTC, ETH, SOL and USDC
--    would produce a number with no meaning, so platform fee revenue is not
--    reported here. `invoices.fee_amount` *is* USD and is reported.
-- 2. `invoices.amount` is mostly USD but a handful of rows are denominated in
--    ETH/USDC_BASE. The USD column filters to `currency = 'USD'` so a 0.05 ETH
--    invoice cannot be added to a $50 one; `invoices_total` still counts every
--    invoice, so the count and the total will legitimately disagree.
--
-- "Settled" matches `public_landing_stats()`: confirmed, or confirmed and
-- forwarded. Expired payment windows are excluded from volume but still
-- counted in `payments_total`, which is what makes the settle rate readable.
--
-- Aggregation is per-merchant in separate CTEs rather than one wide join:
-- joining businesses to payments *and* invoices *and* escrows in a single
-- query fans out the row set and multiplies every count by the cardinality of
-- the other branches.

create or replace function public.admin_user_stats(
  p_search text default null,
  p_sort text default 'last_activity_at',
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
  -- The aggregate is inlined into the dynamic statement below rather than
  -- living in a view, so this function is the single object to grant, revoke
  -- and reason about.
  c_base constant text := $base$
    with biz as (
      select merchant_id,
             count(*) as businesses_count,
             count(*) filter (where active) as active_businesses_count,
             max(created_at) as last_at
      from businesses
      group by merchant_id
    ),
    pay as (
      select b.merchant_id,
             count(*) as payments_total,
             count(*) filter (where p.status in ('confirmed', 'forwarded')) as payments_settled,
             coalesce(sum(p.amount) filter (where p.status in ('confirmed', 'forwarded')), 0) as settled_volume_usd,
             max(p.created_at) as last_at
      from payments p
      join businesses b on b.id = p.business_id
      group by b.merchant_id
    ),
    inv as (
      select user_id as merchant_id,
             count(*) as invoices_total,
             count(*) filter (where status = 'paid') as invoices_paid,
             coalesce(sum(amount) filter (where status = 'paid' and currency = 'USD'), 0) as invoices_paid_usd,
             coalesce(sum(fee_amount) filter (where status = 'paid' and currency = 'USD'), 0) as invoice_fees_usd,
             max(created_at) as last_at
      from invoices
      where user_id is not null
      group by user_id
    ),
    esc as (
      select b.merchant_id,
             count(*) as escrows_total,
             count(*) filter (where e.status = 'settled') as escrows_settled,
             coalesce(sum(e.amount_usd) filter (where e.status = 'settled'), 0) as escrow_volume_usd,
             max(e.created_at) as last_at
      from escrows e
      join businesses b on b.id = e.business_id
      group by b.merchant_id
    ),
    stripe as (
      select merchant_id,
             count(*) as stripe_total,
             count(*) filter (where status = 'completed') as stripe_completed,
             -- stripe_transactions.amount is an integer count of minor units.
             coalesce(sum(amount) filter (where status = 'completed'), 0) / 100.0 as stripe_volume_usd,
             max(created_at at time zone 'UTC') as last_at
      from stripe_transactions
      where merchant_id is not null
      group by merchant_id
    )
    select
      m.id,
      m.email,
      m.name,
      m.is_admin,
      m.auth_provider,
      m.subscription_plan_id,
      m.subscription_status,
      m.created_at,
      m.last_login_at,
      coalesce(biz.businesses_count, 0)         as businesses_count,
      coalesce(biz.active_businesses_count, 0)  as active_businesses_count,
      coalesce(pay.payments_total, 0)           as payments_total,
      coalesce(pay.payments_settled, 0)         as payments_settled,
      coalesce(pay.settled_volume_usd, 0)       as settled_volume_usd,
      coalesce(inv.invoices_total, 0)           as invoices_total,
      coalesce(inv.invoices_paid, 0)            as invoices_paid,
      coalesce(inv.invoices_paid_usd, 0)        as invoices_paid_usd,
      coalesce(inv.invoice_fees_usd, 0)         as invoice_fees_usd,
      coalesce(esc.escrows_total, 0)            as escrows_total,
      coalesce(esc.escrows_settled, 0)          as escrows_settled,
      coalesce(esc.escrow_volume_usd, 0)        as escrow_volume_usd,
      coalesce(stripe.stripe_total, 0)          as stripe_total,
      coalesce(stripe.stripe_completed, 0)      as stripe_completed,
      coalesce(stripe.stripe_volume_usd, 0)     as stripe_volume_usd,
      coalesce(pay.settled_volume_usd, 0)
        + coalesce(inv.invoices_paid_usd, 0)
        + coalesce(esc.escrow_volume_usd, 0)
        + coalesce(stripe.stripe_volume_usd, 0) as total_volume_usd,
      -- greatest() ignores NULLs in Postgres, so a user who has never logged
      -- in still reports their most recent transaction.
      greatest(m.last_login_at, biz.last_at, pay.last_at, inv.last_at, esc.last_at, stripe.last_at)
        as last_activity_at
    from merchants m
    left join biz    on biz.merchant_id    = m.id
    left join pay    on pay.merchant_id    = m.id
    left join inv    on inv.merchant_id    = m.id
    left join esc    on esc.merchant_id    = m.id
    left join stripe on stripe.merchant_id = m.id
  $base$;

  v_sort_col text;
  v_dir text;
  v_limit int;
  v_offset int;
  v_search text;
  v_where text;
  v_total bigint;
  v_rows json;
begin
  -- Whitelist, not quote_ident: the caller supplies a sort *key*, never a
  -- column name, so an unrecognised value falls back rather than reaching the
  -- statement text.
  v_sort_col := case p_sort
    when 'email'              then 'email'
    when 'name'               then 'name'
    when 'created_at'         then 'created_at'
    when 'last_login_at'      then 'last_login_at'
    when 'last_activity_at'   then 'last_activity_at'
    when 'businesses_count'   then 'businesses_count'
    when 'payments_total'     then 'payments_total'
    when 'payments_settled'   then 'payments_settled'
    when 'settled_volume_usd' then 'settled_volume_usd'
    when 'invoices_total'     then 'invoices_total'
    when 'invoices_paid_usd'  then 'invoices_paid_usd'
    when 'escrows_total'      then 'escrows_total'
    when 'stripe_volume_usd'  then 'stripe_volume_usd'
    when 'total_volume_usd'   then 'total_volume_usd'
    else 'last_activity_at'
  end;

  v_dir    := case when lower(coalesce(p_dir, '')) = 'asc' then 'asc' else 'desc' end;
  v_limit  := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  v_search := nullif(btrim(coalesce(p_search, '')), '');

  v_where := case when v_search is null then '' else
    ' where s.email ilike ''%'' || $1 || ''%'' or coalesce(s.name, '''') ilike ''%'' || $1 || ''%'' '
  end;

  execute format('select count(*) from (%s) s %s', c_base, v_where)
    into v_total
    using v_search;

  -- The id tiebreak keeps pagination stable when the sort column ties, which
  -- it does constantly: most users have zero of everything.
  execute format(
    'select coalesce(json_agg(row_to_json(t)), ''[]''::json) from ('
      || 'select * from (%s) s %s order by s.%I %s nulls last, s.id asc limit %s offset %s'
    || ') t',
    c_base, v_where, v_sort_col, v_dir, v_limit, v_offset
  )
    into v_rows
    using v_search;

  return json_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset, 'rows', v_rows);
end;
$fn$;

comment on function public.admin_user_stats(text, text, text, int, int) is
  'Per-user activity and USD volume for the admin console. Admin-gated in the '
  'application layer (src/lib/auth/admin-guard.ts); service_role only here. '
  'Excludes crypto-denominated fees, which are not summable as USD.';

-- Platform-wide totals for the header of the same page. Deliberately a
-- separate function: these are unaffected by the search filter, so folding
-- them into the paged query would recompute a constant on every keystroke.
create or replace function public.admin_platform_stats()
returns json
language sql
stable
security invoker
set search_path = public
as $fn$
  select json_build_object(
    'users_total',        (select count(*) from merchants),
    'users_new_7d',       (select count(*) from merchants where created_at >= now() - interval '7 days'),
    'users_new_30d',      (select count(*) from merchants where created_at >= now() - interval '30 days'),
    'users_active_30d',   (select count(*) from merchants where last_login_at >= now() - interval '30 days'),
    'businesses_total',   (select count(*) from businesses),
    'businesses_active',  (select count(*) from businesses where active),
    'payments_total',     (select count(*) from payments),
    'payments_settled',   (select count(*) from payments where status in ('confirmed', 'forwarded')),
    'payments_volume_usd',(select coalesce(sum(amount), 0) from payments where status in ('confirmed', 'forwarded')),
    'invoices_total',     (select count(*) from invoices),
    'invoices_paid',      (select count(*) from invoices where status = 'paid'),
    'invoices_paid_usd',  (select coalesce(sum(amount), 0) from invoices where status = 'paid' and currency = 'USD'),
    'escrows_total',      (select count(*) from escrows),
    'escrows_settled',    (select count(*) from escrows where status = 'settled'),
    'escrow_volume_usd',  (select coalesce(sum(amount_usd), 0) from escrows where status = 'settled'),
    'stripe_completed',   (select count(*) from stripe_transactions where status = 'completed'),
    'stripe_volume_usd',  (select coalesce(sum(amount), 0) / 100.0 from stripe_transactions where status = 'completed')
  );
$fn$;

comment on function public.admin_platform_stats() is
  'Platform-wide totals for the admin console header. service_role only.';

-- Both functions read every merchant row on the platform, so neither is
-- reachable by a browser: no grant to anon or authenticated. They are called
-- server-side with the service role, behind requireAdmin().
revoke all on function public.admin_user_stats(text, text, text, int, int) from public;
revoke all on function public.admin_platform_stats() from public;
grant execute on function public.admin_user_stats(text, text, text, int, int) to service_role;
grant execute on function public.admin_platform_stats() to service_role;
