-- Snapshot of the manual P2P methods (Venmo/Cash App/Zelle) available on an
-- invoice at send time: [{ method_id, display_name, handle, instructions }].
-- Locked in at send so later handle edits don't rewrite already-sent invoices,
-- mirroring how crypto_amount / stripe_checkout_url are snapshotted.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS manual_methods JSONB NOT NULL DEFAULT '[]'::jsonb;
