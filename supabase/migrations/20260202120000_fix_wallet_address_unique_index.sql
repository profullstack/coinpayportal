-- Fix: Allow same address on different chains (USDC_ETH shares address with ETH, etc.)
-- The old unique index on address alone prevented USDC variants from being stored.

DROP INDEX IF EXISTS idx_wallet_addresses_address;

-- New unique index on (address, chain) — same address can exist for different chains
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_addresses_address_chain ON wallet_addresses(address, chain);
