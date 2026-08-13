-- Create the `x402_payments` ledger that the x402 facilitator has always
-- assumed exists.
--
-- `/api/x402/verify` and `/api/x402/settle` both read and write this table, but
-- no migration ever created it and it is absent from production. The failure is
-- silent and severe:
--   * The replay check does `.single()` on a missing table, gets an error,
--     reads `data` as null, and concludes "not seen before" -> EVERY proof is
--     infinitely replayable.
--   * The verified-payment INSERT discards its result, so nothing is recorded.
--   * `/api/x402/settle` looks up the row that was never written and always
--     returns "Payment not found. Call /api/x402/verify first." -> settlement
--     has never succeeded in production and merchants are never paid.
--
-- `resource` is new: proofs are now bound to the URL they purchase, so a proof
-- minted for a cheap endpoint cannot be spent on an expensive one.

CREATE TABLE IF NOT EXISTS x402_payments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- Parties and value. `amount` is the asset's smallest unit (wei, sats,
  -- lamports, USDC micro-units) and is kept as text so no precision is lost.
  from_address         text,
  to_address           text,
  amount               text NOT NULL,
  asset                text,
  network              text NOT NULL,
  scheme               text NOT NULL DEFAULT 'exact',
  method_key           text,

  -- The resource this proof buys. Bound into the payer's signature on EVM.
  resource             text,

  -- Replay identity: nonce | txId | txSignature | preimage | paymentIntentId.
  unique_key           text,

  raw_proof            text,
  status               text NOT NULL DEFAULT 'verified',
  pending_confirmation boolean NOT NULL DEFAULT false,
  tx_hash              text,
  error                text,
  settled_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Replay protection enforced by the database rather than by a read-then-write
-- race in the route. Two concurrent verifies of the same proof cannot both win.
CREATE UNIQUE INDEX IF NOT EXISTS x402_payments_unique_key_network_idx
  ON x402_payments (unique_key, network)
  WHERE unique_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS x402_payments_business_id_idx
  ON x402_payments (business_id);

CREATE INDEX IF NOT EXISTS x402_payments_status_idx
  ON x402_payments (status);

-- Written and read exclusively by the service role in the facilitator routes.
-- RLS on with no anon/authenticated policy keeps the ledger server-only.
ALTER TABLE x402_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_x402_payments" ON x402_payments;
CREATE POLICY "service_role_all_x402_payments" ON x402_payments
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
