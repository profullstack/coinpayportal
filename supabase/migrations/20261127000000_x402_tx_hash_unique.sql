-- One on-chain transaction settles at most one x402 payment.
--
-- Security report CPP-03 (2026-11-26): `x402_payments` was unique only on
-- (unique_key, network). On EVM v1 the replay key is the payer's signed EIP-712
-- nonce, which commits to nothing on-chain, so one real transfer could be
-- presented under any number of freshly signed authorizations and settle each
-- of them. `/api/x402/settle` now checks for this and stores tx ids in one
-- canonical case (src/lib/x402/replay.ts); this index makes the rule hold under
-- concurrent settles too. A violation surfaces in the route as 23505 -> 409.
--
-- Checked against prod before applying: no duplicate (network, tx_hash) pairs,
-- case-folded or not.

CREATE UNIQUE INDEX IF NOT EXISTS x402_payments_network_tx_hash_idx
  ON x402_payments (network, tx_hash)
  WHERE tx_hash IS NOT NULL;
