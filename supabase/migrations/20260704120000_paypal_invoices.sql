-- PayPal support for invoices.
--
-- Model mirrors Stripe Connect but merchants supply their OWN PayPal REST API
-- credentials (Client ID + Secret) per business. CoinPay creates and captures
-- orders directly on the merchant's PayPal account — funds land 100% in the
-- merchant's account (no platform application fee on the PayPal rail).
--
-- Like the rest of coinpayportal, authorization is enforced in the APP LAYER
-- (service-role client bypasses RLS). RLS is enabled with NO policies so direct
-- PostgREST (anon/authenticated) access is denied; all access flows through API
-- routes using the service-role key. See 20260615000000_team_members.sql.

-- =====================================================
-- PAYPAL ACCOUNTS (per business)
-- =====================================================
-- One connected PayPal account per business. The client secret is encrypted at
-- rest with a per-business derived key (deriveKey(ENCRYPTION_KEY, business_id))
-- via src/lib/paypal/accounts.ts — never stored in plaintext.
CREATE TABLE IF NOT EXISTS paypal_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
    business_id UUID NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
    paypal_client_id TEXT NOT NULL,
    paypal_client_secret_encrypted TEXT NOT NULL,
    environment TEXT NOT NULL DEFAULT 'live' CHECK (environment IN ('sandbox', 'live')),
    email TEXT,
    connected BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paypal_accounts_merchant ON paypal_accounts(merchant_id);

ALTER TABLE paypal_accounts ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_paypal_accounts_updated_at ON paypal_accounts;
CREATE TRIGGER update_paypal_accounts_updated_at BEFORE UPDATE ON paypal_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- PAYPAL TRANSACTIONS (captured invoice payments)
-- =====================================================
CREATE TABLE IF NOT EXISTS paypal_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
    business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    paypal_order_id TEXT NOT NULL UNIQUE,
    paypal_capture_id TEXT,
    payer_email TEXT,
    amount NUMERIC,
    currency TEXT DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'completed',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paypal_transactions_business ON paypal_transactions(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paypal_transactions_invoice ON paypal_transactions(invoice_id);

ALTER TABLE paypal_transactions ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_paypal_transactions_updated_at ON paypal_transactions;
CREATE TRIGGER update_paypal_transactions_updated_at BEFORE UPDATE ON paypal_transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- INVOICE COLUMNS
-- =====================================================
-- paypal_enabled: set true on send/enable when the business has a connected
--   PayPal account, so the public pay page shows the "Pay with PayPal" option.
-- paypal_order_id: the most recent PayPal order created for this invoice
--   (orders are created on-demand when the payer clicks pay; used to validate
--   the capture callback so an arbitrary order id can't be captured against it).
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS paypal_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS paypal_order_id TEXT;

CREATE INDEX IF NOT EXISTS idx_invoices_paypal_order_id ON invoices(paypal_order_id);
