-- HD Wallet Support Migration
-- Adds tables for HD wallet configuration and unique payment addresses

-- HD Wallet Configurations table
-- Stores xpub (extended public key) for each business/cryptocurrency combination
CREATE TABLE IF NOT EXISTS hd_wallet_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    cryptocurrency VARCHAR(10) NOT NULL,
    xpub TEXT NOT NULL, -- Extended public key for address derivation
    encrypted_xpriv TEXT, -- Encrypted extended private key (for forwarding)
    derivation_path VARCHAR(50) NOT NULL, -- Base derivation path
    next_index INTEGER NOT NULL DEFAULT 0, -- Next available address index
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Each business can only have one HD wallet per cryptocurrency
    UNIQUE(business_id, cryptocurrency)
);

-- Payment Addresses table
-- Stores unique derived addresses for each payment
CREATE TABLE IF NOT EXISTS payment_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    cryptocurrency VARCHAR(10) NOT NULL,
    address VARCHAR(100) NOT NULL, -- The derived payment address
    derivation_index INTEGER NOT NULL, -- Index used for derivation
    derivation_path VARCHAR(100) NOT NULL, -- Full derivation path
    encrypted_private_key TEXT, -- Encrypted private key for forwarding
    is_used BOOLEAN NOT NULL DEFAULT FALSE, -- Whether payment was received
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Each payment has exactly one address
    UNIQUE(payment_id)
);

-- Add payment_address column to payments table if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'payment_address'
    ) THEN
        ALTER TABLE payments ADD COLUMN payment_address VARCHAR(100);
    END IF;
END $$;

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_hd_wallet_configs_business 
    ON hd_wallet_configs(business_id);
CREATE INDEX IF NOT EXISTS idx_hd_wallet_configs_crypto 
    ON hd_wallet_configs(cryptocurrency);
CREATE INDEX IF NOT EXISTS idx_payment_addresses_payment 
    ON payment_addresses(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_addresses_address 
    ON payment_addresses(address);
CREATE INDEX IF NOT EXISTS idx_payment_addresses_business 
    ON payment_addresses(business_id);

-- Trigger to update updated_at on hd_wallet_configs
CREATE OR REPLACE FUNCTION update_hd_wallet_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_hd_wallet_configs_updated_at ON hd_wallet_configs;
CREATE TRIGGER trigger_hd_wallet_configs_updated_at
    BEFORE UPDATE ON hd_wallet_configs
    FOR EACH ROW
    EXECUTE FUNCTION update_hd_wallet_configs_updated_at();

-- RLS Policies for hd_wallet_configs
ALTER TABLE hd_wallet_configs ENABLE ROW LEVEL SECURITY;

-- Merchants can view their own HD wallet configs
CREATE POLICY "Merchants can view own HD wallet configs"
    ON hd_wallet_configs FOR SELECT
    USING (
        business_id IN (
            SELECT id FROM businesses WHERE merchant_id = auth.uid()
        )
    );

-- Merchants can insert HD wallet configs for their businesses
CREATE POLICY "Merchants can insert HD wallet configs"
    ON hd_wallet_configs FOR INSERT
    WITH CHECK (
        business_id IN (
            SELECT id FROM businesses WHERE merchant_id = auth.uid()
        )
    );

-- Merchants can update their own HD wallet configs
CREATE POLICY "Merchants can update own HD wallet configs"
    ON hd_wallet_configs FOR UPDATE
    USING (
        business_id IN (
            SELECT id FROM businesses WHERE merchant_id = auth.uid()
        )
    );

-- RLS Policies for payment_addresses
ALTER TABLE payment_addresses ENABLE ROW LEVEL SECURITY;

-- Merchants can view payment addresses for their businesses
CREATE POLICY "Merchants can view own payment addresses"
    ON payment_addresses FOR SELECT
    USING (
        business_id IN (
            SELECT id FROM businesses WHERE merchant_id = auth.uid()
        )
    );

-- Service role can insert payment addresses (for payment creation)
CREATE POLICY "Service can insert payment addresses"
    ON payment_addresses FOR INSERT
    WITH CHECK (true);

-- Service role can update payment addresses
CREATE POLICY "Service can update payment addresses"
    ON payment_addresses FOR UPDATE
    USING (true);

-- Comments for documentation
COMMENT ON TABLE hd_wallet_configs IS 'HD wallet configurations for businesses - stores xpub for address derivation';
COMMENT ON TABLE payment_addresses IS 'Unique payment addresses derived for each payment';
COMMENT ON COLUMN hd_wallet_configs.xpub IS 'Extended public key (BIP32) for deriving child addresses';
COMMENT ON COLUMN hd_wallet_configs.encrypted_xpriv IS 'Encrypted extended private key for signing forwarding transactions';
COMMENT ON COLUMN hd_wallet_configs.next_index IS 'Next available index for address derivation';
COMMENT ON COLUMN payment_addresses.derivation_index IS 'BIP32 index used to derive this address';
COMMENT ON COLUMN payment_addresses.is_used IS 'Whether a payment has been received at this address';