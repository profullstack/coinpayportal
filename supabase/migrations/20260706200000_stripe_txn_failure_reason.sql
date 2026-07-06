-- Surface WHY a card payment failed. Populated by the Stripe webhook from
-- payment_intent.payment_failed (last_payment_error), shown to the merchant on
-- the transactions list + detail page.

ALTER TABLE stripe_transactions
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS failure_code   text;
