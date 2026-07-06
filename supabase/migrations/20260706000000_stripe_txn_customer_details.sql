-- Capture the paying customer's name and email on card transactions so the
-- merchant can see who paid on the Credit Card -> Transactions list.
--
-- Populated by the Stripe webhook from the Checkout Session's customer_details
-- (checkout.session.completed) or the charge's billing_details / receipt_email
-- (payment_intent.succeeded). Nullable — older rows and abandoned pending rows
-- (created before checkout) have no customer yet.

ALTER TABLE stripe_transactions
  ADD COLUMN IF NOT EXISTS customer_name  text,
  ADD COLUMN IF NOT EXISTS customer_email text;

CREATE INDEX IF NOT EXISTS idx_stripe_transactions_customer_email
  ON stripe_transactions(customer_email);
