-- Agentic Identity: classify DIDs and support delegated authority credentials
--
-- did_kind  : 'human' | 'agent' | 'service'
-- lifetime  : 'persistent' | 'ephemeral'
-- label     : optional friendly name (e.g. "Pricing Bot")
-- parent_did: optional principal DID this agent acts on behalf of
--
-- A merchant still has at most ONE human DID, but may register many
-- agent/service DIDs they control.

ALTER TABLE merchant_dids
  ADD COLUMN IF NOT EXISTS did_kind  text NOT NULL DEFAULT 'human'
    CHECK (did_kind IN ('human','agent','service')),
  ADD COLUMN IF NOT EXISTS lifetime  text NOT NULL DEFAULT 'persistent'
    CHECK (lifetime IN ('persistent','ephemeral')),
  ADD COLUMN IF NOT EXISTS label     text,
  ADD COLUMN IF NOT EXISTS parent_did text;

-- Replace the "one DID per merchant" index with "one human DID per merchant"
DROP INDEX IF EXISTS idx_merchant_dids_merchant_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_dids_principal_unique
  ON merchant_dids(merchant_id)
  WHERE merchant_id IS NOT NULL AND did_kind = 'human';

CREATE INDEX IF NOT EXISTS idx_merchant_dids_kind ON merchant_dids(did_kind);
CREATE INDEX IF NOT EXISTS idx_merchant_dids_parent ON merchant_dids(parent_did)
  WHERE parent_did IS NOT NULL;

-- Delegated authority credentials live in reputation_credentials with
-- credential_type = 'DelegatedAuthority'. The `data` jsonb carries:
--   { principal_did, agent_did, scope: [..], expires_at }
-- Add an expires_at convenience column so revocation/expiry checks don't
-- have to dig into jsonb.
ALTER TABLE reputation_credentials
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_reputation_credentials_expires_at
  ON reputation_credentials(expires_at)
  WHERE expires_at IS NOT NULL;
