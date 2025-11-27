-- System Wallet Support Migration
-- This migration adds tables for system-owned HD wallets
-- The system (CoinPay) owns these wallets, NOT merchants
-- This enables commission collection on every transaction

-- Drop existing payment_addresses table if it exists (no production data yet)
DROP TABLE IF EXISTS payment_addresses CASCADE;

-- Table to track the next derivation index for each cryptocurrency
CREATE TABLE IF NOT EXISTS system_wallet_indexes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cryptocurrency VARCHAR(10) NOT NULL UNIQUE,
  next_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table to store payment addresses derived from system wallet
CREATE TABLE payment_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  cryptocurrency VARCHAR(10) NOT NULL,
  address VARCHAR(255) NOT NULL,
  derivation_index INTEGER NOT NULL,
  derivation_path VARCHAR(100) NOT NULL,
  encrypted_private_key TEXT NOT NULL,
  merchant_wallet VARCHAR(255) NOT NULL,
  commission_wallet VARCHAR(255) NOT NULL,
  amount_expected DECIMAL(20, 8) NOT NULL,
  commission_amount DECIMAL(20, 8) NOT NULL,
  merchant_amount DECIMAL(20, 8) NOT NULL,
  is_used BOOLEAN NOT NULL DEFAULT FALSE,
  forwarded_at TIMESTAMPTZ,
  commission_tx_hash VARCHAR(255),
  merchant_tx_hash VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT unique_payment_address UNIQUE (payment_id),
  CONSTRAINT unique_address UNIQUE (address)
);

-- Index for faster lookups
CREATE INDEX idx_payment_addresses_payment_id ON payment_addresses(payment_id);
CREATE INDEX idx_payment_addresses_business_id ON payment_addresses(business_id);
CREATE INDEX idx_payment_addresses_address ON payment_addresses(address);
CREATE INDEX idx_payment_addresses_cryptocurrency ON payment_addresses(cryptocurrency);
CREATE INDEX idx_payment_addresses_is_used ON payment_addresses(is_used);

-- Initialize indexes for supported cryptocurrencies
INSERT INTO system_wallet_indexes (cryptocurrency, next_index)
VALUES 
  ('BTC', 0),
  ('ETH', 0),
  ('MATIC', 0),
  ('SOL', 0)
ON CONFLICT (cryptocurrency) DO NOTHING;

-- Add payment_address column to payments table if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payments' AND column_name = 'payment_address'
  ) THEN
    ALTER TABLE payments ADD COLUMN payment_address VARCHAR(255);
  END IF;
END $$;

-- Create index on payment_address if not exists
CREATE INDEX IF NOT EXISTS idx_payments_payment_address ON payments(payment_address);

-- Enable RLS
ALTER TABLE system_wallet_indexes ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_addresses ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Admin can view system wallet indexes" ON system_wallet_indexes;
DROP POLICY IF EXISTS "Admin can update system wallet indexes" ON system_wallet_indexes;
DROP POLICY IF EXISTS "Merchants can view their payment addresses" ON payment_addresses;
DROP POLICY IF EXISTS "Admin can view all payment addresses" ON payment_addresses;
DROP POLICY IF EXISTS "Service role full access to system_wallet_indexes" ON system_wallet_indexes;
DROP POLICY IF EXISTS "Service role full access to payment_addresses" ON payment_addresses;

-- RLS Policies for system_wallet_indexes (admin only)
CREATE POLICY "Admin can view system wallet indexes"
  ON system_wallet_indexes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM merchants
      WHERE merchants.id = auth.uid()
      AND merchants.is_admin = true
    )
  );

CREATE POLICY "Admin can update system wallet indexes"
  ON system_wallet_indexes FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM merchants
      WHERE merchants.id = auth.uid()
      AND merchants.is_admin = true
    )
  );

-- RLS Policies for payment_addresses
CREATE POLICY "Merchants can view their payment addresses"
  ON payment_addresses FOR SELECT
  TO authenticated
  USING (
    business_id IN (
      SELECT id FROM businesses WHERE merchant_id = auth.uid()
    )
  );

CREATE POLICY "Admin can view all payment addresses"
  ON payment_addresses FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM merchants
      WHERE merchants.id = auth.uid()
      AND merchants.is_admin = true
    )
  );

-- Service role can do everything (for backend operations)
CREATE POLICY "Service role full access to system_wallet_indexes"
  ON system_wallet_indexes FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access to payment_addresses"
  ON payment_addresses FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_payment_addresses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS payment_addresses_updated_at ON payment_addresses;
CREATE TRIGGER payment_addresses_updated_at
  BEFORE UPDATE ON payment_addresses
  FOR EACH ROW
  EXECUTE FUNCTION update_payment_addresses_updated_at();

-- Function to update system_wallet_indexes updated_at
CREATE OR REPLACE FUNCTION update_system_wallet_indexes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for system_wallet_indexes updated_at
DROP TRIGGER IF EXISTS system_wallet_indexes_updated_at ON system_wallet_indexes;
CREATE TRIGGER system_wallet_indexes_updated_at
  BEFORE UPDATE ON system_wallet_indexes
  FOR EACH ROW
  EXECUTE FUNCTION update_system_wallet_indexes_updated_at();

-- Comment on tables
COMMENT ON TABLE system_wallet_indexes IS 'Tracks the next derivation index for each cryptocurrency in the system HD wallet';
COMMENT ON TABLE payment_addresses IS 'Stores payment addresses derived from system wallet with forwarding info';
COMMENT ON COLUMN payment_addresses.encrypted_private_key IS 'AES-256-GCM encrypted private key for forwarding funds';
COMMENT ON COLUMN payment_addresses.commission_amount IS '0.5% commission that goes to system wallet';
COMMENT ON COLUMN payment_addresses.merchant_amount IS '99.5% that gets forwarded to merchant wallet';