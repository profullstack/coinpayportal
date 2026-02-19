-- Fix function search_path warnings (pin to public schema)
-- Fix overly permissive RLS policies on ln_* and swaps tables

-- ============================================================
-- 1. Fix mutable search_path on functions
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_swaps_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_rate_limits()
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 hour';
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_seen_signatures()
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  DELETE FROM seen_signatures WHERE seen_at < NOW() - INTERVAL '5 minutes';
END;
$$;

CREATE OR REPLACE FUNCTION public.update_ln_offer_aggregates()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE ln_offers SET
    total_received_msat = total_received_msat + NEW.amount_msat,
    payment_count = payment_count + 1,
    last_payment_at = NEW.settled_at
  WHERE id = NEW.offer_id;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 2. Replace overly permissive RLS policies on ln_* tables
--    (was: FOR ALL USING (true) WITH CHECK (true))
--    Replace with: service_role only for writes, merchant-scoped reads
-- ============================================================

-- ln_nodes: merchant-scoped via business_id
DROP POLICY IF EXISTS ln_nodes_service ON ln_nodes;

CREATE POLICY "Merchants can view their own LN nodes"
  ON ln_nodes FOR SELECT
  TO authenticated
  USING (business_id IN (SELECT id FROM businesses WHERE merchant_id = auth.uid()));

CREATE POLICY "Service role full access to ln_nodes"
  ON ln_nodes FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ln_offers: merchant-scoped via business_id
DROP POLICY IF EXISTS ln_offers_service ON ln_offers;

CREATE POLICY "Merchants can view their own LN offers"
  ON ln_offers FOR SELECT
  TO authenticated
  USING (business_id IN (SELECT id FROM businesses WHERE merchant_id = auth.uid()));

CREATE POLICY "Service role full access to ln_offers"
  ON ln_offers FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ln_payments: merchant-scoped via business_id
DROP POLICY IF EXISTS ln_payments_service ON ln_payments;

CREATE POLICY "Merchants can view their own LN payments"
  ON ln_payments FOR SELECT
  TO authenticated
  USING (business_id IN (SELECT id FROM businesses WHERE merchant_id = auth.uid()));

CREATE POLICY "Service role full access to ln_payments"
  ON ln_payments FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- swaps: scoped via wallet ownership
DROP POLICY IF EXISTS "Service role access" ON swaps;

CREATE POLICY "Users can view their own swaps"
  ON swaps FOR SELECT
  TO authenticated
  USING (wallet_id IN (SELECT id FROM wallets WHERE user_id = auth.uid()));

CREATE POLICY "Service role full access to swaps"
  ON swaps FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
