-- Exchange Engine: CoinPay swap fee (2% free tier, 1% paid tier).
--
-- The fee is a separate send from the user's wallet to CoinPay's fee wallet for
-- the source asset. These columns record what was owed and the transaction that
-- paid it; nothing here is a customer balance.

BEGIN;

ALTER TABLE exchange_orders
    ADD COLUMN IF NOT EXISTS fee_amount NUMERIC(38, 18) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
    ADD COLUMN IF NOT EXISTS fee_bps INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS fee_tier TEXT,
    ADD COLUMN IF NOT EXISTS fee_address TEXT,
    ADD COLUMN IF NOT EXISTS fee_tx_hash TEXT;

-- A fee transaction pays for exactly one order.
CREATE UNIQUE INDEX IF NOT EXISTS uq_exchange_orders_fee_tx
    ON exchange_orders(lower(fee_tx_hash)) WHERE fee_tx_hash IS NOT NULL;

-- Fees owed but not yet seen: completed swaps with a fee and no fee transaction.
CREATE INDEX IF NOT EXISTS idx_exchange_orders_fee_unpaid
    ON exchange_orders(completed_at) WHERE fee_amount > 0 AND fee_tx_hash IS NULL;

COMMIT;
