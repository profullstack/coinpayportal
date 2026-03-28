-- Add chain-specific USDT/USDC variants to merchant and business wallet constraints

ALTER TABLE business_wallets DROP CONSTRAINT IF EXISTS business_wallets_cryptocurrency_check;
ALTER TABLE business_wallets ADD CONSTRAINT business_wallets_cryptocurrency_check CHECK (
  cryptocurrency IN (
    'BTC', 'BCH', 'ETH', 'POL', 'SOL',
    'DOGE', 'XRP', 'ADA', 'BNB',
    'USDT', 'USDT_ETH', 'USDT_POL', 'USDT_SOL',
    'USDC', 'USDC_ETH', 'USDC_POL', 'USDC_SOL'
  )
);

ALTER TABLE merchant_wallets DROP CONSTRAINT IF EXISTS merchant_wallets_cryptocurrency_check;
ALTER TABLE merchant_wallets ADD CONSTRAINT merchant_wallets_cryptocurrency_check CHECK (
  cryptocurrency IN (
    'BTC', 'BCH', 'ETH', 'POL', 'SOL',
    'DOGE', 'XRP', 'ADA', 'BNB',
    'USDT', 'USDT_ETH', 'USDT_POL', 'USDT_SOL',
    'USDC', 'USDC_ETH', 'USDC_POL', 'USDC_SOL'
  )
);

COMMENT ON CONSTRAINT business_wallets_cryptocurrency_check ON business_wallets IS
  'Valid cryptocurrencies include native coins plus USDT/USDC variants on Ethereum, Polygon, and Solana';

COMMENT ON CONSTRAINT merchant_wallets_cryptocurrency_check ON merchant_wallets IS
  'Valid cryptocurrencies include native coins plus USDT/USDC variants on Ethereum, Polygon, and Solana';
