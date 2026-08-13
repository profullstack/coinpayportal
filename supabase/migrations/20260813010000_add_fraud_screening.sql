-- Pre-authorization fraud screening.
--
-- `fraud_events` is an append-only log of everything we learn about a payment
-- attempt: the screening decision made before we hand the buyer a Stripe
-- Checkout URL, and the outcomes (declines, disputes) that come back by
-- webhook. Velocity rules read their own history out of this table.
--
-- `fraud_blocklist` is the manual/automatic override layer — an entry here
-- short-circuits scoring.

CREATE TABLE IF NOT EXISTS fraud_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  merchant_id uuid,

  -- checkout_screen | card_declined | dispute | payment_succeeded
  kind text NOT NULL,
  -- allow | verify | block  (null for outcome events)
  decision text,
  score integer,

  -- Buyer signals, all nullable: we only ever get what the integration sends.
  email text,
  email_domain text,
  email_normalized text,
  ip text,
  ip_prefix text,
  amount bigint,
  currency text,
  description text,

  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  stripe_payment_intent_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fraud_events_ip ON fraud_events (ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_events_ip_prefix ON fraud_events (ip_prefix, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_events_email ON fraud_events (email_normalized, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_events_business ON fraud_events (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_events_kind ON fraud_events (kind, created_at DESC);

CREATE TABLE IF NOT EXISTS fraud_blocklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- email | email_domain | ip | ip_prefix | business | merchant
  kind text NOT NULL,
  value text NOT NULL,
  -- block | verify
  action text NOT NULL DEFAULT 'block',
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fraud_blocklist_entry ON fraud_blocklist (kind, value);
CREATE INDEX IF NOT EXISTS idx_fraud_blocklist_lookup ON fraud_blocklist (kind, value, expires_at);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fraud_events_kind_check') THEN
    ALTER TABLE fraud_events ADD CONSTRAINT fraud_events_kind_check
      CHECK (kind IN ('checkout_screen', 'card_declined', 'dispute', 'payment_succeeded'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fraud_events_decision_check') THEN
    ALTER TABLE fraud_events ADD CONSTRAINT fraud_events_decision_check
      CHECK (decision IS NULL OR decision IN ('allow', 'verify', 'block'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fraud_blocklist_kind_check') THEN
    ALTER TABLE fraud_blocklist ADD CONSTRAINT fraud_blocklist_kind_check
      CHECK (kind IN ('email', 'email_domain', 'ip', 'ip_prefix', 'business', 'merchant'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fraud_blocklist_action_check') THEN
    ALTER TABLE fraud_blocklist ADD CONSTRAINT fraud_blocklist_action_check
      CHECK (action IN ('block', 'verify'));
  END IF;
END $$;

-- Service-role only: these tables are read and written by server routes, never
-- by the browser.
ALTER TABLE fraud_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fraud_blocklist ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE fraud_events IS 'Append-only log of screening decisions and payment outcomes';
COMMENT ON TABLE fraud_blocklist IS 'Manual and automatic overrides checked before scoring';
