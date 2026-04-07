-- Group system_wallet_indexes counters by *derivation family* instead of
-- per-cryptocurrency.
--
-- Background: every EVM chain (ETH/POL/BNB/USDT*/USDC*) derives from the
-- same mnemonic + path m/44'/60'/0'/0/i, so index `i` produces the same
-- 0x… address regardless of which chain the merchant picked. The Solana
-- family (SOL/USDT_SOL/USDC_SOL) has the same property under
-- m/44'/501'/i'/0'.
--
-- Previously, system_wallet_indexes had one row per cryptocurrency, so the
-- USDC_POL counter could sit at 0 while ETH was at 50. The next USDC_POL
-- payment would derive an address already minted by ETH and crash on the
-- unique_address constraint with "all derived addresses already exist".
--
-- This migration backfills two new rows ('EVM' and 'SOL') seeded just past
-- the highest existing derivation_index across the whole family, so the
-- next payment is guaranteed to mint a fresh address. Old per-coin rows
-- are left in place for historical reference but are no longer read.

DO $$
DECLARE
  evm_max INTEGER;
  sol_max INTEGER;
BEGIN
  SELECT COALESCE(MAX(derivation_index), -1) INTO evm_max
  FROM payment_addresses
  WHERE cryptocurrency IN (
    'ETH', 'POL', 'BNB', 'USDT', 'USDC',
    'USDT_ETH', 'USDT_POL', 'USDC_ETH', 'USDC_POL'
  );

  SELECT COALESCE(MAX(derivation_index), -1) INTO sol_max
  FROM payment_addresses
  WHERE cryptocurrency IN ('SOL', 'USDT_SOL', 'USDC_SOL');

  INSERT INTO system_wallet_indexes (cryptocurrency, next_index)
  VALUES ('EVM', evm_max + 1)
  ON CONFLICT (cryptocurrency)
  DO UPDATE SET next_index = GREATEST(system_wallet_indexes.next_index, EXCLUDED.next_index);

  INSERT INTO system_wallet_indexes (cryptocurrency, next_index)
  VALUES ('SOL', sol_max + 1)
  ON CONFLICT (cryptocurrency)
  DO UPDATE SET next_index = GREATEST(system_wallet_indexes.next_index, EXCLUDED.next_index);
END $$;

COMMENT ON COLUMN system_wallet_indexes.cryptocurrency IS
  'Derivation-family key (EVM, SOL, BTC, BCH, DOGE, XRP, ADA). Legacy per-coin rows may also exist but are unused.';
