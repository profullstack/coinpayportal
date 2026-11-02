-- Memorable passphrase sign-in (src/lib/passphrase).
-- The phrase never reaches the server: the browser stretches it with scrypt
-- into an Ed25519 key, and only the public key + salt are stored here.
-- One phrase per merchant; replacing it rotates salt and key.
CREATE TABLE IF NOT EXISTS passphrase_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL UNIQUE REFERENCES merchants(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL CHECK (public_key ~ '^[0-9a-f]{64}$'),
  salt TEXT NOT NULL CHECK (salt ~ '^[0-9a-f]{32}$'),
  kdf JSONB NOT NULL,
  source TEXT NOT NULL DEFAULT 'generated' CHECK (source IN ('generated', 'custom')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

ALTER TABLE passphrase_credentials ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (API routes) reads or writes this table.
