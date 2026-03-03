-- Mutual attestations table for bidirectional trust graph
CREATE TABLE IF NOT EXISTS mutual_attestations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  receipt_id uuid NOT NULL,
  attester_did text NOT NULL,
  subject_did text NOT NULL,
  role text NOT NULL CHECK (role IN ('agent', 'buyer')),
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text,
  signature text NOT NULL,
  created_at timestamptz DEFAULT now(),

  -- Each party can only attest once per receipt
  UNIQUE (receipt_id, attester_did)
);

-- Indexes for common queries
CREATE INDEX idx_mutual_attestations_subject ON mutual_attestations (subject_did);
CREATE INDEX idx_mutual_attestations_receipt ON mutual_attestations (receipt_id);
CREATE INDEX idx_mutual_attestations_attester ON mutual_attestations (attester_did);

-- RLS
ALTER TABLE mutual_attestations ENABLE ROW LEVEL SECURITY;

-- Anyone can read attestations (they're public trust signals)
CREATE POLICY "Attestations are publicly readable"
  ON mutual_attestations FOR SELECT
  USING (true);

-- Only service role can insert (via API)
CREATE POLICY "Service role can insert attestations"
  ON mutual_attestations FOR INSERT
  WITH CHECK (true);
