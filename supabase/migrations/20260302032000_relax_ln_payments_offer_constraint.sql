-- Relax offer_direction_consistency: incoming payments from LNbits/LNURL
-- may not have an associated offer row. Allow offer_id to be null for incoming.
ALTER TABLE ln_payments
  DROP CONSTRAINT IF EXISTS ln_payments_offer_direction_consistency;

ALTER TABLE ln_payments
  ADD CONSTRAINT ln_payments_offer_direction_consistency
  CHECK (
    direction = 'incoming'
    OR
    (direction = 'outgoing' AND offer_id IS NULL)
  );
