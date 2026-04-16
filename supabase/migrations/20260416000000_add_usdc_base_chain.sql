-- Add USDC_BASE to all chain CHECK constraints. Native Circle-issued
-- USDC on Base mainnet, contract 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913,
-- derived from the same secp256k1 key as USDC_ETH (Base is EVM, BIP44
-- coin type 60). Same EVM family for system-wallet index allocation.

-- ─────────────────────────────────────────────────────────────────
-- 1. Web wallet tables (user-derived addresses + tx history)
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE wallet_addresses
    DROP CONSTRAINT IF EXISTS wallet_addresses_chain_check;

ALTER TABLE wallet_addresses
    ADD CONSTRAINT wallet_addresses_chain_check
    CHECK (chain IN (
        'BTC', 'BCH', 'ETH', 'POL', 'SOL',
        'USDC_ETH', 'USDC_POL', 'USDC_SOL', 'USDC_BASE'
    ));

ALTER TABLE wallet_transactions
    DROP CONSTRAINT IF EXISTS wallet_transactions_chain_check;

ALTER TABLE wallet_transactions
    ADD CONSTRAINT wallet_transactions_chain_check
    CHECK (chain IN (
        'BTC', 'BCH', 'ETH', 'POL', 'SOL',
        'USDC_ETH', 'USDC_POL', 'USDC_SOL', 'USDC_BASE'
    ));

-- ─────────────────────────────────────────────────────────────────
-- 2. Business + merchant wallet tables (commission destinations)
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE business_wallets DROP CONSTRAINT IF EXISTS business_wallets_cryptocurrency_check;
ALTER TABLE business_wallets ADD CONSTRAINT business_wallets_cryptocurrency_check CHECK (
    cryptocurrency IN (
        'BTC', 'BCH', 'ETH', 'POL', 'SOL',
        'DOGE', 'XRP', 'ADA', 'BNB',
        'USDT', 'USDT_ETH', 'USDT_POL', 'USDT_SOL',
        'USDC', 'USDC_ETH', 'USDC_POL', 'USDC_SOL', 'USDC_BASE'
    )
);

ALTER TABLE merchant_wallets DROP CONSTRAINT IF EXISTS merchant_wallets_cryptocurrency_check;
ALTER TABLE merchant_wallets ADD CONSTRAINT merchant_wallets_cryptocurrency_check CHECK (
    cryptocurrency IN (
        'BTC', 'BCH', 'ETH', 'POL', 'SOL',
        'DOGE', 'XRP', 'ADA', 'BNB',
        'USDT', 'USDT_ETH', 'USDT_POL', 'USDT_SOL',
        'USDC', 'USDC_ETH', 'USDC_POL', 'USDC_SOL', 'USDC_BASE'
    )
);
