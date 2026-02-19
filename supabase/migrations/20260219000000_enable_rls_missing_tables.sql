-- Enable RLS on all tables flagged by Supabase security linter
-- These tables are accessed server-side via service_role key, which bypasses RLS.
-- RLS here prevents direct PostgREST (anon key) access.

-- Reputation tables
ALTER TABLE reputation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE reputation_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE reputation_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reputation_issuers ENABLE ROW LEVEL SECURITY;

-- DID tables
ALTER TABLE merchant_dids ENABLE ROW LEVEL SECURITY;
ALTER TABLE did_reputation_events ENABLE ROW LEVEL SECURITY;

-- Stripe tables
ALTER TABLE stripe_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_transactions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Policies: all data access goes through API routes with
-- service_role, so anon gets nothing. Authenticated users
-- can read their own data where applicable.
-- ============================================================

-- reputation_issuers: merchants can view/manage their own issuers
CREATE POLICY "Merchants can view their own issuers"
  ON reputation_issuers FOR SELECT
  TO authenticated
  USING (merchant_id = auth.uid());

CREATE POLICY "Merchants can create issuers"
  ON reputation_issuers FOR INSERT
  TO authenticated
  WITH CHECK (merchant_id = auth.uid());

CREATE POLICY "Merchants can update their own issuers"
  ON reputation_issuers FOR UPDATE
  TO authenticated
  USING (merchant_id = auth.uid());

CREATE POLICY "Merchants can delete their own issuers"
  ON reputation_issuers FOR DELETE
  TO authenticated
  USING (merchant_id = auth.uid());

-- reputation_receipts: public read (receipts are meant to be verifiable), write via service_role only
CREATE POLICY "Anyone can view reputation receipts"
  ON reputation_receipts FOR SELECT
  TO authenticated, anon
  USING (true);

-- reputation_credentials: public read (credentials are verifiable), write via service_role only
CREATE POLICY "Anyone can view reputation credentials"
  ON reputation_credentials FOR SELECT
  TO authenticated, anon
  USING (true);

-- reputation_revocations: public read (revocation lists are public), write via service_role only
CREATE POLICY "Anyone can view revocations"
  ON reputation_revocations FOR SELECT
  TO authenticated, anon
  USING (true);

-- merchant_dids: merchants can view their own DIDs
CREATE POLICY "Merchants can view their own DIDs"
  ON merchant_dids FOR SELECT
  TO authenticated
  USING (merchant_id = auth.uid());

CREATE POLICY "Merchants can create their own DIDs"
  ON merchant_dids FOR INSERT
  TO authenticated
  WITH CHECK (merchant_id = auth.uid());

-- did_reputation_events: public read (events are verifiable)
CREATE POLICY "Anyone can view DID reputation events"
  ON did_reputation_events FOR SELECT
  TO authenticated, anon
  USING (true);

-- stripe_accounts: merchants see their own
CREATE POLICY "Merchants can view their own Stripe accounts"
  ON stripe_accounts FOR SELECT
  TO authenticated
  USING (merchant_id = auth.uid());

-- stripe_disputes: merchants see their own
CREATE POLICY "Merchants can view their own disputes"
  ON stripe_disputes FOR SELECT
  TO authenticated
  USING (business_id IN (SELECT id FROM businesses WHERE merchant_id = auth.uid()));

-- stripe_payouts: merchants see their own
CREATE POLICY "Merchants can view their own payouts"
  ON stripe_payouts FOR SELECT
  TO authenticated
  USING (business_id IN (SELECT id FROM businesses WHERE merchant_id = auth.uid()));

-- stripe_transactions: merchants see their own
CREATE POLICY "Merchants can view their own transactions"
  ON stripe_transactions FOR SELECT
  TO authenticated
  USING (business_id IN (SELECT id FROM businesses WHERE merchant_id = auth.uid()));
