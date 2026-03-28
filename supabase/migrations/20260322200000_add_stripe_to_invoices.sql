-- Add Stripe checkout columns to invoices table for card payment support
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS stripe_checkout_url TEXT,
  ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_invoices_stripe_session_id ON invoices(stripe_session_id);
