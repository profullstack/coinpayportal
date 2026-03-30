-- Store Stripe webhook endpoint secrets (encrypted)
-- Stripe only returns the signing secret on creation, so we persist it
-- CREATE TABLE IF NOT EXISTS stripe_webhook_secrets (
--   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--  endpoint_id TEXT NOT NULL UNIQUE,  -- Stripe webhook endpoint ID (we_xxx)
--  business_id TEXT NOT NULL,
--  encrypted_secret TEXT NOT NULL,    -- AES-encrypted whsec_ value
--  created_at TIMESTAMPTZ DEFAULT now(),
--  updated_at TIMESTAMPTZ DEFAULT now()
-- );

-- RLS
-- ALTER TABLE stripe_webhook_secrets ENABLE ROW LEVEL SECURITY;

-- Only service role can access (API handles auth)
-- CREATE POLICY "Service role full access" ON stripe_webhook_secrets
--  FOR ALL USING (true) WITH CHECK (true);

-- CREATE INDEX idx_stripe_webhook_secrets_endpoint ON stripe_webhook_secrets (endpoint_id);
-- CREATE INDEX idx_stripe_webhook_secrets_business ON stripe_webhook_secrets (business_id);
