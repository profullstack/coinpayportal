-- Give every card payment a stable invoice number that we return to the caller
-- at creation time, so an integration can record it BEFORE the customer reaches
-- Stripe (and reconcile regardless of whether they complete or close the window).

ALTER TABLE stripe_transactions
  ADD COLUMN IF NOT EXISTS invoice_number text;

CREATE INDEX IF NOT EXISTS idx_stripe_transactions_invoice_number
  ON stripe_transactions(invoice_number);
