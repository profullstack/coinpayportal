-- Migration: Add merchant_wallets table for global wallet addresses
-- Description: Allows merchants to define wallet addresses at account level
-- and import them into any of their businesses

-- =====================================================
-- MERCHANT_WALLETS TABLE
-- =====================================================
CREATE TABLE merchant_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    cryptocurrency TEXT NOT NULL CHECK (cryptocurrency IN ('BTC', 'BCH', 'ETH', 'USDT', 'USDC', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'POL')),
    wallet_address TEXT NOT NULL,
    label TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Ensure one wallet per cryptocurrency per merchant
    UNIQUE(merchant_id, cryptocurrency)
);

-- Create indexes for efficient lookups
CREATE INDEX idx_merchant_wallets_merchant_id ON merchant_wallets(merchant_id);
CREATE INDEX idx_merchant_wallets_cryptocurrency ON merchant_wallets(cryptocurrency);
CREATE INDEX idx_merchant_wallets_active ON merchant_wallets(is_active);

-- Add trigger for updated_at
CREATE TRIGGER update_merchant_wallets_updated_at BEFORE UPDATE ON merchant_wallets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================
ALTER TABLE merchant_wallets ENABLE ROW LEVEL SECURITY;

-- Merchants can view their own wallets
CREATE POLICY "Merchants can view own wallets"
    ON merchant_wallets FOR SELECT
    USING (merchant_id = auth.uid());

-- Merchants can create their own wallets
CREATE POLICY "Merchants can create own wallets"
    ON merchant_wallets FOR INSERT
    WITH CHECK (merchant_id = auth.uid());

-- Merchants can update their own wallets
CREATE POLICY "Merchants can update own wallets"
    ON merchant_wallets FOR UPDATE
    USING (merchant_id = auth.uid());

-- Merchants can delete their own wallets
CREATE POLICY "Merchants can delete own wallets"
    ON merchant_wallets FOR DELETE
    USING (merchant_id = auth.uid());

-- =====================================================
-- COMMENTS
-- =====================================================
COMMENT ON TABLE merchant_wallets IS 'Global wallet addresses at merchant/account level for importing into businesses';
COMMENT ON COLUMN merchant_wallets.cryptocurrency IS 'Cryptocurrency type: BTC, BCH, ETH, USDT, USDC, BNB, SOL, XRP, ADA, DOGE, POL';
COMMENT ON COLUMN merchant_wallets.wallet_address IS 'Merchant wallet address for receiving payments';
COMMENT ON COLUMN merchant_wallets.label IS 'Optional user-friendly label for the wallet (e.g., "Main ETH Wallet")';
COMMENT ON COLUMN merchant_wallets.is_active IS 'Whether this wallet is currently active';
