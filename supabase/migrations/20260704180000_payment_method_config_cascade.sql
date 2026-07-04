-- W5: Payment method configuration cascade (platform -> business -> merchant).
--
-- Three stored layers, resolved at runtime into an effective per-business config
-- (see src/lib/payment-methods/resolver.ts):
--
--   payment_method_catalog     platform: every method, integration config,
--                              global defaults, feature flags, force_disabled
--                              kill switch.
--     v inherits
--   business_payment_policy     legal entity (a coinpayportal `business` — the
--                              unit that owns the Stripe/PayPal connected
--                              account and gets underwritten): whether a method
--                              is unlocked, compliance status, entity params.
--     v inherits
--   merchant_payment_settings   store presentation/preference: enable within the
--                              unlocked set, per-method min/max, display, currency.
--
-- TERMINOLOGY: the PRD separates "business (legal entity)" from "merchant (store)".
-- coinpayportal has no store entity below `business`, so BOTH lower layers key on
-- business_id but stay distinct tables (compliance facts vs. presentation), which
-- preserves the restrict-only cascade and leaves room for a future store split.
--
-- Restrict-only invariant + kill switch are enforced at MERGE time in the
-- resolver, and at WRITE time in src/lib/payment-methods/policy.ts.
--
-- As with the rest of coinpayportal, authorization is enforced in the app layer;
-- RLS is enabled with no policies so only the service-role key can read/write.

-- =====================================================
-- PLATFORM CATALOG
-- =====================================================
CREATE TABLE IF NOT EXISTS payment_method_catalog (
    method_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    -- How the method is actually processed. Drives which integration code runs.
    integration_type TEXT NOT NULL,
    -- published: businesses may unlock it. Unpublished = built but not GA.
    published BOOLEAN NOT NULL DEFAULT FALSE,
    -- force_disabled: platform kill switch. Overrides every lower layer instantly.
    force_disabled BOOLEAN NOT NULL DEFAULT FALSE,
    -- Global defaults merged under business/merchant config (e.g. default risk policy).
    default_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    feature_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
    sort_order INTEGER NOT NULL DEFAULT 100,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE payment_method_catalog ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_payment_method_catalog_updated_at ON payment_method_catalog;
CREATE TRIGGER update_payment_method_catalog_updated_at BEFORE UPDATE ON payment_method_catalog
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- BUSINESS (LEGAL ENTITY) POLICY
-- =====================================================
CREATE TABLE IF NOT EXISTS business_payment_policy (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    method_id TEXT NOT NULL REFERENCES payment_method_catalog(method_id) ON DELETE CASCADE,
    -- unlocked: cleared for this entity. blocked: explicitly denied (compliance/
    -- processor suspension). pending_review: awaiting underwriting/onboarding.
    status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('unlocked', 'blocked', 'pending_review')),
    -- Entity-level money-movement params: hold thresholds, receiving_account_ref
    -- (Zelle), min/max bounds the store layer must stay within, etc.
    entity_params JSONB NOT NULL DEFAULT '{}'::jsonb,
    compliance_ref TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (business_id, method_id)
);

CREATE INDEX IF NOT EXISTS idx_business_payment_policy_business ON business_payment_policy(business_id);

ALTER TABLE business_payment_policy ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_business_payment_policy_updated_at ON business_payment_policy;
CREATE TRIGGER update_business_payment_policy_updated_at BEFORE UPDATE ON business_payment_policy
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- MERCHANT (STORE) SETTINGS
-- =====================================================
CREATE TABLE IF NOT EXISTS merchant_payment_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    method_id TEXT NOT NULL REFERENCES payment_method_catalog(method_id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    -- Presentation / preference. min/max in the business's major currency unit.
    min_order_value NUMERIC,
    max_order_value NUMERIC,
    currency_allowlist TEXT[],
    display_order INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (business_id, method_id)
);

CREATE INDEX IF NOT EXISTS idx_merchant_payment_settings_business ON merchant_payment_settings(business_id);

ALTER TABLE merchant_payment_settings ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_merchant_payment_settings_updated_at ON merchant_payment_settings;
CREATE TRIGGER update_merchant_payment_settings_updated_at BEFORE UPDATE ON merchant_payment_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- SEED CATALOG
-- =====================================================
-- Existing rails are published. New PRD methods are seeded unpublished (built
-- out per workstream, flipped to published at GA). force_disabled defaults false.
INSERT INTO payment_method_catalog (method_id, display_name, integration_type, published, sort_order)
VALUES
    ('crypto',      'Crypto',        'crypto',               TRUE,  10),
    ('card',        'Card',          'stripe',               TRUE,  20),
    ('paypal',      'PayPal',        'paypal',               TRUE,  30),
    ('venmo',       'Venmo',         'paypal',               FALSE, 40),
    ('cashapp',     'Cash App Pay',  'stripe_wallet',        FALSE, 50),
    ('applepay',    'Apple Pay',     'stripe_wallet',        FALSE, 60),
    ('googlepay',   'Google Pay',    'stripe_wallet',        FALSE, 70),
    ('pay_by_bank', 'Pay by Bank',   'plaid_transfer',       FALSE, 80),
    ('zelle',       'Zelle',         'zelle_deposit_match',  FALSE, 90)
ON CONFLICT (method_id) DO NOTHING;
