-- Multisig Escrow Support
-- Adds 2-of-3 multisig escrow model alongside existing custodial escrow.
-- CoinPay never holds funds unilaterally — requires 2 of 3 signers.

BEGIN;

-- ============================================================
-- 1. Add multisig columns to escrows table
-- ============================================================
ALTER TABLE escrows
  ADD COLUMN IF NOT EXISTS escrow_model TEXT NOT NULL DEFAULT 'custodial'
    CHECK (escrow_model IN ('custodial', 'multisig_2of3')),
  ADD COLUMN IF NOT EXISTS threshold SMALLINT DEFAULT NULL
    CHECK (threshold IS NULL OR (threshold >= 2 AND threshold <= 3)),
  ADD COLUMN IF NOT EXISTS depositor_pubkey TEXT,
  ADD COLUMN IF NOT EXISTS beneficiary_pubkey TEXT,
  ADD COLUMN IF NOT EXISTS arbiter_pubkey TEXT,
  ADD COLUMN IF NOT EXISTS chain_metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS dispute_status TEXT
    CHECK (dispute_status IS NULL OR dispute_status IN (
      'open', 'under_review', 'resolved_release', 'resolved_refund'
    ));

-- Update status CHECK to include 'pending' (used by multisig flow)
-- The existing CHECK allows 'created' but the code uses 'pending'.
-- Add 'pending' to the allowed values if not present.
ALTER TABLE escrows DROP CONSTRAINT IF EXISTS escrows_status_check;
ALTER TABLE escrows ADD CONSTRAINT escrows_status_check CHECK (status IN (
  'created', 'pending', 'funded', 'released', 'settled',
  'disputed', 'refunded', 'expired'
));

-- Update escrow_events event_type CHECK to include multisig events
ALTER TABLE escrow_events DROP CONSTRAINT IF EXISTS escrow_events_event_type_check;
ALTER TABLE escrow_events ADD CONSTRAINT escrow_events_event_type_check CHECK (event_type IN (
  'created', 'pending', 'funded', 'released', 'settled',
  'disputed', 'dispute_resolved', 'refunded', 'expired',
  'metadata_updated',
  'multisig_created', 'proposal_created', 'signature_added', 'tx_broadcast'
));

-- Update chain CHECK to include additional EVM chains
ALTER TABLE escrows DROP CONSTRAINT IF EXISTS escrows_chain_check;
ALTER TABLE escrows ADD CONSTRAINT escrows_chain_check CHECK (chain IN (
  'BTC', 'BCH', 'ETH', 'POL', 'SOL',
  'DOGE', 'XRP', 'ADA', 'BNB',
  'USDT', 'USDC',
  'USDC_ETH', 'USDC_POL', 'USDC_SOL',
  'BASE', 'ARB', 'OP', 'AVAX',
  'LTC'
));

CREATE INDEX IF NOT EXISTS idx_escrows_escrow_model ON escrows(escrow_model);

-- ============================================================
-- 2. multisig_proposals — tracks proposed transactions
-- ============================================================
CREATE TABLE IF NOT EXISTS multisig_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id UUID NOT NULL REFERENCES escrows(id) ON DELETE CASCADE,
  proposal_type TEXT NOT NULL CHECK (proposal_type IN ('release', 'refund')),
  to_address TEXT NOT NULL,
  amount NUMERIC(30, 18) NOT NULL,
  chain_tx_data JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'executed', 'cancelled'
  )),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  executed_at TIMESTAMPTZ,
  tx_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_multisig_proposals_escrow ON multisig_proposals(escrow_id);
CREATE INDEX IF NOT EXISTS idx_multisig_proposals_status ON multisig_proposals(status);

-- ============================================================
-- 3. multisig_signatures — tracks collected signatures
-- ============================================================
CREATE TABLE IF NOT EXISTS multisig_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES multisig_proposals(id) ON DELETE CASCADE,
  signer_role TEXT NOT NULL CHECK (signer_role IN ('depositor', 'beneficiary', 'arbiter')),
  signer_pubkey TEXT NOT NULL,
  signature TEXT NOT NULL,
  signed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(proposal_id, signer_role)
);

CREATE INDEX IF NOT EXISTS idx_multisig_signatures_proposal ON multisig_signatures(proposal_id);

-- ============================================================
-- 4. RLS Policies for new tables
-- ============================================================
ALTER TABLE multisig_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE multisig_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to multisig_proposals"
  ON multisig_proposals FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access to multisig_signatures"
  ON multisig_signatures FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 5. Comments
-- ============================================================
COMMENT ON COLUMN escrows.escrow_model IS 'custodial = HD wallet, multisig_2of3 = 2-of-3 multisig';
COMMENT ON COLUMN escrows.threshold IS 'Number of signatures required (always 2 for multisig_2of3)';
COMMENT ON COLUMN escrows.chain_metadata IS 'Chain-specific data: Safe address, witness script, multisig PDA, etc.';
COMMENT ON COLUMN escrows.dispute_status IS 'Dispute sub-status for arbiter resolution tracking';
COMMENT ON TABLE multisig_proposals IS 'Proposed transactions for multisig escrows';
COMMENT ON TABLE multisig_signatures IS 'Signatures collected for multisig proposals';

COMMIT;
