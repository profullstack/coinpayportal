-- Migration: Create web wallet tables for Wallet Mode
-- These tables are ADDITIVE and do not modify existing tables
-- Core principle: No private keys stored, minimal PII

BEGIN;

-- ============================================================
-- 1. wallets - Stores wallet identity (public keys only)
-- ============================================================
CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Public keys for signature verification
    -- ed25519 for Solana, secp256k1 for BTC/ETH/POL
    public_key_ed25519 TEXT,
    public_key_secp256k1 TEXT,

    -- Wallet status
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
        'active',
        'suspended',
        'archived'
    )),

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_active_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- At least one public key must be provided
    CONSTRAINT wallet_has_public_key CHECK (
        public_key_ed25519 IS NOT NULL OR public_key_secp256k1 IS NOT NULL
    )
);

-- ============================================================
-- 2. wallet_addresses - Derived addresses for each wallet
-- ============================================================
CREATE TABLE IF NOT EXISTS wallet_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,

    -- Address details
    chain TEXT NOT NULL CHECK (chain IN (
        'BTC', 'BCH', 'ETH', 'POL', 'SOL',
        'USDC_ETH', 'USDC_POL', 'USDC_SOL'
    )),
    address TEXT NOT NULL,

    -- Derivation info
    derivation_index INTEGER NOT NULL DEFAULT 0,
    derivation_path TEXT NOT NULL,

    -- Status
    is_active BOOLEAN DEFAULT true,

    -- Cached balance (updated by indexer)
    cached_balance NUMERIC(30, 18) DEFAULT 0,
    cached_balance_updated_at TIMESTAMP WITH TIME ZONE,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen_at TIMESTAMP WITH TIME ZONE,

    -- A wallet can only have one address per chain+index combo
    CONSTRAINT unique_wallet_chain_index UNIQUE (wallet_id, chain, derivation_index)
);

-- ============================================================
-- 3. wallet_transactions - Transaction history
-- ============================================================
CREATE TABLE IF NOT EXISTS wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    address_id UUID REFERENCES wallet_addresses(id) ON DELETE SET NULL,

    -- Transaction details
    chain TEXT NOT NULL CHECK (chain IN (
        'BTC', 'BCH', 'ETH', 'POL', 'SOL',
        'USDC_ETH', 'USDC_POL', 'USDC_SOL'
    )),
    tx_hash TEXT NOT NULL,

    -- Direction and status
    direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',
        'confirming',
        'confirmed',
        'failed'
    )),

    -- Amounts
    amount NUMERIC(30, 18) NOT NULL,
    token_address TEXT,

    -- Addresses
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,

    -- Fee info
    fee_amount NUMERIC(30, 18),
    fee_currency TEXT,

    -- Blockchain info
    confirmations INTEGER DEFAULT 0,
    block_number BIGINT,
    block_timestamp TIMESTAMP WITH TIME ZONE,

    -- Additional data
    metadata JSONB DEFAULT '{}'::jsonb,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- One record per chain+tx_hash
    CONSTRAINT unique_chain_tx_hash UNIQUE (chain, tx_hash)
);

-- ============================================================
-- 4. wallet_auth_challenges - Signature-based auth challenges
-- ============================================================
CREATE TABLE IF NOT EXISTS wallet_auth_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,

    -- Challenge data
    challenge TEXT NOT NULL,

    -- Expiration
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN DEFAULT false,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT challenge_not_expired CHECK (expires_at > created_at)
);

-- ============================================================
-- 5. wallet_settings - Optional security settings
-- ============================================================
CREATE TABLE IF NOT EXISTS wallet_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,

    -- Spend limits (optional)
    daily_spend_limit NUMERIC(30, 18),

    -- Whitelist mode (optional)
    whitelist_addresses JSONB DEFAULT '[]'::jsonb,
    whitelist_enabled BOOLEAN DEFAULT false,

    -- Confirmation requirements
    require_confirmation BOOLEAN DEFAULT false,
    confirmation_delay_seconds INTEGER DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- One settings row per wallet
    CONSTRAINT unique_wallet_settings UNIQUE (wallet_id)
);

-- ============================================================
-- 6. wallet_nonces - Replay protection
-- ============================================================
CREATE TABLE IF NOT EXISTS wallet_nonces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    chain TEXT NOT NULL,

    -- Nonce tracking
    last_nonce BIGINT NOT NULL DEFAULT 0,
    pending_nonces JSONB DEFAULT '[]'::jsonb,

    -- Timestamps
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- One nonce record per wallet+chain
    CONSTRAINT unique_wallet_chain_nonce UNIQUE (wallet_id, chain)
);

-- ============================================================
-- INDEXES
-- ============================================================

-- wallets indexes
CREATE INDEX IF NOT EXISTS idx_wallets_status ON wallets(status);
CREATE INDEX IF NOT EXISTS idx_wallets_created_at ON wallets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallets_last_active ON wallets(last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallets_public_key_ed25519 ON wallets(public_key_ed25519) WHERE public_key_ed25519 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wallets_public_key_secp256k1 ON wallets(public_key_secp256k1) WHERE public_key_secp256k1 IS NOT NULL;

-- wallet_addresses indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_addresses_address ON wallet_addresses(address);
CREATE INDEX IF NOT EXISTS idx_wallet_addresses_wallet_id ON wallet_addresses(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_addresses_chain ON wallet_addresses(chain);
CREATE INDEX IF NOT EXISTS idx_wallet_addresses_active ON wallet_addresses(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_wallet_addresses_wallet_chain ON wallet_addresses(wallet_id, chain);

-- wallet_transactions indexes
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet_id ON wallet_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_address_id ON wallet_transactions(address_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_chain ON wallet_transactions(chain);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_status ON wallet_transactions(status);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_direction ON wallet_transactions(direction);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_created_at ON wallet_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_tx_hash ON wallet_transactions(tx_hash);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_from ON wallet_transactions(from_address);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_to ON wallet_transactions(to_address);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet_chain ON wallet_transactions(wallet_id, chain, created_at DESC);

-- wallet_auth_challenges indexes
CREATE INDEX IF NOT EXISTS idx_wallet_auth_challenges_wallet_id ON wallet_auth_challenges(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_auth_challenges_expires ON wallet_auth_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_wallet_auth_challenges_unused ON wallet_auth_challenges(wallet_id, used) WHERE used = false;
CREATE INDEX IF NOT EXISTS idx_wallet_auth_challenges_cleanup ON wallet_auth_challenges(created_at) WHERE used = true;

-- wallet_settings indexes
CREATE INDEX IF NOT EXISTS idx_wallet_settings_wallet_id ON wallet_settings(wallet_id);

-- wallet_nonces indexes
CREATE INDEX IF NOT EXISTS idx_wallet_nonces_wallet_chain ON wallet_nonces(wallet_id, chain);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Reuse existing function or create if not exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Auto-update updated_at on wallet_transactions
CREATE TRIGGER update_wallet_transactions_updated_at
    BEFORE UPDATE ON wallet_transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at on wallet_settings
CREATE TRIGGER update_wallet_settings_updated_at
    BEFORE UPDATE ON wallet_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at on wallet_nonces
CREATE TRIGGER update_wallet_nonces_updated_at
    BEFORE UPDATE ON wallet_nonces
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Update wallet last_active_at on activity
CREATE OR REPLACE FUNCTION update_wallet_last_active()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE wallets
    SET last_active_at = NOW()
    WHERE id = NEW.wallet_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wallet_address_activity
    AFTER INSERT ON wallet_addresses
    FOR EACH ROW EXECUTE FUNCTION update_wallet_last_active();

CREATE TRIGGER wallet_transaction_activity
    AFTER INSERT ON wallet_transactions
    FOR EACH ROW EXECUTE FUNCTION update_wallet_last_active();

-- Cleanup expired auth challenges (call via cron)
CREATE OR REPLACE FUNCTION cleanup_expired_challenges()
RETURNS void AS $$
BEGIN
    DELETE FROM wallet_auth_challenges
    WHERE expires_at < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- Get wallet balance summary
CREATE OR REPLACE FUNCTION get_wallet_balance_summary(p_wallet_id UUID)
RETURNS TABLE (
    chain TEXT,
    address TEXT,
    balance NUMERIC,
    last_updated TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        wa.chain,
        wa.address,
        wa.cached_balance as balance,
        wa.cached_balance_updated_at as last_updated
    FROM wallet_addresses wa
    WHERE wa.wallet_id = p_wallet_id
    AND wa.is_active = true
    ORDER BY wa.chain, wa.derivation_index;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_auth_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_nonces ENABLE ROW LEVEL SECURITY;

-- Service role full access (used by API routes)
CREATE POLICY "Service role full access on wallets"
    ON wallets FOR ALL
    USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on wallet_addresses"
    ON wallet_addresses FOR ALL
    USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on wallet_transactions"
    ON wallet_transactions FOR ALL
    USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on wallet_auth_challenges"
    ON wallet_auth_challenges FOR ALL
    USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on wallet_settings"
    ON wallet_settings FOR ALL
    USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on wallet_nonces"
    ON wallet_nonces FOR ALL
    USING (auth.role() = 'service_role');

COMMIT;
