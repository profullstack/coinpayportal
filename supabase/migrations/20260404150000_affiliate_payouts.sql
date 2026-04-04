-- Migration: Add affiliate/referral payouts table
-- Description: Enables businesses to send crypto payouts to affiliates/referrals

-- =====================================================
-- 1. Add encrypted_private_key to business_wallets
--    (optional, needed only for businesses that want to send payouts)
-- =====================================================
ALTER TABLE business_wallets
  ADD COLUMN IF NOT EXISTS encrypted_private_key TEXT;

COMMENT ON COLUMN business_wallets.encrypted_private_key
  IS 'AES-256-GCM encrypted private key for sending payouts (optional)';

-- =====================================================
-- 2. AFFILIATE_PAYOUTS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS affiliate_payouts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  recipient_wallet TEXT NOT NULL,
  cryptocurrency TEXT NOT NULL DEFAULT 'USDT',
  amount_usd NUMERIC(10,2) NOT NULL,
  amount_crypto NUMERIC(20,8),
  tx_hash TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_affiliate_payouts_business ON affiliate_payouts(business_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_payouts_status ON affiliate_payouts(status);
CREATE INDEX IF NOT EXISTS idx_affiliate_payouts_email ON affiliate_payouts(recipient_email);

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE affiliate_payouts ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS; these policies are for direct Supabase client access
CREATE POLICY "Businesses can view own payouts"
  ON affiliate_payouts FOR SELECT
  USING (
    business_id IN (
      SELECT id FROM businesses WHERE merchant_id = auth.uid()
    )
  );

CREATE POLICY "Businesses can create own payouts"
  ON affiliate_payouts FOR INSERT
  WITH CHECK (
    business_id IN (
      SELECT id FROM businesses WHERE merchant_id = auth.uid()
    )
  );

-- =====================================================
-- COMMENTS
-- =====================================================
COMMENT ON TABLE affiliate_payouts IS 'Affiliate/referral payout records for businesses';
COMMENT ON COLUMN affiliate_payouts.recipient_email IS 'Email of the affiliate receiving the payout';
COMMENT ON COLUMN affiliate_payouts.recipient_wallet IS 'Crypto wallet address of the recipient';
COMMENT ON COLUMN affiliate_payouts.cryptocurrency IS 'Cryptocurrency used for the payout';
COMMENT ON COLUMN affiliate_payouts.amount_usd IS 'Payout amount in USD';
COMMENT ON COLUMN affiliate_payouts.amount_crypto IS 'Calculated crypto amount based on exchange rate at time of payout';
COMMENT ON COLUMN affiliate_payouts.tx_hash IS 'On-chain transaction hash after successful send';
COMMENT ON COLUMN affiliate_payouts.status IS 'Payout status: pending, processing, completed, failed';
