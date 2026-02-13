-- Cleanup migration: ensure reputation_issuers has merchant_id column for self-service
-- The ugig.net row already exists in prod; this migration adds merchant ownership tracking
ALTER TABLE reputation_issuers ADD COLUMN IF NOT EXISTS merchant_id uuid REFERENCES merchants(id);
