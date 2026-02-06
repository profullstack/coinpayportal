-- Escrow Service Tables
-- Anonymous, non-custodial escrow using platform HD wallet addresses
-- Both humans and AI agents can create/fund/release escrows

BEGIN;

-- ============================================================
-- 1. escrows - Main escrow state
-- ============================================================
CREATE TABLE escrows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Parties (wallet addresses — anonymous, no accounts needed)
    depositor_address TEXT NOT NULL,
    beneficiary_address TEXT NOT NULL,
    arbiter_address TEXT,

    -- Escrow address (platform-generated HD wallet)
    escrow_address_id UUID REFERENCES payment_addresses(id),
    escrow_address TEXT NOT NULL,

    -- Amounts
    chain TEXT NOT NULL CHECK (chain IN (
        'BTC', 'BCH', 'ETH', 'POL', 'SOL',
        'DOGE', 'XRP', 'ADA', 'BNB',
        'USDT', 'USDC',
        'USDC_ETH', 'USDC_POL', 'USDC_SOL'
    )),
    amount NUMERIC(30, 18) NOT NULL,
    amount_usd NUMERIC(20, 2),
    fee_amount NUMERIC(30, 18),
    deposited_amount NUMERIC(30, 18),

    -- Status
    status TEXT NOT NULL DEFAULT 'created' CHECK (status IN (
        'created', 'funded', 'released', 'settled',
        'disputed', 'refunded', 'expired'
    )),

    -- Transaction hashes
    deposit_tx_hash TEXT,
    settlement_tx_hash TEXT,
    fee_tx_hash TEXT,

    -- Metadata (job description, milestones, deliverables, etc.)
    metadata JSONB DEFAULT '{}'::jsonb,
    dispute_reason TEXT,
    dispute_resolution TEXT,

    -- Auth tokens (anonymous auth — no accounts needed)
    release_token TEXT NOT NULL,
    beneficiary_token TEXT NOT NULL,

    -- Business association (optional — for merchants)
    business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    funded_at TIMESTAMPTZ,
    released_at TIMESTAMPTZ,
    settled_at TIMESTAMPTZ,
    disputed_at TIMESTAMPTZ,
    refunded_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours'),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_escrows_status ON escrows(status);
CREATE INDEX idx_escrows_chain ON escrows(chain);
CREATE INDEX idx_escrows_escrow_address ON escrows(escrow_address);
CREATE INDEX idx_escrows_depositor ON escrows(depositor_address);
CREATE INDEX idx_escrows_beneficiary ON escrows(beneficiary_address);
CREATE INDEX idx_escrows_business_id ON escrows(business_id);
CREATE INDEX idx_escrows_expires_at ON escrows(expires_at);
CREATE INDEX idx_escrows_created_at ON escrows(created_at DESC);

-- ============================================================
-- 2. escrow_events - Audit log
-- ============================================================
CREATE TABLE escrow_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escrow_id UUID NOT NULL REFERENCES escrows(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'created', 'funded', 'released', 'settled',
        'disputed', 'dispute_resolved', 'refunded', 'expired',
        'metadata_updated'
    )),
    actor TEXT,
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_escrow_events_escrow_id ON escrow_events(escrow_id);
CREATE INDEX idx_escrow_events_type ON escrow_events(event_type);

-- ============================================================
-- 3. Triggers
-- ============================================================
CREATE OR REPLACE FUNCTION update_escrows_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER escrows_updated_at
    BEFORE UPDATE ON escrows
    FOR EACH ROW
    EXECUTE FUNCTION update_escrows_updated_at();

-- ============================================================
-- 4. RLS Policies
-- ============================================================
ALTER TABLE escrows ENABLE ROW LEVEL SECURITY;
ALTER TABLE escrow_events ENABLE ROW LEVEL SECURITY;

-- Service role full access (backend operations)
CREATE POLICY "Service role full access to escrows"
    ON escrows FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role full access to escrow_events"
    ON escrow_events FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Merchants can view escrows tied to their business
CREATE POLICY "Merchants can view their escrows"
    ON escrows FOR SELECT
    TO authenticated
    USING (
        business_id IN (
            SELECT id FROM businesses WHERE merchant_id = auth.uid()
        )
    );

CREATE POLICY "Merchants can view their escrow events"
    ON escrow_events FOR SELECT
    TO authenticated
    USING (
        escrow_id IN (
            SELECT id FROM escrows WHERE business_id IN (
                SELECT id FROM businesses WHERE merchant_id = auth.uid()
            )
        )
    );

-- ============================================================
-- 5. Add is_escrow flag to payment_addresses
--    Prevents escrow-held funds from being swept by payment forwarding
-- ============================================================
ALTER TABLE payment_addresses ADD COLUMN IF NOT EXISTS is_escrow BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_payment_addresses_is_escrow ON payment_addresses(is_escrow);

COMMENT ON TABLE escrows IS 'Anonymous crypto escrow — holds funds in platform HD wallet addresses until release/refund';
COMMENT ON TABLE escrow_events IS 'Audit trail for escrow state changes';
COMMENT ON COLUMN escrows.release_token IS 'Secret token for depositor to authorize release/refund';
COMMENT ON COLUMN escrows.beneficiary_token IS 'Secret token for beneficiary to check status and dispute';
COMMENT ON COLUMN payment_addresses.is_escrow IS 'True if this address holds escrow funds — must not be swept by payment forwarding';

COMMIT;
