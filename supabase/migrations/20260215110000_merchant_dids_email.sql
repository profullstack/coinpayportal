-- Add email column to merchant_dids for matching platform-registered DIDs
-- to merchants who sign up later
ALTER TABLE merchant_dids ADD COLUMN IF NOT EXISTS email text;
CREATE INDEX IF NOT EXISTS idx_merchant_dids_email ON merchant_dids(email) WHERE email IS NOT NULL;
