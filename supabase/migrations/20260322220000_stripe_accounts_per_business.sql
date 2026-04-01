-- Migrate stripe_accounts from merchant-level to business-level
-- Each business gets its own Stripe Connect account
-- Nuke existing rows — merchants will re-onboard per business

-- Step 1: Drop all existing stripe accounts (force re-onboarding)
-- TRUNCATE stripe_accounts CASCADE;

-- Step 2: Add business_id column (NOT NULL from the start since table is empty)
-- ALTER TABLE stripe_accounts
--  ADD COLUMN business_id UUID NOT NULL REFERENCES businesses(id);

-- Step 3: Add unique constraint — one Stripe account per business
-- ALTER TABLE stripe_accounts
--  ADD CONSTRAINT stripe_accounts_business_id_key UNIQUE (business_id);

-- Step 4: Update RLS policy to allow lookup by business ownership
-- DROP POLICY IF EXISTS "Merchants can view their own Stripe accounts" ON stripe_accounts;

-- CREATE POLICY "Merchants can view their own Stripe accounts"
--   ON stripe_accounts FOR SELECT
--  TO authenticated
--  USING (
--    merchant_id = auth.uid()
--    OR business_id IN (
--      SELECT id FROM businesses WHERE merchant_id = auth.uid()
--    )
--  );
