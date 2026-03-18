-- Add missing nonce column to oauth_authorization_codes
ALTER TABLE oauth_authorization_codes ADD COLUMN IF NOT EXISTS nonce TEXT;
