-- Web Bot Auth key registry.
--
-- Verifying a Web Bot Auth signature proves control of a key published at some
-- directory URL. That is an identity, but an anonymous one. This table is what
-- turns it into a CoinPay identity: it maps a key thumbprint to an agent DID,
-- so a verified request can carry a reputation and a trust tier rather than
-- just a domain name.
--
-- Rows serve two purposes, distinguished by `published`:
--   * published = true  -> a key CoinPay hosts and serves in its own directory
--                          at /.well-known/http-message-signatures-directory,
--                          making CoinPay-hosted agents verifiable by anyone.
--   * published = false -> a third-party key someone has mapped to a DID so
--                          their traffic resolves to a known agent here.

CREATE TABLE IF NOT EXISTS web_bot_auth_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- RFC 7638 JWK thumbprint, base64url. This is the `keyid` a signer puts in
  -- Signature-Input, and the join key between a signature and an identity.
  keyid           text NOT NULL,

  -- The Ed25519 public JWK itself: {kty:'OKP', crv:'Ed25519', x:'...'}.
  jwk             jsonb NOT NULL,

  -- Directory URL the key is published at, as it appears in Signature-Agent.
  -- NULL for keys CoinPay itself publishes.
  signature_agent text,

  -- The CoinPay identity this key speaks for.
  agent_did       text,

  -- Owner, when the key belongs to a merchant's agent.
  merchant_id     uuid REFERENCES merchants(id) ON DELETE CASCADE,

  label           text,
  published       boolean NOT NULL DEFAULT false,
  active          boolean NOT NULL DEFAULT true,

  -- Directory validity window, mirrored into the served JWKS.
  not_before      timestamptz,
  expires_at      timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz
);

-- A thumbprint identifies exactly one key, so it must resolve to one identity.
-- Two rows for one keyid would make "who is this?" ambiguous at verify time.
CREATE UNIQUE INDEX IF NOT EXISTS web_bot_auth_keys_keyid_idx
  ON web_bot_auth_keys (keyid);

CREATE INDEX IF NOT EXISTS web_bot_auth_keys_agent_did_idx
  ON web_bot_auth_keys (agent_did);

CREATE INDEX IF NOT EXISTS web_bot_auth_keys_merchant_id_idx
  ON web_bot_auth_keys (merchant_id);

-- The directory endpoint reads exactly this slice on every request.
CREATE INDEX IF NOT EXISTS web_bot_auth_keys_published_idx
  ON web_bot_auth_keys (published, active)
  WHERE published AND active;

ALTER TABLE web_bot_auth_keys ENABLE ROW LEVEL SECURITY;

-- Server-side reads and writes go through the service role.
DROP POLICY IF EXISTS "service_role_all_web_bot_auth_keys" ON web_bot_auth_keys;
CREATE POLICY "service_role_all_web_bot_auth_keys" ON web_bot_auth_keys
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Merchants may list their own registered keys in the dashboard. Only public
-- key material is stored, so SELECT exposes nothing secret.
DROP POLICY IF EXISTS "merchants_select_own_web_bot_auth_keys" ON web_bot_auth_keys;
CREATE POLICY "merchants_select_own_web_bot_auth_keys" ON web_bot_auth_keys
  FOR SELECT TO authenticated
  USING (merchant_id = auth.uid());
