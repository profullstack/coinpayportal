-- Security advisory remediations (draft advisories, 2026-08-15)
--
-- Database half of the application fixes. Each block names the advisory it
-- closes. Everything here is idempotent so it is safe to re-run.

-- =====================================================
-- P-013 — GHSA-qpc3-wrv5-fphr
-- Escrow release/beneficiary tokens readable via RLS
--
-- The escrows SELECT policy returns the whole row, and two of its columns are
-- bearer credentials that release or refund the funds. RLS is row-level: the
-- only way to keep specific columns out of a policy that legitimately returns
-- the row is a column-level privilege. Application code reads these through
-- service_role, which is unaffected.
-- =====================================================
REVOKE SELECT (release_token, beneficiary_token) ON public.escrows FROM authenticated;
REVOKE SELECT (release_token, beneficiary_token) ON public.escrows FROM anon;

COMMENT ON COLUMN public.escrows.release_token IS
  'Bearer credential that releases the escrow. SELECT is revoked from anon/authenticated: '
  'reachable only via service_role in the API layer. Never return it in a listing.';
COMMENT ON COLUMN public.escrows.beneficiary_token IS
  'Bearer credential for the beneficiary. SELECT is revoked from anon/authenticated.';

-- =====================================================
-- P-014 — GHSA-cj6r-hxrr-9cc6
-- Issuer API key (cprt_*) stored and exposed in clear
--
-- The original schema had api_key_hash; a later migration added a raw api_key
-- column and the lookup moved to it, so the at-rest protection was bypassed and
-- the SELECT policy handed the key back. Restore the hash column, keep the raw
-- column readable only by service_role, and let the application migrate rows
-- lazily (it writes the hash on next use).
-- =====================================================
ALTER TABLE public.reputation_issuers ADD COLUMN IF NOT EXISTS api_key_hash text;

CREATE INDEX IF NOT EXISTS idx_reputation_issuers_api_key_hash
  ON public.reputation_issuers (api_key_hash);

REVOKE SELECT (api_key) ON public.reputation_issuers FROM authenticated;
REVOKE SELECT (api_key) ON public.reputation_issuers FROM anon;

COMMENT ON COLUMN public.reputation_issuers.api_key IS
  'DEPRECATED raw key, retained only so existing issuers keep working. SELECT is revoked '
  'from anon/authenticated. New lookups use api_key_hash; drop this column once every row '
  'has a hash.';
COMMENT ON COLUMN public.reputation_issuers.api_key_hash IS
  'HMAC-SHA256 of the raw cprt_* key. This is what authentication compares against.';

-- =====================================================
-- V-013 — GHSA-9m6j-hhgw-wg2c
-- Double escrow settlement
--
-- The settle route claims an escrow by moving settlement_started_at off NULL
-- before it broadcasts anything, so two concurrent settles cannot both send.
-- =====================================================
ALTER TABLE public.escrows ADD COLUMN IF NOT EXISTS settlement_started_at timestamptz;

COMMENT ON COLUMN public.escrows.settlement_started_at IS
  'Set by the compare-and-swap that claims an escrow for settlement. Non-NULL means a '
  'settlement is in flight or finished; the claim is only released when settlement aborts '
  'before broadcasting.';

-- =====================================================
-- V-005 — GHSA-2r3m-mqrc-fg2f
-- Subscription confirmed without payment (NULL crypto_amount)
--
-- The application now quotes and persists crypto_amount at creation. This is
-- the backstop: a row with a missing or non-positive amount is rejected by the
-- database, so the NaN comparison that let a zero-balance payment confirm can
-- never be reconstructed by another code path.
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'business_collection_payments_crypto_amount_positive'
  ) THEN
    -- NOT VALID so pre-existing bad rows do not block the migration; they are
    -- already refused at confirmation time by the application guard.
    ALTER TABLE public.business_collection_payments
      ADD CONSTRAINT business_collection_payments_crypto_amount_positive
      CHECK (crypto_amount IS NULL OR crypto_amount > 0) NOT VALID;
  END IF;
END $$;

-- =====================================================
-- N-004 — GHSA-hh2j-qg47-8x77
-- No upper bound on payment amount
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_amount_within_bounds'
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_amount_within_bounds
      CHECK (amount > 0 AND amount <= 1000000) NOT VALID;
  END IF;
END $$;

-- =====================================================
-- P-008 — GHSA-53xp-gvx8-xf32
-- Public widget without auth
--
-- Lets a merchant restrict which origins may embed their widget. NULL/empty
-- preserves today's open behaviour so no existing embed breaks.
-- =====================================================
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS widget_allowed_origins text[];

COMMENT ON COLUMN public.merchants.widget_allowed_origins IS
  'Origins permitted to call /api/payments/widget/create for this merchant, e.g. '
  '{"https://shop.example.com"}. NULL or empty keeps the endpoint open (default). '
  'When set, other origins are refused with 403 — not merely blocked by CORS, which '
  'only constrains browsers.';

-- =====================================================
-- P-010 — GHSA-h69g-q79g-wj69
-- Invoice marked paid with a forged tx_hash
--
-- Out-of-band settlement is a real merchant action, so it is recorded as what
-- it is instead of being disguised as an on-chain transaction.
-- =====================================================
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS settlement_method text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS marked_paid_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_settlement_method_known'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_settlement_method_known
      CHECK (settlement_method IS NULL OR settlement_method IN ('manual', 'onchain', 'stripe', 'lightning'))
      NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN public.invoices.settlement_method IS
  'How the invoice was settled. ''manual'' means a merchant recorded an off-platform '
  'payment; the payment rail did not run and no tx_hash is implied.';
COMMENT ON COLUMN public.invoices.marked_paid_by IS
  'Merchant who recorded a manual settlement. Set only when settlement_method = ''manual''.';

-- =====================================================
-- P-011 — GHSA-fpf9-hcrc-fw8m
-- Double payout on ambiguous broadcast retry
--
-- A send that times out after the node accepted the transaction is not a
-- failure — it is an unknown. Retrying an unknown pays twice, so it gets its
-- own terminal-until-reviewed state.
-- =====================================================
ALTER TABLE public.affiliate_payouts DROP CONSTRAINT IF EXISTS affiliate_payouts_status_check;

ALTER TABLE public.affiliate_payouts
  ADD CONSTRAINT affiliate_payouts_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'indeterminate'));

COMMENT ON COLUMN public.affiliate_payouts.status IS
  'Payout status: pending, processing, completed, failed, indeterminate. '
  '''indeterminate'' means the broadcast outcome is unknown (timeout after send) — it is '
  'never retried automatically; a human must check the chain first.';

-- =====================================================
-- P-006 — GHSA-7v2w-w2g6-j5gm
-- TOCTOU on the monthly transaction limit
--
-- The limit check and the usage increment were two round trips, so concurrent
-- payment creations all passed the check before any of them incremented. This
-- does both in one statement: the increment only happens if it stays within
-- the limit, and the caller is told which way it went.
-- =====================================================
CREATE OR REPLACE FUNCTION public.consume_transaction_quota(
  p_merchant_id UUID,
  p_limit INTEGER
)
RETURNS TABLE (allowed BOOLEAN, new_count INTEGER)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_year_month TEXT;
  v_count INTEGER;
BEGIN
  v_year_month := TO_CHAR(NOW(), 'YYYY-MM');

  -- NULL limit means unlimited: always increment, always allow.
  IF p_limit IS NULL THEN
    INSERT INTO public.monthly_usage (merchant_id, year_month, transaction_count)
    VALUES (p_merchant_id, v_year_month, 1)
    ON CONFLICT (merchant_id, year_month)
    DO UPDATE SET
      transaction_count = public.monthly_usage.transaction_count + 1,
      updated_at = NOW()
    RETURNING public.monthly_usage.transaction_count INTO v_count;

    RETURN QUERY SELECT TRUE, v_count;
    RETURN;
  END IF;

  -- Bounded increment. The WHERE clause on the DO UPDATE makes the check and
  -- the increment a single atomic statement: a row already at the limit is not
  -- updated, and the conflicting concurrent transaction sees the committed
  -- value rather than a stale read.
  INSERT INTO public.monthly_usage (merchant_id, year_month, transaction_count)
  VALUES (p_merchant_id, v_year_month, 1)
  ON CONFLICT (merchant_id, year_month)
  DO UPDATE SET
    transaction_count = public.monthly_usage.transaction_count + 1,
    updated_at = NOW()
  WHERE public.monthly_usage.transaction_count < p_limit
  RETURNING public.monthly_usage.transaction_count INTO v_count;

  IF v_count IS NULL THEN
    -- No row was written: the merchant is at or over the limit.
    SELECT mu.transaction_count INTO v_count
    FROM public.monthly_usage mu
    WHERE mu.merchant_id = p_merchant_id AND mu.year_month = v_year_month;

    RETURN QUERY SELECT FALSE, COALESCE(v_count, 0);
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, v_count;
END;
$$;

COMMENT ON FUNCTION public.consume_transaction_quota(UUID, INTEGER) IS
  'Atomically checks the monthly transaction limit and increments usage. Returns '
  '(allowed, new_count). Replaces the separate check-then-increment pair, which let '
  'concurrent requests all pass the check before any of them incremented.';

-- Only the API layer (service_role) may spend quota. Leaving this callable by
-- anon/authenticated would let a client burn or inspect another merchant's quota.
REVOKE ALL ON FUNCTION public.consume_transaction_quota(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_transaction_quota(UUID, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.consume_transaction_quota(UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_transaction_quota(UUID, INTEGER) TO service_role;

-- Compensating decrement for a transaction that was counted but not created
-- (validation failed after the quota was spent). Never goes below zero.
CREATE OR REPLACE FUNCTION public.release_transaction_quota(p_merchant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.monthly_usage
  SET transaction_count = GREATEST(transaction_count - 1, 0),
      updated_at = NOW()
  WHERE merchant_id = p_merchant_id
    AND year_month = TO_CHAR(NOW(), 'YYYY-MM')
  RETURNING transaction_count INTO v_count;

  RETURN COALESCE(v_count, 0);
END;
$$;

COMMENT ON FUNCTION public.release_transaction_quota(UUID) IS
  'Returns one unit of monthly quota after a transaction was counted but not created. '
  'Pairs with consume_transaction_quota so a failed request does not bill a merchant.';

REVOKE ALL ON FUNCTION public.release_transaction_quota(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_transaction_quota(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.release_transaction_quota(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.release_transaction_quota(UUID) TO service_role;

-- =====================================================
-- V-032 — GHSA-739j-2g39-m5h8
-- Public landing metrics manipulable
--
-- public_landing_stats() sums payments.amount for every confirmed/forwarded
-- payment, and amount is merchant-declared with no ceiling, so a merchant could
-- inflate the platform's published settled volume with circular self-payments.
--
-- Two bounds, both applied inside the function so they hold no matter which
-- caller publishes the numbers:
--   * per-payment cap, matching the API-level cap added for N-004;
--   * self-payments excluded — a payment whose payee is a wallet registered to
--     the paying business moves no third-party money and is not settled volume.
--
-- Signature, return type, volatility and SECURITY INVOKER are preserved
-- exactly; see 20260804093000 for why INVOKER is deliberate here. Grants are
-- unaffected by CREATE OR REPLACE, so the service_role-only ACL survives.
-- =====================================================
create or replace function public.public_landing_stats()
returns json
language sql
stable
as $$
  with settled as (
    select p.id, p.amount
    from public.payments p
    where p.status in ('confirmed', 'forwarded')
      and p.amount > 0
      -- A single payment cannot dominate the published total.
      and p.amount <= 1000000
      -- Circular self-payment: the payout address is one of the paying
      -- business's own registered wallets.
      and not exists (
        select 1
        from public.business_wallets bw
        where bw.business_id = p.business_id
          and bw.wallet_address = p.merchant_wallet_address
      )
  )
  select json_build_object(
    'payments_settled', (select count(*) from settled),
    'settled_volume_usd', (select coalesce(sum(amount), 0) from settled),
    'active_businesses', (
      select count(*) from public.businesses where active
    )
  );
$$;

comment on function public.public_landing_stats() is
  'Aggregate-only counters rendered on the public landing page. Excludes circular '
  'self-payments and caps any single payment, so the published figures cannot be '
  'inflated by a merchant paying themselves. See src/lib/stats/public-stats.ts.';

-- CREATE OR REPLACE keeps existing grants, but re-assert them so a fresh
-- database ends up with the same service_role-only ACL.
revoke execute on function public.public_landing_stats() from public;
revoke execute on function public.public_landing_stats() from anon;
revoke execute on function public.public_landing_stats() from authenticated;
grant execute on function public.public_landing_stats() to service_role;
