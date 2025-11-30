-- Migration: Replace MATIC with POL cryptocurrency
-- Description: Polygon rebranded from MATIC to POL. This migration replaces MATIC with POL
-- and migrates any existing MATIC data to POL.

-- First, update any existing MATIC data to POL
UPDATE business_wallets SET cryptocurrency = 'POL' WHERE cryptocurrency = 'MATIC';
UPDATE payments SET blockchain = 'POL' WHERE blockchain = 'MATIC';
UPDATE payments SET blockchain = 'USDC_POL' WHERE blockchain = 'USDC_MATIC';

-- Update business_wallets table constraint - remove MATIC, add POL
ALTER TABLE business_wallets DROP CONSTRAINT IF EXISTS business_wallets_cryptocurrency_check;
ALTER TABLE business_wallets ADD CONSTRAINT business_wallets_cryptocurrency_check
  CHECK (cryptocurrency IN ('BTC', 'ETH', 'POL', 'SOL'));

-- Update payments table constraint - remove MATIC, add POL
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_blockchain_check;
ALTER TABLE payments ADD CONSTRAINT payments_blockchain_check
  CHECK (blockchain IN ('BTC', 'BCH', 'ETH', 'POL', 'SOL', 'USDC_ETH', 'USDC_POL', 'USDC_SOL'));

-- Update business_collection_payments table constraint if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_collection_payments') THEN
    -- Update existing data
    UPDATE business_collection_payments SET blockchain = 'POL' WHERE blockchain = 'MATIC';
    
    ALTER TABLE business_collection_payments DROP CONSTRAINT IF EXISTS business_collection_payments_blockchain_check;
    ALTER TABLE business_collection_payments ADD CONSTRAINT business_collection_payments_blockchain_check
      CHECK (blockchain IN ('BTC', 'BCH', 'ETH', 'POL', 'SOL'));
  END IF;
END $$;

-- Update system_wallet_indices table if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'system_wallet_indices') THEN
    -- Update MATIC to POL if exists
    UPDATE system_wallet_indices SET blockchain = 'POL' WHERE blockchain = 'MATIC';
    
    -- Insert POL entry if it doesn't exist
    INSERT INTO system_wallet_indices (blockchain, current_index)
    VALUES ('POL', 0)
    ON CONFLICT (blockchain) DO NOTHING;
  END IF;
END $$;

-- Add comment explaining the migration
COMMENT ON CONSTRAINT business_wallets_cryptocurrency_check ON business_wallets IS
  'Valid cryptocurrencies: BTC, ETH, POL (Polygon), SOL';

COMMENT ON CONSTRAINT payments_blockchain_check ON payments IS
  'Valid blockchains: BTC, BCH, ETH, POL (Polygon), SOL, and USDC variants';