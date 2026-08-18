-- N-014: idempotency for payment creation.
--
-- The route checks for an existing payment with the same Idempotency-Key
-- before inserting, but that is a read-then-write: two retries arriving
-- together both find nothing and both insert. This partial unique index makes
-- the database the arbiter, so concurrent retries cannot both create a payment.
--
-- Partial (WHERE ... IS NOT NULL) so the overwhelming majority of payments,
-- which send no key, are unaffected and pay no index cost.
CREATE UNIQUE INDEX IF NOT EXISTS payments_business_idempotency_key_uidx
  ON public.payments (business_id, ((metadata ->> 'idempotency_key')))
  WHERE metadata ->> 'idempotency_key' IS NOT NULL;

COMMENT ON INDEX public.payments_business_idempotency_key_uidx IS
  'Enforces one payment per (business, Idempotency-Key). Creating a payment '
  'allocates an HD address and spends monthly quota, so a client retrying after '
  'a timeout must not produce a second charge.';
