-- Add API key support to businesses table
-- This migration adds columns for storing and tracking API keys per business

-- Add api_key column (unique, indexed for fast lookups)
ALTER TABLE businesses 
  ADD COLUMN api_key TEXT UNIQUE,
  ADD COLUMN api_key_created_at TIMESTAMP WITH TIME ZONE;

-- Create index for fast API key lookups
CREATE INDEX idx_businesses_api_key ON businesses(api_key) WHERE api_key IS NOT NULL;

-- Add comment explaining the column
COMMENT ON COLUMN businesses.api_key IS 'Business API key for authentication (format: cp_live_xxxxx...)';
COMMENT ON COLUMN businesses.api_key_created_at IS 'Timestamp when the API key was created or last regenerated';