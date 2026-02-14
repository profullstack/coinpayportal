-- ============================================================
-- BOLT12 Lightning Network Support
-- Phase 1 MVP: Receive-only via Greenlight
-- ============================================================

-- Lightning nodes (per-wallet Greenlight nodes)
CREATE TABLE IF NOT EXISTS ln_nodes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id         uuid NOT NULL,
  business_id       uuid,
  greenlight_node_id text,
  node_pubkey       text,
  status            text NOT NULL DEFAULT 'provisioning'
                    CHECK (status IN ('provisioning', 'active', 'inactive', 'error')),
  last_pay_index    integer DEFAULT 0,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ln_nodes_wallet_id ON ln_nodes(wallet_id);
CREATE INDEX IF NOT EXISTS idx_ln_nodes_business_id ON ln_nodes(business_id);
CREATE INDEX IF NOT EXISTS idx_ln_nodes_status ON ln_nodes(status);

-- Lightning offers (BOLT12)
CREATE TABLE IF NOT EXISTS ln_offers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id              uuid NOT NULL REFERENCES ln_nodes(id) ON DELETE CASCADE,
  business_id          uuid,
  bolt12_offer         text NOT NULL,
  description          text NOT NULL,
  amount_msat          bigint,
  currency             text DEFAULT 'BTC',
  status               text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'disabled', 'archived')),
  total_received_msat  bigint DEFAULT 0,
  payment_count        integer DEFAULT 0,
  last_payment_at      timestamptz,
  metadata             jsonb DEFAULT '{}',
  created_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ln_offers_node_id ON ln_offers(node_id);
CREATE INDEX IF NOT EXISTS idx_ln_offers_business_id ON ln_offers(business_id);
CREATE INDEX IF NOT EXISTS idx_ln_offers_status ON ln_offers(status);

-- Lightning payments
CREATE TABLE IF NOT EXISTS ln_payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id          uuid NOT NULL REFERENCES ln_offers(id) ON DELETE CASCADE,
  node_id           uuid NOT NULL REFERENCES ln_nodes(id) ON DELETE CASCADE,
  business_id       uuid,
  payment_hash      text NOT NULL UNIQUE,
  preimage          text,
  amount_msat       bigint NOT NULL,
  status            text NOT NULL DEFAULT 'settled'
                    CHECK (status IN ('pending', 'settled', 'failed')),
  payer_note        text,
  settled_at        timestamptz,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ln_payments_offer_id ON ln_payments(offer_id);
CREATE INDEX IF NOT EXISTS idx_ln_payments_node_id ON ln_payments(node_id);
CREATE INDEX IF NOT EXISTS idx_ln_payments_business_id ON ln_payments(business_id);
CREATE INDEX IF NOT EXISTS idx_ln_payments_payment_hash ON ln_payments(payment_hash);
CREATE INDEX IF NOT EXISTS idx_ln_payments_settled_at ON ln_payments(settled_at);

-- Trigger to update offer aggregates on payment insert
CREATE OR REPLACE FUNCTION update_ln_offer_aggregates()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE ln_offers SET
    total_received_msat = total_received_msat + NEW.amount_msat,
    payment_count = payment_count + 1,
    last_payment_at = NEW.settled_at
  WHERE id = NEW.offer_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ln_payment_aggregates ON ln_payments;
CREATE TRIGGER trg_ln_payment_aggregates
  AFTER INSERT ON ln_payments
  FOR EACH ROW
  EXECUTE FUNCTION update_ln_offer_aggregates();

-- RLS
ALTER TABLE ln_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ln_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ln_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ln_nodes_service ON ln_nodes;
CREATE POLICY ln_nodes_service ON ln_nodes FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS ln_offers_service ON ln_offers;
CREATE POLICY ln_offers_service ON ln_offers FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS ln_payments_service ON ln_payments;
CREATE POLICY ln_payments_service ON ln_payments FOR ALL USING (true) WITH CHECK (true);
