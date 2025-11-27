-- Subscription and Entitlements Schema Migration
-- This adds account types, subscription plans, and usage tracking for enforcing plan limits

-- =====================================================
-- SUBSCRIPTION PLANS TABLE
-- Defines the available subscription tiers and their features
-- =====================================================
CREATE TABLE subscription_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    price_monthly NUMERIC(10, 2) NOT NULL DEFAULT 0,
    price_yearly NUMERIC(10, 2),
    -- Limits
    monthly_transaction_limit INTEGER, -- NULL means unlimited
    -- Features (boolean flags)
    all_chains_supported BOOLEAN DEFAULT true,
    basic_api_access BOOLEAN DEFAULT true,
    advanced_analytics BOOLEAN DEFAULT false,
    custom_webhooks BOOLEAN DEFAULT false,
    white_label BOOLEAN DEFAULT false,
    priority_support BOOLEAN DEFAULT false,
    -- Metadata
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default plans
INSERT INTO subscription_plans (id, name, description, price_monthly, price_yearly, monthly_transaction_limit, all_chains_supported, basic_api_access, advanced_analytics, custom_webhooks, white_label, priority_support, sort_order) VALUES
    ('starter', 'Starter', 'Perfect for testing and small projects', 0, 0, 100, true, true, false, false, false, false, 1),
    ('professional', 'Professional', 'For growing businesses', 49, 490, NULL, true, true, true, true, true, true, 2);

-- =====================================================
-- ADD ACCOUNT TYPE TO MERCHANTS
-- =====================================================
ALTER TABLE merchants 
ADD COLUMN IF NOT EXISTS subscription_plan_id TEXT DEFAULT 'starter' REFERENCES subscription_plans(id),
ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'active' CHECK (subscription_status IN ('active', 'cancelled', 'past_due', 'trialing')),
ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

CREATE INDEX IF NOT EXISTS idx_merchants_subscription_plan ON merchants(subscription_plan_id);
CREATE INDEX IF NOT EXISTS idx_merchants_subscription_status ON merchants(subscription_status);

-- =====================================================
-- MONTHLY USAGE TABLE
-- Tracks transaction counts per merchant per month
-- =====================================================
CREATE TABLE monthly_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    year_month TEXT NOT NULL, -- Format: YYYY-MM (e.g., '2025-11')
    transaction_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(merchant_id, year_month)
);

CREATE INDEX idx_monthly_usage_merchant ON monthly_usage(merchant_id);
CREATE INDEX idx_monthly_usage_year_month ON monthly_usage(year_month);

-- =====================================================
-- SUBSCRIPTION HISTORY TABLE
-- Tracks subscription changes for audit purposes
-- =====================================================
CREATE TABLE subscription_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    previous_plan_id TEXT REFERENCES subscription_plans(id),
    new_plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
    change_type TEXT NOT NULL CHECK (change_type IN ('upgrade', 'downgrade', 'cancellation', 'reactivation', 'initial')),
    stripe_event_id TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_subscription_history_merchant ON subscription_history(merchant_id);
CREATE INDEX idx_subscription_history_created ON subscription_history(created_at DESC);

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Function to get current month's usage for a merchant
CREATE OR REPLACE FUNCTION get_current_month_usage(p_merchant_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
    v_year_month TEXT;
BEGIN
    v_year_month := TO_CHAR(NOW(), 'YYYY-MM');
    
    SELECT transaction_count INTO v_count
    FROM monthly_usage
    WHERE merchant_id = p_merchant_id AND year_month = v_year_month;
    
    RETURN COALESCE(v_count, 0);
END;
$$ LANGUAGE plpgsql;

-- Function to increment transaction count
CREATE OR REPLACE FUNCTION increment_transaction_count(p_merchant_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
    v_year_month TEXT;
BEGIN
    v_year_month := TO_CHAR(NOW(), 'YYYY-MM');
    
    INSERT INTO monthly_usage (merchant_id, year_month, transaction_count)
    VALUES (p_merchant_id, v_year_month, 1)
    ON CONFLICT (merchant_id, year_month)
    DO UPDATE SET 
        transaction_count = monthly_usage.transaction_count + 1,
        updated_at = NOW()
    RETURNING transaction_count INTO v_count;
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Function to check if merchant can create a transaction
CREATE OR REPLACE FUNCTION can_create_transaction(p_merchant_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_plan_limit INTEGER;
    v_current_usage INTEGER;
    v_subscription_status TEXT;
BEGIN
    -- Get merchant's plan limit and status
    SELECT sp.monthly_transaction_limit, m.subscription_status
    INTO v_plan_limit, v_subscription_status
    FROM merchants m
    JOIN subscription_plans sp ON m.subscription_plan_id = sp.id
    WHERE m.id = p_merchant_id;
    
    -- Check subscription status
    IF v_subscription_status != 'active' AND v_subscription_status != 'trialing' THEN
        RETURN FALSE;
    END IF;
    
    -- NULL limit means unlimited
    IF v_plan_limit IS NULL THEN
        RETURN TRUE;
    END IF;
    
    -- Get current usage
    v_current_usage := get_current_month_usage(p_merchant_id);
    
    RETURN v_current_usage < v_plan_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to check if merchant has a specific feature
CREATE OR REPLACE FUNCTION has_feature(p_merchant_id UUID, p_feature TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    v_has_feature BOOLEAN;
BEGIN
    EXECUTE format(
        'SELECT sp.%I FROM merchants m JOIN subscription_plans sp ON m.subscription_plan_id = sp.id WHERE m.id = $1',
        p_feature
    ) INTO v_has_feature USING p_merchant_id;
    
    RETURN COALESCE(v_has_feature, FALSE);
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- TRIGGERS
-- =====================================================

-- Trigger to update updated_at on subscription_plans
CREATE TRIGGER update_subscription_plans_updated_at 
    BEFORE UPDATE ON subscription_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger to update updated_at on monthly_usage
CREATE TRIGGER update_monthly_usage_updated_at 
    BEFORE UPDATE ON monthly_usage
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

-- Enable RLS
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_history ENABLE ROW LEVEL SECURITY;

-- Subscription plans are readable by all authenticated users
CREATE POLICY "Anyone can view subscription plans"
    ON subscription_plans FOR SELECT
    USING (is_active = true);

-- Monthly usage policies
CREATE POLICY "Merchants can view own usage"
    ON monthly_usage FOR SELECT
    USING (merchant_id = auth.uid());

-- Subscription history policies
CREATE POLICY "Merchants can view own subscription history"
    ON subscription_history FOR SELECT
    USING (merchant_id = auth.uid());

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE subscription_plans IS 'Available subscription tiers with their features and limits';
COMMENT ON TABLE monthly_usage IS 'Tracks monthly transaction counts per merchant for enforcing limits';
COMMENT ON TABLE subscription_history IS 'Audit log of subscription changes';

COMMENT ON COLUMN subscription_plans.monthly_transaction_limit IS 'NULL means unlimited transactions';
COMMENT ON COLUMN merchants.subscription_plan_id IS 'Current subscription plan (starter or professional)';
COMMENT ON COLUMN merchants.subscription_status IS 'Current status of the subscription';