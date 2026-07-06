-- Deterministic link between the create-route placeholder row and the Stripe
-- Checkout Session, so the webhook can flip the SAME row to completed instead of
-- inserting a separate completed row (which left the placeholder stuck at
-- 'pending' — "our dashboard says pending but Stripe says completed").

ALTER TABLE stripe_transactions
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text;

CREATE INDEX IF NOT EXISTS idx_stripe_transactions_checkout_session_id
  ON stripe_transactions(stripe_checkout_session_id);
