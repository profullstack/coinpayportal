-- OAuth 2.1 for CoinPay as the master account (2026-10-29).
--
-- * Client registration metadata: token_endpoint_auth_method (none = public
--   client), grant_types, require_pkce, id_token_signed_response_alg, and a
--   legacy_oauth2 flag that keeps every client registered before today working
--   exactly as it did (secretless PKCE exchange, loopback port flexibility).
-- * Refresh-token families for rotation with reuse detection.
-- * Revocation list for access tokens (by jti) and whole grants (by sid).
-- * RFC 8628 device authorization codes.

BEGIN;

-- ---------------------------------------------------------------- clients
ALTER TABLE oauth_clients
  ADD COLUMN IF NOT EXISTS token_endpoint_auth_method TEXT NOT NULL DEFAULT 'client_secret_basic',
  ADD COLUMN IF NOT EXISTS grant_types TEXT[] NOT NULL DEFAULT '{authorization_code,refresh_token}',
  ADD COLUMN IF NOT EXISTS require_pkce BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS id_token_signed_response_alg TEXT NOT NULL DEFAULT 'RS256',
  ADD COLUMN IF NOT EXISTS legacy_oauth2 BOOLEAN NOT NULL DEFAULT FALSE;

DO $$ BEGIN
  ALTER TABLE oauth_clients ADD CONSTRAINT oauth_clients_auth_method_chk
    CHECK (token_endpoint_auth_method IN ('client_secret_basic', 'client_secret_post', 'none'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE oauth_clients ADD CONSTRAINT oauth_clients_id_token_alg_chk
    CHECK (id_token_signed_response_alg IN ('RS256', 'HS256'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Public clients hold no secret. The column stays NOT NULL ('' = none), as
-- the coinpay-cli row already does.

-- Backfill only rows that existed before this migration (all still have the
-- default legacy_oauth2 = false and no explicit choice yet).
UPDATE oauth_clients c SET
  legacy_oauth2 = TRUE,
  token_endpoint_auth_method = CASE WHEN coalesce(c.client_secret, '') = '' THEN 'none' ELSE 'client_secret_basic' END,
  -- Every existing client keeps its HS256 id_token; new clients default to RS256.
  id_token_signed_response_alg = 'HS256',
  -- PKCE becomes mandatory for public clients and for confidential clients
  -- that have only ever sent it. Clients that ever sent a code request
  -- without PKCE, or never completed one, keep it optional (reported, not broken).
  require_pkce = CASE
    WHEN coalesce(c.client_secret, '') = '' THEN TRUE
    WHEN EXISTS (SELECT 1 FROM oauth_authorization_codes a WHERE a.client_id = c.client_id)
     AND NOT EXISTS (SELECT 1 FROM oauth_authorization_codes a WHERE a.client_id = c.client_id AND a.code_challenge IS NULL)
      THEN TRUE
    ELSE FALSE
  END,
  grant_types = CASE WHEN coalesce(c.client_secret, '') = ''
    THEN '{authorization_code,refresh_token,urn:ietf:params:oauth:grant-type:device_code}'::text[]
    ELSE '{authorization_code,refresh_token}'::text[] END
WHERE c.created_at < now();

-- --------------------------------------------------------- refresh tokens
ALTER TABLE oauth_refresh_tokens
  ADD COLUMN IF NOT EXISTS family_id UUID,
  ADD COLUMN IF NOT EXISTS replaced_by UUID,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_reason TEXT;
UPDATE oauth_refresh_tokens SET family_id = id WHERE family_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_family ON oauth_refresh_tokens (family_id);

-- An authorization code remembers the grant it produced, so a replayed code
-- can revoke it (RFC 6749 4.1.2 / OAuth 2.1 4.1.3).
ALTER TABLE oauth_authorization_codes ADD COLUMN IF NOT EXISTS family_id UUID;

-- ------------------------------------------------------------- revocation
-- id is 'jti:<jti>' (one access token) or 'sid:<family uuid>' (every access
-- token minted for that grant). Rows only need to outlive the 1h tokens.
CREATE TABLE IF NOT EXISTS oauth_revoked_tokens (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  reason TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oauth_revoked_expires ON oauth_revoked_tokens (expires_at);
ALTER TABLE oauth_revoked_tokens ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------- device authorization
CREATE TABLE IF NOT EXISTS oauth_device_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_code TEXT NOT NULL UNIQUE,           -- sha256:<hex> of the device_code
  user_code TEXT NOT NULL UNIQUE,             -- XXXX-XXXX, typed by the user
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'completed')),
  user_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  interval_seconds INT NOT NULL DEFAULT 5,
  last_polled_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oauth_device_codes_expires ON oauth_device_codes (expires_at);
ALTER TABLE oauth_device_codes ENABLE ROW LEVEL SECURITY;

GRANT ALL ON oauth_revoked_tokens TO service_role;
GRANT ALL ON oauth_device_codes TO service_role;
REVOKE ALL ON oauth_revoked_tokens FROM anon, authenticated;
REVOKE ALL ON oauth_device_codes FROM anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
