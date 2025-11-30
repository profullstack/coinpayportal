-- Migration: Add all supported cryptocurrencies
-- Description: Updates database constraints to support all cryptocurrencies from the UI
-- Supported: BTC, BCH, ETH, USDT, USDC, BNB, SOL, XRP, ADA, DOGE, POL

-- Update business_wallets table constraint to include all cryptocurrencies
ALTER TABLE business_wallets DROP CONSTRAINT IF EXISTS business_wallets_cryptocurrency_check;
ALTER TABLE business_wallets ADD CONSTRAINT business_wallets_cryptocurrency_check
  CHECK (cryptocurrency IN ('BTC', 'BCH', 'ETH', 'USDT', 'USDC', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'POL'));

-- Add all cryptocurrencies to system_wallet_indexes if they don't exist
INSERT INTO system_wallet_indexes (cryptocurrency, next_index)
VALUES
  ('BCH', 0),
  ('USDT', 0),
  ('USDC', 0),
  ('BNB', 0),
  ('XRP', 0),
  ('ADA', 0),
  ('DOGE', 0)
ON CONFLICT (cryptocurrency) DO NOTHING;

-- Update payments table constraint to include all cryptocurrencies
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_blockchain_check;
ALTER TABLE payments ADD CONSTRAINT payments_blockchain_check
  CHECK (blockchain IN ('BTC', 'BCH', 'ETH', 'USDT', 'USDC', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'POL', 'USDC_ETH', 'USDC_POL', 'USDC_SOL'));

-- Update business_collection_payments constraint if the table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_collection_payments') THEN
    ALTER TABLE business_collection_payments DROP CONSTRAINT IF EXISTS business_collection_payments_blockchain_check;
    ALTER TABLE business_collection_payments ADD CONSTRAINT business_collection_payments_blockchain_check
      CHECK (blockchain IN ('BTC', 'BCH', 'ETH', 'USDT', 'USDC', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'POL'));
  END IF;
END $$;

-- Add comment explaining the migration
COMMENT ON CONSTRAINT business_wallets_cryptocurrency_check ON business_wallets IS
  'Valid cryptocurrencies: BTC, BCH, ETH, USDT, USDC, BNB, SOL, XRP, ADA, DOGE, POL';

COMMENT ON CONSTRAINT payments_blockchain_check ON payments IS
  'Valid blockchains: BTC, BCH, ETH, USDT, USDC, BNB, SOL, XRP, ADA, DOGE, POL, and USDC variants';