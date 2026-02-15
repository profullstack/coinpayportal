-- Allow multiple platform-registered DIDs without a merchant_id
-- The UNIQUE constraint on merchant_id blocks multiple NULLs in some PG versions
-- Replace with a partial unique index that only applies to non-null values
ALTER TABLE merchant_dids DROP CONSTRAINT IF EXISTS merchant_dids_merchant_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_dids_merchant_unique 
  ON merchant_dids(merchant_id) WHERE merchant_id IS NOT NULL;

-- Add optional platform column for tracking where the DID was registered from
ALTER TABLE merchant_dids ADD COLUMN IF NOT EXISTS platform text;
