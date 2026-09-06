-- TransFi webhook ledger.
--
-- Mirrors paypal_webhook_events: TransFi retries until it gets a 2xx and
-- re-delivers some events regardless, so every delivery is claimed here on a
-- UNIQUE event id before any work happens. A duplicate loses the insert and the
-- route answers 200 without reprocessing.
--
-- Note this table records deliveries; it does not yet reconcile them against
-- transfers, because remittance transfer initiation is deliberately not built
-- (see docs/REMITTANCE.md). The column set anticipates that work rather than
-- pretending it exists.

CREATE TABLE IF NOT EXISTS transfi_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfi_event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    -- TransFi's own order/payout id, when the envelope carries one. Not unique:
    -- one order emits many events over its lifetime.
    order_id TEXT,
    status TEXT,
    business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
    -- Kept for support: TransFi's console shows the event, this shows what we
    -- did with it. Truncated by the writer, not by the column.
    payload JSONB,
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    processing_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfi_webhook_events_type
  ON transfi_webhook_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfi_webhook_events_order
  ON transfi_webhook_events(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfi_webhook_events_business
  ON transfi_webhook_events(business_id, created_at DESC);

ALTER TABLE transfi_webhook_events ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_transfi_webhook_events_updated_at ON transfi_webhook_events;
CREATE TRIGGER update_transfi_webhook_events_updated_at BEFORE UPDATE ON transfi_webhook_events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
