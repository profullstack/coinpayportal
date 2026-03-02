-- Add payment_type column to distinguish regular payments from rebalances
ALTER TABLE ln_payments
  ADD COLUMN IF NOT EXISTS payment_type text NOT NULL DEFAULT 'payment'
  CHECK (payment_type IN ('payment', 'rebalance', 'internal'));

CREATE INDEX IF NOT EXISTS idx_ln_payments_payment_type ON ln_payments(payment_type);

-- Mark existing self-payments as rebalances.
-- A rebalance is detected when the same node has both an incoming and outgoing
-- payment with the same amount within a 5-minute window.
UPDATE ln_payments p
SET payment_type = 'rebalance'
WHERE EXISTS (
  SELECT 1 FROM ln_payments p2
  WHERE p2.node_id = p.node_id
    AND p2.id != p.id
    AND p2.amount_msat = p.amount_msat
    AND p2.direction != p.direction
    AND p2.status = 'settled'
    AND p.status = 'settled'
    AND ABS(EXTRACT(EPOCH FROM (p.created_at - p2.created_at))) < 300
);
