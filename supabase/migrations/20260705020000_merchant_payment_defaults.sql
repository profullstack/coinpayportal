-- Account-level (global) payment-method defaults.
--
-- A merchant can save a handle once at the account level and then IMPORT it into
-- any of their businesses (which unlocks + enables that manual method on the
-- business via the W5 cascade). This is the "set up globally, import to business"
-- path; the per-business path (merchant_payment_settings) still works directly.
--
-- v1 covers the manual P2P rails (Venmo/Cash App/Zelle); config holds
-- { handle, instructions }. RLS on, no policies (app-layer authz).
CREATE TABLE IF NOT EXISTS merchant_payment_defaults (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    method_id TEXT NOT NULL REFERENCES payment_method_catalog(method_id) ON DELETE CASCADE,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (merchant_id, method_id)
);

CREATE INDEX IF NOT EXISTS idx_merchant_payment_defaults_merchant ON merchant_payment_defaults(merchant_id);

ALTER TABLE merchant_payment_defaults ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_merchant_payment_defaults_updated_at ON merchant_payment_defaults;
CREATE TRIGGER update_merchant_payment_defaults_updated_at BEFORE UPDATE ON merchant_payment_defaults
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
