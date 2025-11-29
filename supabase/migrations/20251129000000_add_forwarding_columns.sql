-- Migration: Add Forwarding Columns to Payments Table
-- This migration adds columns needed for tracking payment forwarding details

-- Add merchant_amount column to store the amount sent to merchant
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'merchant_amount'
    ) THEN
        ALTER TABLE payments ADD COLUMN merchant_amount NUMERIC;
    END IF;
END $$;

-- Add fee_amount column to store the platform fee
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'fee_amount'
    ) THEN
        ALTER TABLE payments ADD COLUMN fee_amount NUMERIC;
    END IF;
END $$;

-- Add forward_tx_hash column to store the forwarding transaction hash
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'forward_tx_hash'
    ) THEN
        ALTER TABLE payments ADD COLUMN forward_tx_hash TEXT;
    END IF;
END $$;

-- Add forwarded_at column to store when the payment was forwarded
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'forwarded_at'
    ) THEN
        ALTER TABLE payments ADD COLUMN forwarded_at TIMESTAMPTZ;
    END IF;
END $$;

-- Add confirmed_at column to store when the payment was confirmed
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'confirmed_at'
    ) THEN
        ALTER TABLE payments ADD COLUMN confirmed_at TIMESTAMPTZ;
    END IF;
END $$;

-- Add tx_hash column to store the incoming transaction hash
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'tx_hash'
    ) THEN
        ALTER TABLE payments ADD COLUMN tx_hash TEXT;
    END IF;
END $$;

-- Add index on forward_tx_hash for lookups
CREATE INDEX IF NOT EXISTS idx_payments_forward_tx_hash 
ON payments (forward_tx_hash) 
WHERE forward_tx_hash IS NOT NULL;

-- Add index on tx_hash for lookups
CREATE INDEX IF NOT EXISTS idx_payments_tx_hash 
ON payments (tx_hash) 
WHERE tx_hash IS NOT NULL;

-- Add comments explaining the columns
COMMENT ON COLUMN payments.merchant_amount IS 'Amount sent to the merchant wallet (after platform fee deduction)';
COMMENT ON COLUMN payments.fee_amount IS 'Platform fee amount (0.5% of the payment)';
COMMENT ON COLUMN payments.forward_tx_hash IS 'Transaction hash of the forwarding transaction to merchant/platform wallets';
COMMENT ON COLUMN payments.forwarded_at IS 'Timestamp when the payment was forwarded to merchant';
COMMENT ON COLUMN payments.confirmed_at IS 'Timestamp when the payment was confirmed on the blockchain';
COMMENT ON COLUMN payments.tx_hash IS 'Transaction hash of the incoming payment from the customer';