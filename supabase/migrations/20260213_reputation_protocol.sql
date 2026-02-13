-- CoinPayPortal Reputation Protocol (CPR) — Phase 1
-- Immutable task receipts, computed credentials, issuers, and revocations

-- 1. Reputation Issuers (registered platforms)
CREATE TABLE IF NOT EXISTS reputation_issuers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  did text UNIQUE NOT NULL,
  name text NOT NULL,
  domain text,
  api_key_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true
);

CREATE INDEX idx_reputation_issuers_did ON reputation_issuers (did);
CREATE INDEX idx_reputation_issuers_active ON reputation_issuers (active) WHERE active = true;

-- 2. Reputation Receipts (immutable task receipts)
CREATE TABLE IF NOT EXISTS reputation_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id text UNIQUE NOT NULL,
  task_id text NOT NULL,
  agent_did text NOT NULL,
  buyer_did text NOT NULL,
  platform_did text NOT NULL,
  escrow_tx text,
  amount numeric NOT NULL,
  currency text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  sla jsonb,
  outcome text NOT NULL CHECK (outcome IN ('completed', 'failed', 'disputed', 'cancelled')),
  dispute boolean NOT NULL DEFAULT false,
  artifact_hash text,
  signatures jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz
);

CREATE INDEX idx_reputation_receipts_agent ON reputation_receipts (agent_did);
CREATE INDEX idx_reputation_receipts_buyer ON reputation_receipts (buyer_did);
CREATE INDEX idx_reputation_receipts_platform ON reputation_receipts (platform_did);
CREATE INDEX idx_reputation_receipts_category ON reputation_receipts (category);
CREATE INDEX idx_reputation_receipts_created ON reputation_receipts (created_at DESC);
CREATE INDEX idx_reputation_receipts_outcome ON reputation_receipts (outcome);
CREATE INDEX idx_reputation_receipts_escrow ON reputation_receipts (escrow_tx) WHERE escrow_tx IS NOT NULL;

-- 3. Reputation Credentials (computed attestations)
CREATE TABLE IF NOT EXISTS reputation_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_did text NOT NULL,
  credential_type text NOT NULL,
  category text,
  data jsonb NOT NULL,
  window_start timestamptz,
  window_end timestamptz,
  issued_at timestamptz NOT NULL DEFAULT now(),
  issuer_did text NOT NULL DEFAULT 'did:web:coinpayportal.com',
  signature text,
  revoked boolean NOT NULL DEFAULT false,
  revoked_at timestamptz
);

CREATE INDEX idx_reputation_credentials_agent ON reputation_credentials (agent_did);
CREATE INDEX idx_reputation_credentials_type ON reputation_credentials (credential_type);
CREATE INDEX idx_reputation_credentials_category ON reputation_credentials (category);
CREATE INDEX idx_reputation_credentials_revoked ON reputation_credentials (revoked) WHERE revoked = true;

-- 4. Reputation Revocations
CREATE TABLE IF NOT EXISTS reputation_revocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id uuid NOT NULL REFERENCES reputation_credentials(id) ON DELETE CASCADE,
  reason text NOT NULL,
  revoked_by text NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reputation_revocations_credential ON reputation_revocations (credential_id);
CREATE INDEX idx_reputation_revocations_date ON reputation_revocations (revoked_at DESC);
