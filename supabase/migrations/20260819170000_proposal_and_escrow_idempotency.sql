-- CP-024 and IA-017 (2026-08-19 audit): uniqueness that exists only for
-- `payments`.
--
-- CP-024 — proposal→invoice conversion is a read-then-write: it checks whether
-- `proposals.invoice_id` is set, then sets it. Two concurrent conversions both
-- see null and both create an invoice, so one proposal bills the client twice.
-- Nothing in the schema stopped the second write.
--
-- IA-017 — escrow and swap creation accept no idempotency key, so a retried
-- request (a client timeout, a proxy replay) creates a second escrow or swap.
-- `payments` already solves this with a partial unique index over
-- `metadata->>'idempotency_key'`; the same mechanism is simply absent here.
--
-- Verified against production before applying: zero duplicate `invoice_id`
-- values, so the unique index validates without a data cleanup.
--
-- These indexes are the enforcement half. Callers that do not send an
-- idempotency key are unaffected (the index is partial), exactly as on
-- `payments` — but a caller that does send one now gets the guarantee rather
-- than a suggestion.

-- CP-024: one invoice per proposal.
create unique index if not exists proposals_invoice_id_uidx
  on public.proposals (invoice_id)
  where invoice_id is not null;

-- IA-017: escrow creation, keyed per business, mirroring
-- payments_business_idempotency_key_uidx.
create unique index if not exists escrows_business_idempotency_key_uidx
  on public.escrows (business_id, ((metadata ->> 'idempotency_key')))
  where (metadata ->> 'idempotency_key') is not null;

-- IA-017: swap creation. `swaps` has no `metadata` column; `provider_data` is
-- its jsonb bag, and swaps are scoped to a wallet rather than a business.
create unique index if not exists swaps_wallet_idempotency_key_uidx
  on public.swaps (wallet_id, ((provider_data ->> 'idempotency_key')))
  where (provider_data ->> 'idempotency_key') is not null;
