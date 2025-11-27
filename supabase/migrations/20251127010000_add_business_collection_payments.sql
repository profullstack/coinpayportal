-- Add business_collection_payments table for collecting payments from business users
-- This table stores payments that forward 100% of funds to platform wallets

-- =====================================================
-- BUSINESS_COLLECTION_PAYMENTS TABLE
-- =====================================================
CREATE TABLE business_collection_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    
    -- Payment details
    amount DECIMAL(20, 8) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    blockchain TEXT NOT NULL CHECK (blockchain IN ('BTC', 'BCH', 'ETH', 'MATIC', 'SOL')),
    
    -- Crypto amounts
    crypto_amount DECIMAL(20, 8),
    crypto_currency TEXT,
    
    -- Addresses
    payment_address TEXT,
    destination_wallet TEXT NOT NULL,
    
    -- Forwarding configuration
    forward_percentage INTEGER NOT NULL DEFAULT 100 CHECK (forward_percentage = 100),
    
    -- Status tracking
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',
        'detected',
        'confirming',
        'confirmed',
        'forwarding',
        'forwarded',
        'forwarding_failed',
        'expired',
        'cancelled'
    )),
    
    -- Transaction details
    tx_hash TEXT,
    forward_tx_hash TEXT,
    confirmations INTEGER DEFAULT 0,
    
    -- Encrypted private key for the payment address
    private_key_encrypted TEXT,
    
    -- Additional info
    description TEXT,
    metadata JSONB DEFAULT '{}',
    error_message TEXT,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    detected_at TIMESTAMP WITH TIME ZONE,
    confirmed_at TIMESTAMP WITH TIME ZONE,
    forwarded_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for efficient lookups
CREATE INDEX idx_business_collection_payments_business_id ON business_collection_payments(business_id);
CREATE INDEX idx_business_collection_payments_merchant_id ON business_collection_payments(merchant_id);
CREATE INDEX idx_business_collection_payments_status ON business_collection_payments(status);
CREATE INDEX idx_business_collection_payments_blockchain ON business_collection_payments(blockchain);
CREATE INDEX idx_business_collection_payments_payment_address ON business_collection_payments(payment_address);
CREATE INDEX idx_business_collection_payments_created_at ON business_collection_payments(created_at);

-- Add trigger for updated_at
CREATE TRIGGER update_business_collection_payments_updated_at 
    BEFORE UPDATE ON business_collection_payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================
ALTER TABLE business_collection_payments ENABLE ROW LEVEL SECURITY;

-- Merchants can view their own collection payments
CREATE POLICY "Merchants can view own collection payments"
    ON business_collection_payments FOR SELECT
    USING (merchant_id = auth.uid());

-- Merchants can create collection payments for their businesses
CREATE POLICY "Merchants can create collection payments"
    ON business_collection_payments FOR INSERT
    WITH CHECK (
        merchant_id = auth.uid() AND
        business_id IN (
            SELECT id FROM businesses WHERE merchant_id = auth.uid()
        )
    );

-- System can update collection payments (for status updates, forwarding, etc.)
-- This is handled by service role, not RLS

-- =====================================================
-- COMMENTS
-- =====================================================
COMMENT ON TABLE business_collection_payments IS 'Payments collected from business users with 100% forwarding to platform wallets';
COMMENT ON COLUMN business_collection_payments.forward_percentage IS 'Always 100 for business collection payments';
COMMENT ON COLUMN business_collection_payments.destination_wallet IS 'Platform wallet address from environment variables';
COMMENT ON COLUMN business_collection_payments.private_key_encrypted IS 'Encrypted private key for the payment address';