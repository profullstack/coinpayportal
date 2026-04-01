-- ==============================================================================
-- CONSOLIDATED STRIPE & REPUTATION RESTORATION
-- This migration safely initializes tables that were referenced out-of-order 
-- in previous migrations, ensuring a clean setup for new installations.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. DID Reputation Events
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS did_reputation_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    did text NOT NULL,
    event_type text NOT NULL,
    details jsonb DEFAULT '{}',
    created_at timestamptz DEFAULT now()
);

ALTER TABLE did_reputation_events ENABLE ROW LEVEL SECURITY;

DO $$BEGIN
    CREATE POLICY "Anyone can view DID reputation events"
    ON did_reputation_events FOR SELECT
    TO authenticated, anon
    USING (true);
EXCEPTION
    WHEN duplicate_object THEN null;
END$$;

-- ------------------------------------------------------------------------------
-- 2. Stripe Base Tables
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stripe_accounts (
    id text PRIMARY KEY,
    merchant_id uuid REFERENCES merchants(id),
    business_id uuid UNIQUE REFERENCES businesses(id),
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stripe_transactions (
    id text PRIMARY KEY,
    merchant_id uuid REFERENCES merchants(id),
    amount numeric,
    currency text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stripe_disputes (
    id text PRIMARY KEY,
    merchant_id uuid REFERENCES merchants(id),
    transaction_id text REFERENCES stripe_transactions(id),
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stripe_payouts (
    id text PRIMARY KEY,
    merchant_id uuid REFERENCES merchants(id),
    amount numeric,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stripe_webhook_secrets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint_id text UNIQUE,
    business_id uuid UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
    secret text NOT NULL,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 3. Restore Missing Columns & Relationships
-- ------------------------------------------------------------------------------
ALTER TABLE stripe_transactions 
ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES businesses(id);

-- ------------------------------------------------------------------------------
-- 4. Enable Row-Level Security (RLS)
-- ------------------------------------------------------------------------------
ALTER TABLE stripe_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_webhook_secrets ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 5. Restore Missing Security Policies
-- ------------------------------------------------------------------------------
DO $$BEGIN
    CREATE POLICY "Merchants can view their own Stripe accounts"
    ON stripe_accounts FOR SELECT TO authenticated
    USING (
        merchant_id = auth.uid() 
        OR business_id IN (SELECT id FROM businesses WHERE merchant_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN null; END$$;

DO $$BEGIN
    CREATE POLICY "Merchants can view their own disputes"
    ON stripe_disputes FOR SELECT TO authenticated
    USING (merchant_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN null; END$$;

DO $$BEGIN
    CREATE POLICY "Merchants can view their own payouts"
    ON stripe_payouts FOR SELECT TO authenticated
    USING (merchant_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN null; END$$;

DO $$BEGIN
    CREATE POLICY "Merchants can view their own transactions"
    ON stripe_transactions FOR SELECT TO authenticated
    USING (business_id IN (SELECT id FROM businesses WHERE merchant_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN null; END$$;

DO $$BEGIN
    CREATE POLICY "Merchants can manage their webhook secrets"
    ON stripe_webhook_secrets FOR ALL TO authenticated
    USING (business_id IN (SELECT id FROM businesses WHERE merchant_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN null; END$$;

-- ------------------------------------------------------------------------------
-- 6. Indexes for stripe_webhook_secrets
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_secrets_endpoint ON stripe_webhook_secrets (endpoint_id);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_secrets_business ON stripe_webhook_secrets (business_id);
