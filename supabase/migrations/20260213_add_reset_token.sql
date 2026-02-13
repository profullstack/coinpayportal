-- Add password reset token columns to merchants table
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS reset_token TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;
