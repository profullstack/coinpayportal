-- Proper LN payment model:
-- - incoming payments must reference an offer
-- - outgoing payments must NOT reference an offer

ALTER TABLE ln_payments
  ADD COLUMN IF NOT EXISTS direction text;

-- Backfill existing rows based on offer linkage
UPDATE ln_payments
SET direction = CASE WHEN offer_id IS NULL THEN 'outgoing' ELSE 'incoming' END
WHERE direction IS NULL;

ALTER TABLE ln_payments
  ALTER COLUMN direction SET NOT NULL;

ALTER TABLE ln_payments
  DROP CONSTRAINT IF EXISTS ln_payments_direction_check;

ALTER TABLE ln_payments
  ADD CONSTRAINT ln_payments_direction_check
  CHECK (direction IN ('incoming', 'outgoing'));

ALTER TABLE ln_payments
  DROP CONSTRAINT IF EXISTS ln_payments_offer_direction_consistency;

ALTER TABLE ln_payments
  ADD CONSTRAINT ln_payments_offer_direction_consistency
  CHECK (
    (direction = 'incoming' AND offer_id IS NOT NULL)
    OR
    (direction = 'outgoing' AND offer_id IS NULL)
  );
