-- Repair migration for blockchain check constraint
-- Previous migration failed partway through

-- Drop the existing check constraint on payments table (if exists)
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_blockchain_check;

-- Add new check constraint with uppercase values
ALTER TABLE payments ADD CONSTRAINT payments_blockchain_check 
  CHECK (blockchain IN ('BTC', 'BCH', 'ETH', 'MATIC', 'SOL', 'USDC_ETH', 'USDC_MATIC', 'USDC_SOL'));

-- Update any existing lowercase values to uppercase (if any exist)
UPDATE payments SET blockchain = UPPER(blockchain) WHERE blockchain != UPPER(blockchain);