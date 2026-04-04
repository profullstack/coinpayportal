-- Usage-based billing tables

-- Credit balances per user per business
CREATE TABLE IF NOT EXISTS usage_credits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  balance_usd NUMERIC(12,4) DEFAULT 0,
  lifetime_purchased_usd NUMERIC(12,4) DEFAULT 0,
  lifetime_used_usd NUMERIC(12,4) DEFAULT 0,
  low_balance_threshold_usd NUMERIC(10,2) DEFAULT 5.00,
  auto_refill BOOLEAN DEFAULT false,
  auto_refill_amount_usd NUMERIC(10,2) DEFAULT 25.00,
  auto_refill_below_usd NUMERIC(10,2) DEFAULT 5.00,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(business_id, user_email)
);

-- Rate tables — merchants define cost per action type
CREATE TABLE IF NOT EXISTS usage_rates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  description TEXT,
  cost_usd NUMERIC(10,6) NOT NULL,
  unit TEXT DEFAULT 'request',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(business_id, action_type)
);

-- Usage log — every metered action
CREATE TABLE IF NOT EXISTS usage_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  action_type TEXT NOT NULL,
  quantity NUMERIC(10,2) DEFAULT 1,
  cost_usd NUMERIC(10,6) NOT NULL,
  metadata JSONB DEFAULT '{}',
  credit_id UUID REFERENCES usage_credits(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Credit top-ups (purchase history)
CREATE TABLE IF NOT EXISTS usage_topups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  amount_usd NUMERIC(10,2) NOT NULL,
  payment_method TEXT DEFAULT 'crypto',
  payment_id TEXT,
  tx_hash TEXT,
  status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_credits_business_user ON usage_credits(business_id, user_email);
CREATE INDEX IF NOT EXISTS idx_usage_rates_business ON usage_rates(business_id);
CREATE INDEX IF NOT EXISTS idx_usage_log_business_user ON usage_log(business_id, user_email);
CREATE INDEX IF NOT EXISTS idx_usage_log_created ON usage_log(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_topups_business ON usage_topups(business_id);
