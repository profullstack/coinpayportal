-- /finances becomes a per-merchant feature rather than house-only tooling.
--
-- The original tables had no owner column at all: one shared connection, every
-- route behind requireAdmin(). That is the wrong shape for a feature each
-- merchant uses with their own SimpleFIN token, so ownership is added here and
-- every query is scoped by it in the application layer.
--
-- Ownership lives only on `finance_connections`. Accounts and transactions
-- reach it by walking connection_id, which they already cascade from — adding
-- a redundant merchant_id to the child tables would create a second source of
-- truth that could disagree with the first after a bad update.
--
-- `created_by` is dropped: it recorded which admin added the shared connection,
-- and `merchant_id` now says who owns it. Two nullable references to
-- `merchants` on one table is an invitation to scope a query by the wrong one.
-- The single existing row has `created_by = null`, so nothing is lost.
--
-- On RLS: these tables stay RLS-enabled with **no policies**, which denies
-- `anon` and `authenticated` outright. That is deliberate and is not a gap.
-- CoinPay authenticates with its own JWT (`JWT_SECRET`, `verifyToken`), not
-- Supabase Auth, so `auth.uid()` is null in every request and a policy written
-- against it would either deny everything or, written loosely, expose one
-- merchant's bank data to another. The service client plus explicit
-- `merchant_id` scoping in the app is the honest boundary here.

alter table public.finance_connections
  add column if not exists merchant_id uuid references public.merchants(id) on delete cascade;

-- Backfill before the not-null constraint. The one existing connection was
-- claimed out of band during development and holds real accounts, so it is
-- assigned to its actual owner rather than deleted.
update public.finance_connections
   set merchant_id = '5d79f032-b9ec-42b6-a34a-577c9ab9688d'
 where merchant_id is null;

alter table public.finance_connections
  alter column merchant_id set not null;

alter table public.finance_connections
  drop column if exists created_by;

-- Every scoped read starts by resolving a merchant's connections.
create index if not exists finance_connections_merchant_idx
  on public.finance_connections (merchant_id);

comment on column public.finance_connections.merchant_id is
  'Owning merchant. Accounts and transactions inherit ownership via connection_id.';
