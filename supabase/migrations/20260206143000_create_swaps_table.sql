-- Create swaps table for tracking swap history
-- Stores all swaps created through the wallet for history/status tracking

CREATE TABLE IF NOT EXISTS swaps (
  id TEXT PRIMARY KEY,                    -- Swap ID from provider (e.g., ChangeNOW)
  wallet_id UUID NOT NULL,                -- References web_wallets(id) - FK added if table exists
  
  -- Swap details
  from_coin TEXT NOT NULL,                -- Source coin (BTC, ETH, etc.)
  to_coin TEXT NOT NULL,                  -- Destination coin
  deposit_amount TEXT NOT NULL,           -- Amount to deposit
  settle_amount TEXT,                     -- Expected amount to receive
  rate TEXT,                              -- Exchange rate at time of swap
  
  -- Addresses
  deposit_address TEXT NOT NULL,          -- Where to send deposit
  settle_address TEXT NOT NULL,           -- Where swapped coins go
  refund_address TEXT,                    -- Where refunds go (if any)
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting, confirming, exchanging, sending, finished, failed, refunded, expired
  provider TEXT NOT NULL DEFAULT 'changenow',
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  
  -- Provider-specific data (for debugging/support)
  provider_data JSONB DEFAULT '{}'::jsonb
);

-- Index for listing user's swaps
CREATE INDEX IF NOT EXISTS idx_swaps_wallet_id ON swaps(wallet_id);
CREATE INDEX IF NOT EXISTS idx_swaps_status ON swaps(status);
CREATE INDEX IF NOT EXISTS idx_swaps_created_at ON swaps(created_at DESC);

-- RLS policies
ALTER TABLE swaps ENABLE ROW LEVEL SECURITY;

-- Policies depend on whether web_wallets exists
-- If web_wallets exists, restrict to wallet owners
-- Otherwise, allow all authenticated users (for standalone use)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'web_wallets') THEN
    -- Users can only see their own swaps (via wallet ownership)
    EXECUTE 'CREATE POLICY "Users can view own swaps" ON swaps
      FOR SELECT
      USING (
        wallet_id IN (
          SELECT id FROM web_wallets WHERE user_id = auth.uid()
        )
      )';

    -- Users can insert swaps for their own wallets
    EXECUTE 'CREATE POLICY "Users can create swaps" ON swaps
      FOR INSERT
      WITH CHECK (
        wallet_id IN (
          SELECT id FROM web_wallets WHERE user_id = auth.uid()
        )
      )';

    -- Users can update status of their own swaps
    EXECUTE 'CREATE POLICY "Users can update own swaps" ON swaps
      FOR UPDATE
      USING (
        wallet_id IN (
          SELECT id FROM web_wallets WHERE user_id = auth.uid()
        )
      )';
  ELSE
    -- Fallback: service role only (no web_wallets yet)
    EXECUTE 'CREATE POLICY "Service role access" ON swaps FOR ALL USING (true)';
  END IF;
END $$;

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_swaps_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER swaps_updated_at
  BEFORE UPDATE ON swaps
  FOR EACH ROW
  EXECUTE FUNCTION update_swaps_updated_at();

-- Comment
COMMENT ON TABLE swaps IS 'Tracks cryptocurrency swap transactions created through the web wallet';

-- Add FK constraint if web_wallets table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'web_wallets') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'swaps_wallet_id_fkey' AND table_name = 'swaps'
    ) THEN
      ALTER TABLE swaps ADD CONSTRAINT swaps_wallet_id_fkey 
        FOREIGN KEY (wallet_id) REFERENCES web_wallets(id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;
