-- REC-D-07: durable webhook retry with a dead-letter state.
--
-- `deliverWebhook` retries three times in-process with exponential backoff, so
-- the whole retry budget is spent inside a single request over roughly three
-- seconds. A merchant endpoint that is down for four seconds — a deploy, a
-- restart, a brief network fault — loses the event permanently, and so does any
-- delivery in flight when our own process is recycled. Nothing records that it
-- happened beyond one `webhook_logs` row saying the last attempt failed.
--
-- `webhook_logs` is the audit trail (what was attempted, and how it went). This
-- table is the work queue (what still needs attempting). They are deliberately
-- separate: one is append-only history, the other is mutable state with a
-- claim on it.
--
-- Terminal states are `delivered` and `dead`. `dead` is the dead-letter: the
-- attempt budget is exhausted and no further automatic delivery will happen, so
-- the row is a durable record an operator can find and act on rather than an
-- event that silently evaporated.

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    payment_id      UUID,
    escrow_id       UUID,
    event           TEXT NOT NULL,
    webhook_url     TEXT NOT NULL,
    payload         JSONB NOT NULL,

    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'delivered', 'dead')),
    attempts        INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 8,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error      TEXT,
    last_status_code INTEGER,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at    TIMESTAMPTZ
);

-- The sweep's only query: pending rows whose backoff has elapsed, oldest first.
-- Partial, because delivered and dead rows are the overwhelming majority over
-- time and never need scanning.
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due
    ON webhook_deliveries (next_attempt_at)
    WHERE status = 'pending';

-- For the operator question "what has been abandoned for this business?"
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_dead
    ON webhook_deliveries (business_id, updated_at DESC)
    WHERE status = 'dead';

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- Written only by the delivery path and the cron, both of which use the service
-- role. RLS on with a service-role-only policy means anon and authenticated are
-- denied outright — a queue carrying merchant payloads is not browser-facing.
-- Stated explicitly rather than left to the absence of a grant, which is the
-- trap `reputation_receipts` was sitting in.
DROP POLICY IF EXISTS "Service role manages webhook deliveries" ON webhook_deliveries;
CREATE POLICY "Service role manages webhook deliveries"
    ON webhook_deliveries
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
