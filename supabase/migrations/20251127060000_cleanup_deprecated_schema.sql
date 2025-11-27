-- Schema Cleanup Migration
-- Removes deprecated columns and consolidates the payment system
-- 
-- The new payment flow uses:
-- 1. system_wallet_indexes - tracks derivation indexes for system HD wallet
-- 2. payment_addresses (new) - stores derived addresses with forwarding info
-- 3. business_wallets - stores merchant wallet addresses for receiving funds
--
-- Deprecated:
-- - payment_addresses (old) - was for merchant-owned addresses
-- - payments.payment_address_id - no longer needed
-- - payments.merchant_wallet_address - looked up from business_wallets

-- =====================================================
-- STEP 1: Make deprecated columns nullable
-- =====================================================

-- Make payment_address_id nullable (was required for old flow)
ALTER TABLE payments ALTER COLUMN payment_address_id DROP NOT NULL;

-- Make merchant_wallet_address nullable (now looked up from business_wallets)
ALTER TABLE payments ALTER COLUMN merchant_wallet_address DROP NOT NULL;

-- =====================================================
-- STEP 2: Drop the old payment_addresses table
-- The new one was created in 20251127040000_add_system_wallet_support.sql
-- =====================================================

-- First check if the old table exists and drop it
-- The new payment_addresses table has different columns:
-- - payment_id (links to payment)
-- - merchant_wallet (where to forward)
-- - commission_wallet (where commission goes)
-- - encrypted_private_key (for forwarding)
-- - amount_expected, commission_amount, merchant_amount

-- Note: The 20251127040000 migration already dropped and recreated payment_addresses
-- So we just need to clean up the payments table

-- =====================================================
-- STEP 3: Drop deprecated columns from payments table
-- =====================================================

-- Drop payment_address_id column (no longer used)
ALTER TABLE payments DROP COLUMN IF EXISTS payment_address_id;

-- =====================================================
-- STEP 4: Add new columns if they don't exist
-- =====================================================

-- Ensure payment_address column exists (stores the address customers pay to)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payments' AND column_name = 'payment_address'
  ) THEN
    ALTER TABLE payments ADD COLUMN payment_address VARCHAR(255);
  END IF;
END $$;

-- Create index on payment_address if not exists
CREATE INDEX IF NOT EXISTS idx_payments_payment_address ON payments(payment_address);

-- =====================================================
-- STEP 5: Update comments
-- =====================================================

COMMENT ON COLUMN payments.payment_address IS 'The unique address customers pay to (derived from system HD wallet)';
COMMENT ON COLUMN payments.merchant_wallet_address IS 'Deprecated - merchant wallet is now looked up from business_wallets table';

-- =====================================================
-- STEP 6: Clean up any orphaned data
-- =====================================================

-- No data cleanup needed for fresh installs
-- For existing installs, old payment_address_id references are now NULL

-- =====================================================
-- Summary of current payment flow:
-- =====================================================
-- 1. Customer initiates payment
-- 2. System generates unique address from HD wallet (system_wallet_indexes)
-- 3. Address stored in payment_addresses table with forwarding info
-- 4. payment.payment_address set to the generated address
-- 5. Customer pays to payment_address
-- 6. After confirmation:
--    - 0.5% commission sent to PLATFORM_FEE_WALLET_*
--    - 99.5% forwarded to merchant's wallet (from business_wallets)