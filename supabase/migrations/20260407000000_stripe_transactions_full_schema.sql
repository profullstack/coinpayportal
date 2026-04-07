-- Bring stripe_transactions up to the schema the application code has been
-- silently writing to (and reading from) for months.
--
-- Background: the consolidate migration (20260330044655) recreated this
-- table with only {id text PK, merchant_id, amount, currency, created_at}
-- + business_id added later. Every other column the webhook handler tries
-- to insert (status, rail, platform_fee_amount, stripe_payment_intent_id,
-- stripe_charge_id, stripe_balance_txn_id, stripe_fee_amount, net_to_merchant,
-- updated_at) silently dropped or errored out — and the dashboard's
-- /api/stripe/transactions query selects every one of those columns.
--
-- Symptom: completed Stripe Checkout payments never appeared on the
-- merchant's "Credit card transactions" tab and the merchant webhook was
-- never fired (the row insert failed before sendPaymentWebhook ran in some
-- code paths, and the row was missing business_id in others).
--
-- Also: switch the primary key from `text` (which the handler never set)
-- to a uuid default so inserts that don't supply an id work.

ALTER TABLE stripe_transactions
  ADD COLUMN IF NOT EXISTS status              text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS rail                text DEFAULT 'card',
  ADD COLUMN IF NOT EXISTS platform_fee_amount bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stripe_fee_amount   bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_to_merchant     bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS stripe_charge_id    text,
  ADD COLUMN IF NOT EXISTS stripe_balance_txn_id text,
  ADD COLUMN IF NOT EXISTS updated_at          timestamptz DEFAULT now();

-- Convert id to uuid with default if it's still text. Existing text rows
-- (if any) are preserved by casting through text → uuid where possible.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stripe_transactions'
      AND column_name = 'id'
      AND data_type = 'text'
  ) THEN
    -- Drop the FK that stripe_disputes has on this column so we can swap types
    ALTER TABLE stripe_disputes DROP CONSTRAINT IF EXISTS stripe_disputes_transaction_id_fkey;
    ALTER TABLE stripe_transactions ALTER COLUMN id DROP DEFAULT;
    ALTER TABLE stripe_transactions ALTER COLUMN id TYPE uuid USING
      CASE WHEN id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN id::uuid ELSE gen_random_uuid() END;
    ALTER TABLE stripe_transactions ALTER COLUMN id SET DEFAULT gen_random_uuid();
    -- Drop the dispute FK rather than try to recast it; the disputes table
    -- itself only has a couple legacy rows (or none) and doesn't gate the fix.
    ALTER TABLE stripe_disputes ALTER COLUMN transaction_id TYPE uuid USING NULL;
  END IF;
END $$;

-- Indexes that the dashboard query needs
CREATE INDEX IF NOT EXISTS idx_stripe_transactions_business_id
  ON stripe_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_stripe_transactions_merchant_id
  ON stripe_transactions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_stripe_transactions_status
  ON stripe_transactions(status);

-- Unique on stripe_payment_intent_id so upserts from both
-- checkout.session.completed and payment_intent.succeeded converge on the
-- same row instead of duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_transactions_payment_intent_uq
  ON stripe_transactions(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

COMMENT ON TABLE stripe_transactions IS
  'Card-rail (Stripe) transaction records — written by /api/stripe/webhook on checkout.session.completed and payment_intent.succeeded, read by /api/stripe/transactions for the merchant dashboard.';
