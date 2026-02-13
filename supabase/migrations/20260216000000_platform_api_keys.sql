-- Add api_key column to reputation_issuers for platform authentication
ALTER TABLE reputation_issuers ADD COLUMN IF NOT EXISTS api_key text UNIQUE;
