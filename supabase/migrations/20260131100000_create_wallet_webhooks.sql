-- Migration: Add wallet_webhooks table for event webhook registration
-- Allows wallets to register URLs to receive push notifications
-- for incoming transactions, confirmations, and balance changes.

BEGIN;

-- ============================================================
-- wallet_webhooks - Webhook registrations per wallet
-- ============================================================
CREATE TABLE IF NOT EXISTS wallet_webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,

    -- Webhook URL (must be HTTPS)
    url TEXT NOT NULL,

    -- Events this webhook listens for
    events JSONB NOT NULL DEFAULT '["transaction.incoming","transaction.confirmed","balance.changed"]'::jsonb,

    -- Secret for signing payloads (HMAC-SHA256)
    secret TEXT NOT NULL,

    -- Status
    is_active BOOLEAN DEFAULT true,

    -- Delivery tracking
    last_delivered_at TIMESTAMP WITH TIME ZONE,
    last_error TEXT,
    consecutive_failures INTEGER DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- One URL per wallet (no duplicate registrations)
    CONSTRAINT unique_wallet_webhook_url UNIQUE (wallet_id, url)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_wallet_webhooks_wallet_id ON wallet_webhooks(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_webhooks_active ON wallet_webhooks(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_wallet_webhooks_wallet_active ON wallet_webhooks(wallet_id, is_active);

-- Auto-update updated_at
CREATE TRIGGER update_wallet_webhooks_updated_at
    BEFORE UPDATE ON wallet_webhooks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE wallet_webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on wallet_webhooks"
    ON wallet_webhooks FOR ALL
    USING (auth.role() = 'service_role');

COMMIT;
