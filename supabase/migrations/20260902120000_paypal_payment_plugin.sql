-- PayPal as a first-class payment rail (the Stripe Connect analogue).
--
-- The first PayPal migration (20260704120000_paypal_invoices.sql) supported ONE
-- mode: a merchant pastes their own REST app client id + secret and CoinPay
-- calls PayPal as them. That cannot carry a platform commission, because PayPal
-- rejects `platform_fees` on a first-party order.
--
-- This adds the partner mode: CoinPay onboards merchants through PayPal Partner
-- Referrals, holds their `merchant_id_in_paypal`, and creates orders on their
-- behalf with a `platform_fees` cut — the same economics as the Stripe Connect
-- destination charge. Both modes coexist; `connection_mode` says which one a
-- row is, and src/lib/paypal/accounts.ts resolves either into one calling
-- context.
--
-- Authorization is enforced in the APP LAYER (the service-role client bypasses
-- RLS). RLS is enabled with NO policies so direct PostgREST access is denied.

-- =====================================================
-- PAYPAL ACCOUNTS — partner onboarding columns
-- =====================================================
ALTER TABLE paypal_accounts
  ADD COLUMN IF NOT EXISTS connection_mode TEXT NOT NULL DEFAULT 'self_serve'
    CHECK (connection_mode IN ('self_serve', 'partner')),
  -- The merchant's PayPal payer id. This is what PayPal-Auth-Assertion must
  -- carry; sending our business uuid there yields an opaque 401.
  ADD COLUMN IF NOT EXISTS merchant_id_in_paypal TEXT,
  -- We use the business id as PayPal's tracking_id, which PayPal enforces
  -- unique per partner, so a re-onboard updates rather than orphans.
  ADD COLUMN IF NOT EXISTS tracking_id TEXT,
  ADD COLUMN IF NOT EXISTS partner_referral_id TEXT,
  -- PayPal's equivalents of charges_enabled / details_submitted.
  ADD COLUMN IF NOT EXISTS payments_receivable BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS primary_email_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS oauth_third_party_granted BOOLEAN NOT NULL DEFAULT FALSE,
  -- Granted permission scopes, so the dashboard can say WHY a panel is empty
  -- (a merchant who declined the reporting scope gets 403s on balance reads).
  ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS product_status TEXT,
  ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS last_status_check_at TIMESTAMP WITH TIME ZONE;

-- A partner-mode account has no stored credentials of its own, so the original
-- NOT NULL constraints have to go. Self-serve rows are still validated in the
-- app layer, and the CHECK below keeps each mode internally consistent.
ALTER TABLE paypal_accounts ALTER COLUMN paypal_client_id DROP NOT NULL;
ALTER TABLE paypal_accounts ALTER COLUMN paypal_client_secret_encrypted DROP NOT NULL;

-- Each mode must carry the fields it actually needs. NOT VALID skips only the
-- rows that already exist; every INSERT and UPDATE from here on IS checked.
ALTER TABLE paypal_accounts DROP CONSTRAINT IF EXISTS paypal_accounts_mode_fields;
ALTER TABLE paypal_accounts ADD CONSTRAINT paypal_accounts_mode_fields CHECK (
  (connection_mode = 'self_serve'
     AND paypal_client_id IS NOT NULL
     AND paypal_client_secret_encrypted IS NOT NULL)
  OR
  -- merchant_id_in_paypal is null between "referral created" and "merchant came
  -- back", so it cannot be required here; the payment path checks it instead.
  (connection_mode = 'partner')
) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_paypal_accounts_merchant_in_paypal
  ON paypal_accounts(merchant_id_in_paypal)
  WHERE merchant_id_in_paypal IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_paypal_accounts_tracking ON paypal_accounts(tracking_id);

-- Backfill: everything that existed before this migration is self-serve, and a
-- connected self-serve account can receive payments by definition.
UPDATE paypal_accounts
   SET payments_receivable = TRUE
 WHERE connection_mode = 'self_serve' AND connected = TRUE AND payments_receivable = FALSE;

-- =====================================================
-- PAYPAL TRANSACTIONS — general payments, not just invoices
-- =====================================================
-- MONEY UNITS: paypal_transactions.amount is NUMERIC in MAJOR units (10.00 =
-- ten dollars), matching PayPal's own decimal-string API. This is deliberately
-- NOT the same representation as stripe_transactions.amount, which is a bigint
-- of MINOR units. Multiply by 100 before comparing the two, and beware
-- zero-decimal currencies (JPY) where that factor is wrong.
ALTER TABLE paypal_transactions
  ADD COLUMN IF NOT EXISTS connection_mode TEXT NOT NULL DEFAULT 'self_serve'
    CHECK (connection_mode IN ('self_serve', 'partner')),
  -- Platform commission. Always 0 on self-serve — PayPal will not let a
  -- first-party order carry a platform fee, so that mode earns CoinPay nothing.
  ADD COLUMN IF NOT EXISTS platform_fee_amount NUMERIC NOT NULL DEFAULT 0,
  -- PayPal's own processing fee, from seller_receivable_breakdown at capture.
  ADD COLUMN IF NOT EXISTS paypal_fee_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS net_to_merchant NUMERIC,
  ADD COLUMN IF NOT EXISTS invoice_number TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS customer_name TEXT,
  ADD COLUMN IF NOT EXISTS customer_email TEXT,
  ADD COLUMN IF NOT EXISTS payer_id TEXT,
  ADD COLUMN IF NOT EXISTS payee_merchant_id TEXT,
  ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paypal_refund_id TEXT,
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS captured_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Rows are now created at order time, before the payer has approved anything,
-- so 'pending' is the honest default. The invoice capture flow writes
-- 'completed' explicitly and is unaffected.
ALTER TABLE paypal_transactions ALTER COLUMN status SET DEFAULT 'pending';

-- Statuses this rail actually writes. Deliberately a superset of what the code
-- emits today: 'expired' and 'canceled' come from webhooks we may not yet
-- handle, and a CHECK that rejects them would turn an unhandled event into a
-- failed write rather than an ignored one.
ALTER TABLE paypal_transactions DROP CONSTRAINT IF EXISTS paypal_transactions_status_check;
ALTER TABLE paypal_transactions ADD CONSTRAINT paypal_transactions_status_check CHECK (
  status IN (
    'pending', 'approved', 'completed', 'declined', 'failed',
    'refunded', 'partially_refunded', 'canceled', 'expired'
  )
) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_paypal_transactions_status
  ON paypal_transactions(business_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paypal_transactions_capture
  ON paypal_transactions(paypal_capture_id)
  WHERE paypal_capture_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_paypal_transactions_invoice_number
  ON paypal_transactions(invoice_number)
  WHERE invoice_number IS NOT NULL;

-- =====================================================
-- PAYPAL WEBHOOK EVENTS — idempotency ledger
-- =====================================================
-- PayPal retries a webhook until it gets a 2xx, and delivers some events more
-- than once regardless. Capture is not idempotent on our side (it moves a row
-- to completed and fires a merchant webhook), so every handler claims the event
-- id here first. The UNIQUE constraint is the lock: a duplicate delivery loses
-- the insert and returns 200 without reprocessing.
CREATE TABLE IF NOT EXISTS paypal_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paypal_event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    resource_type TEXT,
    business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
    -- Kept for support: PayPal's console shows the event, this shows what we did
    -- with it. Truncated by the writer, not by the column, so a large event is
    -- stored rather than rejected.
    payload JSONB,
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    processing_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paypal_webhook_events_type
  ON paypal_webhook_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paypal_webhook_events_business
  ON paypal_webhook_events(business_id, created_at DESC);

ALTER TABLE paypal_webhook_events ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_paypal_webhook_events_updated_at ON paypal_webhook_events;
CREATE TRIGGER update_paypal_webhook_events_updated_at BEFORE UPDATE ON paypal_webhook_events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
