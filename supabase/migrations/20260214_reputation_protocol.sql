-- CoinPayPortal Reputation Protocol (CPR) - Phase 1
-- Migration: 20260213_reputation_protocol.sql

-- 1. Reputation Issuers — registered platforms that can submit receipts
CREATE TABLE IF NOT EXISTS reputation_issuers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  did text UNIQUE NOT NULL,
  name text NOT NULL,
  domain text,
  api_key_hash text,
  created_at timestamptz DEFAULT now(),
  active boolean DEFAULT true
);

-- 2. Reputation Receipts — immutable task receipts
CREATE TABLE IF NOT EXISTS reputation_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid UNIQUE NOT NULL,
  task_id uuid NOT NULL,
  agent_did text NOT NULL,
  buyer_did text NOT NULL,
  platform_did text,
  escrow_tx text,
  amount numeric,
  currency text,
  category text,
  sla jsonb,
  outcome text CHECK (outcome IN ('accepted', 'rejected', 'disputed')),
  dispute boolean DEFAULT false,
  artifact_hash text,
  signatures jsonb,
  created_at timestamptz DEFAULT now(),
  finalized_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_reputation_receipts_agent_did ON reputation_receipts(agent_did);
CREATE INDEX IF NOT EXISTS idx_reputation_receipts_buyer_did ON reputation_receipts(buyer_did);
CREATE INDEX IF NOT EXISTS idx_reputation_receipts_platform_did ON reputation_receipts(platform_did);
CREATE INDEX IF NOT EXISTS idx_reputation_receipts_category ON reputation_receipts(category);
CREATE INDEX IF NOT EXISTS idx_reputation_receipts_created_at ON reputation_receipts(created_at);

-- 3. Reputation Credentials — computed attestation credentials
CREATE TABLE IF NOT EXISTS reputation_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_did text NOT NULL,
  credential_type text NOT NULL,
  category text,
  data jsonb,
  window_start timestamptz,
  window_end timestamptz,
  issued_at timestamptz DEFAULT now(),
  issuer_did text DEFAULT 'did:web:coinpayportal.com',
  signature text,
  revoked boolean DEFAULT false,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_reputation_credentials_agent_did ON reputation_credentials(agent_did);
CREATE INDEX IF NOT EXISTS idx_reputation_credentials_type ON reputation_credentials(credential_type);
CREATE INDEX IF NOT EXISTS idx_reputation_credentials_category ON reputation_credentials(category);

-- 4. Reputation Revocations — revocation registry
CREATE TABLE IF NOT EXISTS reputation_revocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id uuid REFERENCES reputation_credentials(id) ON DELETE CASCADE,
  reason text,
  revoked_by text,
  revoked_at timestamptz DEFAULT now()
);

-- Seed CoinPayPortal as default issuer
INSERT INTO reputation_issuers (did, name, domain, active)
VALUES ('did:web:coinpayportal.com', 'CoinPayPortal', 'coinpayportal.com', true)
ON CONFLICT (did) DO NOTHING;
