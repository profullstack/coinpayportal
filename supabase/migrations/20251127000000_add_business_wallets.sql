-- Add business_wallets table for multi-crypto wallet support
-- This migration creates a normalized table for storing multiple wallet addresses per business

-- =====================================================
-- BUSINESS_WALLETS TABLE
-- =====================================================
CREATE TABLE business_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    cryptocurrency TEXT NOT NULL CHECK (cryptocurrency IN ('BTC', 'ETH', 'MATIC', 'SOL')),
    wallet_address TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one wallet per cryptocurrency per business
    UNIQUE(business_id, cryptocurrency)
);

-- Create indexes for efficient lookups
CREATE INDEX idx_business_wallets_business_id ON business_wallets(business_id);
CREATE INDEX idx_business_wallets_cryptocurrency ON business_wallets(cryptocurrency);
CREATE INDEX idx_business_wallets_active ON business_wallets(is_active);

-- Add trigger for updated_at
CREATE TRIGGER update_business_wallets_updated_at BEFORE UPDATE ON business_wallets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================
ALTER TABLE business_wallets ENABLE ROW LEVEL SECURITY;

-- Merchants can view wallets for their own businesses
CREATE POLICY "Merchants can view own business wallets"
    ON business_wallets FOR SELECT
    USING (
        business_id IN (
            SELECT id FROM businesses WHERE merchant_id = auth.uid()
        )
    );

-- Merchants can create wallets for their own businesses
CREATE POLICY "Merchants can create business wallets"
    ON business_wallets FOR INSERT
    WITH CHECK (
        business_id IN (
            SELECT id FROM businesses WHERE merchant_id = auth.uid()
        )
    );

-- Merchants can update wallets for their own businesses
CREATE POLICY "Merchants can update own business wallets"
    ON business_wallets FOR UPDATE
    USING (
        business_id IN (
            SELECT id FROM businesses WHERE merchant_id = auth.uid()
        )
    );

-- Merchants can delete wallets for their own businesses
CREATE POLICY "Merchants can delete own business wallets"
    ON business_wallets FOR DELETE
    USING (
        business_id IN (
            SELECT id FROM businesses WHERE merchant_id = auth.uid()
        )
    );

-- =====================================================
-- COMMENTS
-- =====================================================
COMMENT ON TABLE business_wallets IS 'Multi-cryptocurrency wallet addresses for businesses';
COMMENT ON COLUMN business_wallets.cryptocurrency IS 'Cryptocurrency type: BTC, ETH, MATIC, or SOL';
COMMENT ON COLUMN business_wallets.wallet_address IS 'Merchant wallet address for receiving forwarded payments';
COMMENT ON COLUMN business_wallets.is_active IS 'Whether this wallet is currently active for receiving payments';