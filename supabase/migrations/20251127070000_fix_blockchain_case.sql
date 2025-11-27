-- Fix blockchain check constraint to use uppercase values
-- The application uses uppercase blockchain codes (BTC, ETH, etc.)
-- but the original schema used lowercase

-- Drop the existing check constraint on payments table
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_blockchain_check;

-- Add new check constraint with uppercase values
ALTER TABLE payments ADD CONSTRAINT payments_blockchain_check
  CHECK (blockchain IN ('BTC', 'BCH', 'ETH', 'MATIC', 'SOL', 'USDC_ETH', 'USDC_MATIC', 'USDC_SOL'));

-- Update any existing lowercase values to uppercase (if any exist)
UPDATE payments SET blockchain = UPPER(blockchain) WHERE blockchain != UPPER(blockchain);

-- Note: payment_addresses table uses 'cryptocurrency' column (not 'blockchain')
-- and doesn't have a check constraint, so no changes needed there