-- Who paid, and where. `/api/x402/settle` accepts an optional `metadata`
-- object from the seller ({property, resource_path, payer, user_agent,
-- ip_hash}, sanitized in src/lib/x402/metadata.ts) and stores it here, so a
-- sale can be traced to the site and page it bought, not just to the
-- business and the sales-page URL in `resource`.
--
-- Nullable and written by a separate best-effort UPDATE, so settlement never
-- depends on it.

ALTER TABLE x402_payments
  ADD COLUMN IF NOT EXISTS metadata jsonb;

CREATE INDEX IF NOT EXISTS x402_payments_metadata_property_idx
  ON x402_payments ((metadata->>'property'))
  WHERE metadata IS NOT NULL;
