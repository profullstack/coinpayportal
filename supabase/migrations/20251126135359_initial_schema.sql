-- CoinPayPortal Initial Schema Migration
-- This creates all tables, indexes, RLS policies, and functions for the payment gateway

-- Enable pgcrypto extension for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================
-- MERCHANTS TABLE
-- =====================================================
CREATE TABLE merchants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_merchants_email ON merchants(email);

-- =====================================================
-- BUSINESSES TABLE
-- =====================================================
CREATE TABLE businesses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    webhook_url TEXT,
    webhook_secret TEXT,
    webhook_events JSONB DEFAULT '["payment.confirmed", "payment.forwarded"]'::jsonb,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_businesses_merchant_id ON businesses(merchant_id);
CREATE INDEX idx_businesses_active ON businesses(active);

-- =====================================================
-- PAYMENT_ADDRESSES TABLE
-- =====================================================
CREATE TABLE payment_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    blockchain TEXT NOT NULL CHECK (blockchain IN (
        'btc', 'bch', 'eth', 'matic', 'sol',
        'usdc_eth', 'usdc_matic', 'usdc_sol'
    )),
    address TEXT UNIQUE NOT NULL,
    private_key_encrypted TEXT NOT NULL,
    derivation_path TEXT NOT NULL,
    used BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    used_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_payment_addresses_business_id ON payment_addresses(business_id);
CREATE INDEX idx_payment_addresses_blockchain ON payment_addresses(blockchain);
CREATE INDEX idx_payment_addresses_used ON payment_addresses(used);
CREATE UNIQUE INDEX idx_payment_addresses_address ON payment_addresses(address);

-- =====================================================
-- PAYMENTS TABLE
-- =====================================================
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    payment_address_id UUID NOT NULL REFERENCES payment_addresses(id),
    amount NUMERIC(20, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    blockchain TEXT NOT NULL CHECK (blockchain IN (
        'btc', 'bch', 'eth', 'matic', 'sol',
        'usdc_eth', 'usdc_matic', 'usdc_sol'
    )),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'detected', 'confirmed', 'forwarding', 'forwarded', 'failed', 'expired'
    )),
    crypto_amount NUMERIC(30, 18),
    crypto_currency TEXT,
    customer_paid_amount NUMERIC(30, 18),
    merchant_received_amount NUMERIC(30, 18),
    fee_amount NUMERIC(30, 18),
    tx_hash TEXT,
    forward_tx_hash TEXT,
    confirmations INTEGER DEFAULT 0,
    merchant_wallet_address TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    detected_at TIMESTAMP WITH TIME ZONE,
    confirmed_at TIMESTAMP WITH TIME ZONE,
    forwarded_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '1 hour')
);

CREATE INDEX idx_payments_business_id ON payments(business_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_blockchain ON payments(blockchain);
CREATE INDEX idx_payments_created_at ON payments(created_at DESC);
CREATE INDEX idx_payments_tx_hash ON payments(tx_hash);
CREATE INDEX idx_payments_expires_at ON payments(expires_at);

-- =====================================================
-- WEBHOOK_LOGS TABLE
-- =====================================================
CREATE TABLE webhook_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    event TEXT NOT NULL,
    url TEXT NOT NULL,
    payload JSONB NOT NULL,
    response_status INTEGER,
    response_body TEXT,
    attempt INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    next_retry_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_webhook_logs_business_id ON webhook_logs(business_id);
CREATE INDEX idx_webhook_logs_payment_id ON webhook_logs(payment_id);
CREATE INDEX idx_webhook_logs_created_at ON webhook_logs(created_at DESC);
CREATE INDEX idx_webhook_logs_next_retry ON webhook_logs(next_retry_at) WHERE next_retry_at IS NOT NULL;

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_merchants_updated_at BEFORE UPDATE ON merchants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_businesses_updated_at BEFORE UPDATE ON businesses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to expire old payments
CREATE OR REPLACE FUNCTION expire_old_payments()
RETURNS void AS $$
BEGIN
    UPDATE payments
    SET status = 'expired'
    WHERE status = 'pending'
    AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;

-- Merchants policies
CREATE POLICY "Merchants can view own data"
    ON merchants FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Merchants can update own data"
    ON merchants FOR UPDATE
    USING (auth.uid() = id);

-- Businesses policies
CREATE POLICY "Merchants can view own businesses"
    ON businesses FOR SELECT
    USING (merchant_id = auth.uid());

CREATE POLICY "Merchants can create businesses"
    ON businesses FOR INSERT
    WITH CHECK (merchant_id = auth.uid());

CREATE POLICY "Merchants can update own businesses"
    ON businesses FOR UPDATE
    USING (merchant_id = auth.uid());

CREATE POLICY "Merchants can delete own businesses"
    ON businesses FOR DELETE
    USING (merchant_id = auth.uid());

-- Payment addresses policies
CREATE POLICY "Merchants can view own payment addresses"
    ON payment_addresses FOR SELECT
    USING (
        business_id IN (
            SELECT id FROM businesses WHERE merchant_id = auth.uid()
        )
    );

-- Payments policies
CREATE POLICY "Merchants can view own payments"
    ON payments FOR SELECT
    USING (
        business_id IN (
            SELECT id FROM businesses WHERE merchant_id = auth.uid()
        )
    );

CREATE POLICY "Merchants can create payments"
    ON payments FOR INSERT
    WITH CHECK (
        business_id IN (
            SELECT id FROM businesses WHERE merchant_id = auth.uid()
        )
    );

-- Webhook logs policies
CREATE POLICY "Merchants can view own webhook logs"
    ON webhook_logs FOR SELECT
    USING (
        business_id IN (
            SELECT id FROM businesses WHERE merchant_id = auth.uid()
        )
    );

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE merchants IS 'Merchant accounts that own businesses';
COMMENT ON TABLE businesses IS 'Business entities that process payments';
COMMENT ON TABLE payment_addresses IS 'Generated cryptocurrency addresses for receiving payments';
COMMENT ON TABLE payments IS 'Payment transaction records';
COMMENT ON TABLE webhook_logs IS 'Webhook delivery logs for audit and retry';

COMMENT ON COLUMN payment_addresses.private_key_encrypted IS 'AES-256 encrypted private key';
COMMENT ON COLUMN payments.status IS 'Payment lifecycle: pending -> detected -> confirmed -> forwarding -> forwarded';
COMMENT ON COLUMN payments.fee_amount IS 'Platform fee (2% of payment amount)';