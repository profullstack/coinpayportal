-- Add settle_attempts counter to prevent infinite retry loops
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS settle_attempts integer DEFAULT 0;

-- Allow settle_failed status
ALTER TABLE escrows DROP CONSTRAINT IF EXISTS escrows_status_check;
ALTER TABLE escrows ADD CONSTRAINT escrows_status_check 
  CHECK (status IN ('pending', 'funded', 'released', 'refunded', 'settled', 'expired', 'cancelled', 'settle_failed', 'refund_failed'));
