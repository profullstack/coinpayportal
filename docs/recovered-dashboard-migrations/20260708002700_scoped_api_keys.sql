-- Recovered from supabase_migrations.schema_migrations on prod.
-- Applied 20260708002700 outside the repo (dashboard SQL editor) and never
-- committed, which desynced the CLI's migration history. Restored verbatim.

-- Scoped API keys: many-per-business, named, individually revocable, with scopes.
-- Additive/idempotent; legacy businesses.api_key is untouched.
CREATE TABLE IF NOT EXISTS business_api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  key_hash     TEXT NOT NULL UNIQUE,          -- HMAC-SHA256(raw key, server pepper), never the raw key
  prefix       TEXT NOT NULL,                 -- e.g. 'cp_live_ab12cd34' for display
  name         TEXT NOT NULL,                 -- human label, e.g. 'github-bot'
  scopes       TEXT[] NOT NULL DEFAULT '{}',  -- e.g. '{payments:create}'
  created_by   UUID,                          -- merchant id that minted it
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_business_api_keys_business_id ON business_api_keys(business_id);
CREATE INDEX IF NOT EXISTS idx_business_api_keys_key_hash    ON business_api_keys(key_hash) WHERE revoked_at IS NULL;

COMMENT ON TABLE  business_api_keys        IS 'Scoped, revocable API keys per business (hashed). Legacy businesses.api_key = all-scopes.';
COMMENT ON COLUMN business_api_keys.key_hash IS 'HMAC-SHA256 of the raw cp_live_ key (keyed with a server pepper). Raw value is only shown once at creation.';
COMMENT ON COLUMN business_api_keys.scopes   IS 'Granted scopes, e.g. payments:create, payments:read, payments:refund, payouts:create, wallet:read.';;
