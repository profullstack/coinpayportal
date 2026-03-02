-- Improved rebalance detection.
-- Mark payments as rebalances if:
-- 1. The payer_note/memo contains rebalance-related keywords
-- 2. Both incoming and outgoing exist for the same node with matching amounts
--    (relaxed to 10-minute window and allowing fee differences up to 1%)

-- Tag by memo keywords
UPDATE ln_payments
SET payment_type = 'rebalance'
WHERE payment_type = 'payment'
  AND (
    payer_note ~* '(rebalanc|circular|loop|autoloop|self.?pay|channel.?manage)'
  );

-- Tag by matching opposite-direction payments (relaxed window + fee tolerance)
UPDATE ln_payments p
SET payment_type = 'rebalance'
WHERE payment_type = 'payment'
  AND EXISTS (
    SELECT 1 FROM ln_payments p2
    WHERE p2.node_id = p.node_id
      AND p2.id != p.id
      AND p2.direction != p.direction
      AND p2.status = 'settled'
      AND p.status = 'settled'
      -- Amount within 1% (routing fees cause small differences)
      AND ABS(p2.amount_msat - p.amount_msat) < GREATEST(p.amount_msat, p2.amount_msat) * 0.01
      -- Within 10-minute window
      AND ABS(EXTRACT(EPOCH FROM (p.created_at - p2.created_at))) < 600
  );

-- Also tag payments where the node is both sender and receiver
-- (detected by offer_id being null and no external counterparty)
UPDATE ln_payments p
SET payment_type = 'rebalance'
WHERE payment_type = 'payment'
  AND offer_id IS NULL
  AND direction = 'incoming'
  AND EXISTS (
    SELECT 1 FROM ln_payments p2
    WHERE p2.node_id = p.node_id
      AND p2.direction = 'outgoing'
      AND p2.offer_id IS NULL
      AND p2.status = 'settled'
      AND ABS(p2.amount_msat - p.amount_msat) < GREATEST(p.amount_msat, p2.amount_msat) * 0.05
      AND ABS(EXTRACT(EPOCH FROM (p.created_at - p2.created_at))) < 600
  );
