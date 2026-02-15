-- Add GL device credentials column to ln_nodes
-- Stores the serialized Greenlight Credentials (hex-encoded) for authenticated node access
ALTER TABLE ln_nodes ADD COLUMN IF NOT EXISTS gl_creds text;
ALTER TABLE ln_nodes ADD COLUMN IF NOT EXISTS gl_rune text;
