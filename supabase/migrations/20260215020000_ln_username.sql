-- Add unique Lightning Address username to wallets
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS ln_username TEXT;

-- Ensure uniqueness (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallets_ln_username_unique 
  ON wallets (LOWER(ln_username)) 
  WHERE ln_username IS NOT NULL;

-- Enforce format: alphanumeric + hyphens + underscores, 3-30 chars
ALTER TABLE wallets ADD CONSTRAINT chk_ln_username_format
  CHECK (ln_username IS NULL OR ln_username ~ '^[a-zA-Z0-9_-]{3,30}$');
