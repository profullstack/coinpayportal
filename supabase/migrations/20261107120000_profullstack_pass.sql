-- Profullstack Pass: deposit $99 into your own CoinPay wallet, get a free month
-- on every Profullstack property that signs in with CoinPay.
--
-- Nothing here holds or moves money. The deposit stays in the user's
-- non-custodial web wallet; we only record that a confirmed incoming deposit
-- (by chain + tx hash) was counted, so the same transaction can never fund a
-- second pass, and when the one pass per account runs out.

BEGIN;

CREATE TABLE IF NOT EXISTS pass_grants (
    merchant_id UUID PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE,
    starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    deposit_usd NUMERIC(14, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pass_grant_deposits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    -- SET NULL, not CASCADE: deleting the wallet must not free the tx hash for reuse.
    wallet_transaction_id UUID REFERENCES wallet_transactions(id) ON DELETE SET NULL,
    chain TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    amount NUMERIC(30, 18) NOT NULL,
    usd_value NUMERIC(14, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (chain, tx_hash)
);

CREATE INDEX IF NOT EXISTS idx_pass_grant_deposits_merchant ON pass_grant_deposits(merchant_id);

-- Which of these addresses belong to a CoinPay web wallet. EVM addresses are
-- stored checksummed but indexed transfers carry them lowercase, so compare
-- lowercased on both sides.
CREATE INDEX IF NOT EXISTS idx_wallet_addresses_lower_address ON wallet_addresses (lower(address));

CREATE OR REPLACE FUNCTION pass_internal_addresses(addrs TEXT[])
RETURNS SETOF TEXT
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT DISTINCT lower(address) FROM wallet_addresses
  WHERE lower(address) = ANY (SELECT lower(a) FROM unnest(addrs) AS a);
$$;

REVOKE ALL ON FUNCTION pass_internal_addresses(TEXT[]) FROM PUBLIC, anon, authenticated;

-- Service role only: no policies.
ALTER TABLE pass_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE pass_grant_deposits ENABLE ROW LEVEL SECURITY;

COMMIT;
