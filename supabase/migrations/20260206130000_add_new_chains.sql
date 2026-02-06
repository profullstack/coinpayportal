-- Add new blockchain chains: DOGE, XRP, ADA, BNB, USDT tokens
-- This migration updates check constraints on wallet tables to support new chains

-- ============================================================
-- 1. wallet_addresses - Update chain check constraint
-- ============================================================
ALTER TABLE wallet_addresses DROP CONSTRAINT IF EXISTS wallet_addresses_chain_check;
ALTER TABLE wallet_addresses ADD CONSTRAINT wallet_addresses_chain_check CHECK (chain IN (
    -- Native chains
    'BTC', 'BCH', 'ETH', 'POL', 'SOL', 'DOGE', 'XRP', 'ADA', 'BNB',
    -- USDC tokens
    'USDC_ETH', 'USDC_POL', 'USDC_SOL',
    -- USDT tokens
    'USDT_ETH', 'USDT_POL', 'USDT_SOL'
));

-- ============================================================
-- 2. wallet_transactions - Update chain check constraint
-- ============================================================
ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_chain_check;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_chain_check CHECK (chain IN (
    -- Native chains
    'BTC', 'BCH', 'ETH', 'POL', 'SOL', 'DOGE', 'XRP', 'ADA', 'BNB',
    -- USDC tokens
    'USDC_ETH', 'USDC_POL', 'USDC_SOL',
    -- USDT tokens
    'USDT_ETH', 'USDT_POL', 'USDT_SOL'
));

-- ============================================================
-- 3. payments table - Update blockchain check constraint
-- ============================================================
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_blockchain_check;
ALTER TABLE payments ADD CONSTRAINT payments_blockchain_check CHECK (blockchain IN (
    -- Native chains
    'BTC', 'BCH', 'ETH', 'POL', 'SOL', 'DOGE', 'XRP', 'ADA', 'BNB',
    -- USDC tokens
    'USDC_ETH', 'USDC_POL', 'USDC_SOL',
    -- USDT tokens
    'USDT_ETH', 'USDT_POL', 'USDT_SOL',
    -- Legacy MATIC aliases (for backwards compatibility)
    'MATIC', 'USDC_MATIC'
));
