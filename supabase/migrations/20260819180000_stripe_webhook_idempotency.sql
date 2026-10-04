-- INV-01: Stripe webhook idempotency.
--
-- The webhook handler dispatched on `event.type` and never looked at
-- `event.id`. Stripe redelivers an event whenever the endpoint times out or
-- answers non-2xx, and may deliver duplicates regardless — so every handler was
-- re-runnable by a retry the platform did not control. `charge.refunded` and
-- `payment_intent.succeeded` both write money-shaped records.
--
-- The primary key is the claim: an INSERT that conflicts means the event has
-- already been taken, and the second delivery returns 200 without re-running
-- anything. A handler that throws deletes its own claim, so a genuine failure
-- still gets Stripe's retry rather than being permanently swallowed.

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
    event_id    TEXT PRIMARY KEY,
    event_type  TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Retention sweep support: these rows are only useful for as long as Stripe
-- might retry (it gives up after ~3 days), but they are cheap, so nothing
-- deletes them automatically. The index makes a manual prune fast.
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_received_at
    ON stripe_webhook_events (received_at);

ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;

-- No policies: this table is written only by the webhook handler, which uses
-- the service role. Enabling RLS without a policy denies every anon/authenticated
-- read, which is what is wanted — an event ledger is not merchant-facing data.
