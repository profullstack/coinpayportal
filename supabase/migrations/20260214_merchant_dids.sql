CREATE TABLE merchant_dids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid UNIQUE REFERENCES merchants(id) ON DELETE CASCADE,
  did text UNIQUE NOT NULL,
  public_key text NOT NULL,
  private_key_encrypted text,
  created_at timestamptz DEFAULT now(),
  verified boolean DEFAULT true
);
CREATE INDEX idx_merchant_dids_did ON merchant_dids(did);
CREATE INDEX idx_merchant_dids_merchant ON merchant_dids(merchant_id);
