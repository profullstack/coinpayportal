-- Add is_admin field to merchants table
ALTER TABLE merchants 
ADD COLUMN is_admin BOOLEAN DEFAULT false NOT NULL;

-- Create index for admin queries
CREATE INDEX idx_merchants_is_admin ON merchants(is_admin) WHERE is_admin = true;

-- Add comment
COMMENT ON COLUMN merchants.is_admin IS 'Whether the merchant has admin privileges';