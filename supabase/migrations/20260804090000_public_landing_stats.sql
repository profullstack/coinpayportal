-- Aggregate counters for the public landing page.
--
-- The homepage previously hardcoded its hero numbers (47K+ transactions,
-- 1,200+ merchants, $8.2M+ volume, 45+ countries). None were derived from
-- anything, and all had drifted 9x-720x away from reality. This function is
-- the source they should have come from.
--
-- Returns aggregates only — no row-level data crosses the boundary, so there
-- is nothing here a visitor could not already infer from the published totals.
--
-- "Settled" means a payment that actually moved money: confirmed on chain, or
-- confirmed and forwarded on to the merchant. Expired payment windows are
-- deliberately excluded — counting them is how you end up claiming 1,743
-- transactions when 544 completed.

create or replace function public.public_landing_stats()
returns json
language sql
stable
as $$
  select json_build_object(
    'payments_settled', (
      select count(*) from public.payments
      where status in ('confirmed', 'forwarded')
    ),
    'settled_volume_usd', (
      select coalesce(sum(amount), 0) from public.payments
      where status in ('confirmed', 'forwarded')
    ),
    'active_businesses', (
      select count(*) from public.businesses where active
    )
  );
$$;

comment on function public.public_landing_stats() is
  'Aggregate-only counters rendered on the public landing page. See src/lib/stats/public-stats.ts.';

-- Called server-side with the service role during ISR revalidation. Not granted
-- to anon/authenticated: there is no reason for a browser to reach it directly,
-- and keeping it server-only means the numbers can only be published through
-- the page that is meant to publish them.
revoke all on function public.public_landing_stats() from public;
grant execute on function public.public_landing_stats() to service_role;
