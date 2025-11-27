-- Migration: Add Payment Monitoring Support
-- This migration:
-- 1. Updates the payments table to support 15-minute expiration
-- 2. Adds indexes for efficient monitoring queries
-- 3. Sets up pg_cron for scheduled monitoring (if available)

-- Ensure expires_at column exists and has proper default (15 minutes from creation)
DO $$
BEGIN
    -- Check if expires_at column exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'expires_at'
    ) THEN
        ALTER TABLE payments ADD COLUMN expires_at TIMESTAMPTZ;
    END IF;
END $$;

-- Update default for expires_at to be 15 minutes from now
ALTER TABLE payments 
ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '15 minutes');

-- Add index for efficient pending payment queries
CREATE INDEX IF NOT EXISTS idx_payments_status_expires 
ON payments (status, expires_at) 
WHERE status = 'pending';

-- Add index for monitoring queries
CREATE INDEX IF NOT EXISTS idx_payments_pending_monitoring 
ON payments (status, created_at, expires_at) 
WHERE status IN ('pending', 'confirmed');

-- Add payment_address column if it doesn't exist (for quick lookups)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'payment_address'
    ) THEN
        ALTER TABLE payments ADD COLUMN payment_address TEXT;
    END IF;
END $$;

-- Create index on payment_address for balance checking
CREATE INDEX IF NOT EXISTS idx_payments_address 
ON payments (payment_address) 
WHERE payment_address IS NOT NULL;

-- Add expired status to the status check constraint if it exists
-- First, drop the old constraint if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'payments_status_check' 
        AND table_name = 'payments'
    ) THEN
        ALTER TABLE payments DROP CONSTRAINT payments_status_check;
    END IF;
END $$;

-- Add new constraint with expired status
ALTER TABLE payments ADD CONSTRAINT payments_status_check 
CHECK (status IN ('pending', 'confirmed', 'forwarding', 'forwarded', 'forwarding_failed', 'expired', 'cancelled'));

-- Update any existing payments without expires_at to have 15 minutes from creation
UPDATE payments 
SET expires_at = created_at + INTERVAL '15 minutes'
WHERE expires_at IS NULL;

-- Create a function to automatically expire old pending payments
-- This can be called by pg_cron or manually
CREATE OR REPLACE FUNCTION expire_pending_payments()
RETURNS TABLE (
    expired_count INTEGER,
    payment_ids UUID[]
) AS $$
DECLARE
    v_expired_count INTEGER;
    v_payment_ids UUID[];
BEGIN
    -- Get IDs of payments to expire
    SELECT ARRAY_AGG(id) INTO v_payment_ids
    FROM payments
    WHERE status = 'pending'
    AND expires_at < NOW();
    
    -- Update status to expired
    UPDATE payments
    SET 
        status = 'expired',
        updated_at = NOW()
    WHERE status = 'pending'
    AND expires_at < NOW();
    
    GET DIAGNOSTICS v_expired_count = ROW_COUNT;
    
    RETURN QUERY SELECT v_expired_count, COALESCE(v_payment_ids, ARRAY[]::UUID[]);
END;
$$ LANGUAGE plpgsql;

-- Create a function to get pending payments for monitoring
CREATE OR REPLACE FUNCTION get_pending_payments_for_monitoring(p_limit INTEGER DEFAULT 100)
RETURNS TABLE (
    id UUID,
    business_id UUID,
    blockchain TEXT,
    crypto_amount NUMERIC,
    status TEXT,
    payment_address TEXT,
    created_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    merchant_wallet_address TEXT,
    time_remaining INTERVAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.business_id,
        p.blockchain,
        p.crypto_amount,
        p.status,
        p.payment_address,
        p.created_at,
        p.expires_at,
        p.merchant_wallet_address,
        (p.expires_at - NOW()) AS time_remaining
    FROM payments p
    WHERE p.status = 'pending'
    AND p.expires_at > NOW()
    AND p.payment_address IS NOT NULL
    ORDER BY p.created_at ASC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Create a view for monitoring dashboard
CREATE OR REPLACE VIEW payment_monitoring_stats AS
SELECT 
    COUNT(*) FILTER (WHERE status = 'pending' AND expires_at > NOW()) AS active_pending,
    COUNT(*) FILTER (WHERE status = 'pending' AND expires_at <= NOW()) AS expired_pending,
    COUNT(*) FILTER (WHERE status = 'confirmed') AS awaiting_forward,
    COUNT(*) FILTER (WHERE status = 'forwarding') AS currently_forwarding,
    COUNT(*) FILTER (WHERE status = 'forwarded' AND updated_at > NOW() - INTERVAL '1 hour') AS recently_forwarded,
    COUNT(*) FILTER (WHERE status = 'expired' AND updated_at > NOW() - INTERVAL '1 hour') AS recently_expired,
    COUNT(*) FILTER (WHERE status = 'forwarding_failed') AS failed_forwarding
FROM payments;

-- Grant access to the view
GRANT SELECT ON payment_monitoring_stats TO authenticated;
GRANT SELECT ON payment_monitoring_stats TO service_role;

-- Note: pg_cron setup requires superuser privileges and is typically done
-- in the Supabase dashboard or via the Supabase CLI with proper permissions.
-- The following is commented out but shows the intended setup:

/*
-- Enable pg_cron extension (requires superuser)
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the monitor function to run every minute
-- SELECT cron.schedule(
--     'expire-pending-payments',
--     '* * * * *',  -- Every minute
--     $$SELECT expire_pending_payments()$$
-- );

-- Schedule the edge function to run every minute for balance checking
-- This would be configured in the Supabase dashboard under Edge Functions > Schedules
*/

-- Add comment explaining the monitoring system
COMMENT ON FUNCTION expire_pending_payments() IS 
'Automatically expires pending payments that have exceeded their 15-minute window. 
Should be called periodically via pg_cron or the monitor-payments edge function.';

COMMENT ON FUNCTION get_pending_payments_for_monitoring(INTEGER) IS 
'Returns pending payments that need to be checked for incoming blockchain transactions.
Used by the monitor-payments edge function.';