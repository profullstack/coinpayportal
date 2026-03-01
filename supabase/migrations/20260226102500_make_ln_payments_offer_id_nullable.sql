-- Allow LN payments without a linked offer (e.g. outgoing invoice payments)
-- Existing FK remains in place for non-null offer_id values.

ALTER TABLE ln_payments
  ALTER COLUMN offer_id DROP NOT NULL;
