-- Add new blockchain chains: DOGE, XRP, ADA, BNB, USDT tokens
-- This migration updates check constraints on wallet tables to support new chains

-- ============================================================
-- 1. wallet_addresses - Update chain check constraint
-- ============================================================
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'wallet_addresses') THEN
        ALTER TABLE wallet_addresses DROP CONSTRAINT IF EXISTS wallet_addresses_chain_check;
        ALTER TABLE wallet_addresses ADD CONSTRAINT wallet_addresses_chain_check CHECK (chain IN (
            -- Native chains
            'BTC', 'BCH', 'ETH', 'POL', 'SOL', 'DOGE', 'XRP', 'ADA', 'BNB',
            -- USDC tokens
            'USDC_ETH', 'USDC_POL', 'USDC_SOL',
            -- USDT tokens
            'USDT_ETH', 'USDT_POL', 'USDT_SOL'
        ));
    END IF;
END $$;

-- ============================================================
-- 2. wallet_transactions - Update chain check constraint
-- ============================================================
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'wallet_transactions') THEN
        ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_chain_check;
        ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_chain_check CHECK (chain IN (
            -- Native chains
            'BTC', 'BCH', 'ETH', 'POL', 'SOL', 'DOGE', 'XRP', 'ADA', 'BNB',
            -- USDC tokens
            'USDC_ETH', 'USDC_POL', 'USDC_SOL',
            -- USDT tokens
            'USDT_ETH', 'USDT_POL', 'USDT_SOL'
        ));
    END IF;
END $$;

-- ============================================================
-- 3. wallet_prepared_transactions - Update chain check constraint  
-- ============================================================
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'wallet_prepared_transactions') THEN
        ALTER TABLE wallet_prepared_transactions DROP CONSTRAINT IF EXISTS wallet_prepared_transactions_chain_check;
        ALTER TABLE wallet_prepared_transactions ADD CONSTRAINT wallet_prepared_transactions_chain_check CHECK (chain IN (
            -- Native chains
            'BTC', 'BCH', 'ETH', 'POL', 'SOL', 'DOGE', 'XRP', 'ADA', 'BNB',
            -- USDC tokens
            'USDC_ETH', 'USDC_POL', 'USDC_SOL',
            -- USDT tokens
            'USDT_ETH', 'USDT_POL', 'USDT_SOL'
        ));
    END IF;
END $$;

-- ============================================================
-- 4. payments table - Update blockchain check constraint
-- ============================================================
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payments') THEN
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
    END IF;
END $$;
