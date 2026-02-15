-- Add LNbits wallet columns to wallets table
-- These store the per-user LNbits wallet credentials

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS ln_wallet_id TEXT;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS ln_wallet_adminkey TEXT;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS ln_wallet_inkey TEXT;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS ln_paylink_id INTEGER;

-- Index for Lightning Address lookups
CREATE INDEX IF NOT EXISTS idx_wallets_ln_username ON wallets (ln_username) WHERE ln_username IS NOT NULL;
