-- Exchange Engine (phase 1: crypto <-> crypto).
--
-- Provider-neutral quotes and orders in front of THORChain and ChangeNOW.
-- Nothing here is a balance: CoinPay never holds the customer's funds, so there
-- is no custodial ledger. These rows record what was quoted, what the user's
-- wallet was told to send, and what the provider and chain reported back.
--
-- No identity data: no names, documents or SSNs. A provider that needs KYC runs
-- it on its own pages; we keep only its status word.

BEGIN;

CREATE TABLE IF NOT EXISTS exchange_quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL,
    provider TEXT NOT NULL,
    from_asset TEXT NOT NULL,
    to_asset TEXT NOT NULL,
    amount_in NUMERIC(38, 18) NOT NULL CHECK (amount_in > 0),
    expected_amount_out NUMERIC(38, 18) NOT NULL,
    fees JSONB NOT NULL DEFAULT '{}'::jsonb,
    route JSONB NOT NULL DEFAULT '{}'::jsonb,
    verification TEXT NOT NULL DEFAULT 'none',
    rank SMALLINT NOT NULL,
    expires_at TIMESTAMPTZ,
    destination_address TEXT,
    country TEXT,
    policy_version TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exchange_quotes_request ON exchange_quotes(request_id);
CREATE INDEX IF NOT EXISTS idx_exchange_quotes_created ON exchange_quotes(created_at);

CREATE TABLE IF NOT EXISTS exchange_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    quote_id UUID REFERENCES exchange_quotes(id) ON DELETE SET NULL,
    idempotency_key TEXT NOT NULL,
    provider TEXT NOT NULL,
    rail TEXT NOT NULL DEFAULT 'crypto_crypto',
    from_asset TEXT NOT NULL,
    to_asset TEXT NOT NULL,
    amount_in NUMERIC(38, 18) NOT NULL CHECK (amount_in > 0),
    expected_amount_out NUMERIC(38, 18),
    amount_out NUMERIC(38, 18),
    destination_address TEXT NOT NULL,
    refund_address TEXT,
    status TEXT NOT NULL DEFAULT 'created' CHECK (status IN (
        'created', 'awaiting_user_action', 'submitted', 'pending', 'completed',
        'expired', 'cancelled', 'failed', 'refund_pending', 'refunded', 'manual_review'
    )),
    provider_order_id TEXT,
    provider_status TEXT,
    plan JSONB,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    in_tx_hash TEXT,
    out_tx_hash TEXT,
    expires_at TIMESTAMPTZ,
    policy_version TEXT NOT NULL,
    last_polled_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (wallet_id, idempotency_key)
);

-- One swap per inbound transaction: a tx hash can never be attached to two orders.
CREATE UNIQUE INDEX IF NOT EXISTS uq_exchange_orders_in_tx
    ON exchange_orders(provider, lower(in_tx_hash)) WHERE in_tx_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exchange_orders_wallet ON exchange_orders(wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exchange_orders_open ON exchange_orders(status, last_polled_at)
    WHERE status IN ('awaiting_user_action', 'submitted', 'pending', 'refund_pending', 'manual_review');

CREATE TABLE IF NOT EXISTS exchange_order_events (
    id BIGSERIAL PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES exchange_orders(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('api', 'user', 'poll', 'webhook', 'system')),
    from_status TEXT,
    to_status TEXT NOT NULL,
    provider_status TEXT,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    dedupe_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (order_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_exchange_order_events_order ON exchange_order_events(order_id, id);

-- Append-only: history is evidence, so it is never edited. Rows may still be
-- deleted (wallet deletion cascades, retention purges), just never rewritten.
CREATE OR REPLACE FUNCTION exchange_order_events_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'exchange_order_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS exchange_order_events_no_update ON exchange_order_events;
CREATE TRIGGER exchange_order_events_no_update
    BEFORE UPDATE ON exchange_order_events
    FOR EACH ROW EXECUTE FUNCTION exchange_order_events_append_only();

CREATE OR REPLACE FUNCTION exchange_orders_touch()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS exchange_orders_updated_at ON exchange_orders;
CREATE TRIGGER exchange_orders_updated_at
    BEFORE UPDATE ON exchange_orders
    FOR EACH ROW EXECUTE FUNCTION exchange_orders_touch();

-- Service role only: no policies, and the browser roles get nothing.
ALTER TABLE exchange_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_order_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON exchange_quotes, exchange_orders, exchange_order_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON exchange_quotes, exchange_orders TO service_role;
GRANT SELECT, INSERT ON exchange_order_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE exchange_order_events_id_seq TO service_role;

COMMIT;
