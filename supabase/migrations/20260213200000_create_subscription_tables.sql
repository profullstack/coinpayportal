-- Subscriptions table (for Stripe merchant subscriptions)
-- Note: subscription_plans already exists as platform pricing tiers (text id)
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  business_id UUID,
  plan_id TEXT,
  stripe_subscription_id TEXT,
  stripe_checkout_session_id TEXT,
  stripe_account_id TEXT,
  stripe_customer_id TEXT,
  customer_email TEXT,
  status TEXT NOT NULL DEFAULT 'incomplete',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT false,
  canceled_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS enabled, no policies yet (service role access only)
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Add business_id to stripe_transactions (for card analytics filtering)
ALTER TABLE stripe_transactions ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);
