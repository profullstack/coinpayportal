-- Create stripe_restricted_keys table
CREATE TABLE IF NOT EXISTS stripe_restricted_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_account_id text NOT NULL,
  stripe_key_id text NOT NULL,
  name text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '[]',
  livemode boolean NOT NULL DEFAULT true,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE stripe_restricted_keys ENABLE ROW LEVEL SECURITY;

-- Policy: authenticated users can select their own keys
DROP POLICY IF EXISTS "Users can view their own restricted keys" ON stripe_restricted_keys;
CREATE POLICY "Users can view their own restricted keys"
  ON stripe_restricted_keys FOR SELECT
  TO authenticated
  USING (business_id IN (SELECT id FROM businesses WHERE merchant_id = auth.uid()));

-- Policy: authenticated users can insert keys for their own businesses
DROP POLICY IF EXISTS "Users can create restricted keys for their businesses" ON stripe_restricted_keys;
CREATE POLICY "Users can create restricted keys for their businesses"
  ON stripe_restricted_keys FOR INSERT
  TO authenticated
  WITH CHECK (business_id IN (SELECT id FROM businesses WHERE merchant_id = auth.uid()));

-- Policy: authenticated users can delete their own keys
DROP POLICY IF EXISTS "Users can delete their own restricted keys" ON stripe_restricted_keys;
CREATE POLICY "Users can delete their own restricted keys"
  ON stripe_restricted_keys FOR DELETE
  TO authenticated
  USING (business_id IN (SELECT id FROM businesses WHERE merchant_id = auth.uid()));
