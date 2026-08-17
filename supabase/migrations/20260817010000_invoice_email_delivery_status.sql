-- Track invoice email attempts separately from the invoice payment state.
-- Existing rows stay NULL because their historical delivery state is unknown.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS email_status TEXT
    CHECK (email_status IN ('pending', 'accepted', 'failed')),
  ADD COLUMN IF NOT EXISTS email_message_id TEXT,
  ADD COLUMN IF NOT EXISTS email_last_error TEXT,
  ADD COLUMN IF NOT EXISTS email_last_attempted_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN invoices.email_status IS
  'Email provider acceptance state. NULL means unknown for invoices sent before tracking was added.';
COMMENT ON COLUMN invoices.email_message_id IS
  'Message identifier returned by the configured email provider.';
COMMENT ON COLUMN invoices.email_last_error IS
  'Most recent email submission error, cleared after provider acceptance.';
COMMENT ON COLUMN invoices.email_last_attempted_at IS
  'Timestamp of the most recent invoice email submission attempt.';
