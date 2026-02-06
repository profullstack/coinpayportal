-- Make payment_addresses compatible with escrow
-- Escrow addresses don't have a payment row or business — need nullable FKs

BEGIN;

-- 1. Drop the NOT NULL and FK constraint on payment_id
ALTER TABLE payment_addresses ALTER COLUMN payment_id DROP NOT NULL;
ALTER TABLE payment_addresses DROP CONSTRAINT IF EXISTS payment_addresses_payment_id_fkey;

-- 2. Drop the NOT NULL constraint on business_id (keep FK for non-null values)
ALTER TABLE payment_addresses ALTER COLUMN business_id DROP NOT NULL;

-- 3. Drop the unique constraint on payment_id (escrow addresses use null)
ALTER TABLE payment_addresses DROP CONSTRAINT IF EXISTS unique_payment_address;

-- Re-add as partial unique (only for non-null payment_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_addresses_unique_payment
  ON payment_addresses(payment_id) WHERE payment_id IS NOT NULL;

COMMENT ON COLUMN payment_addresses.payment_id IS 'References payments(id) for payment addresses, NULL for escrow addresses';
COMMENT ON COLUMN payment_addresses.business_id IS 'References businesses(id), NULL for anonymous escrow addresses';

COMMIT;
