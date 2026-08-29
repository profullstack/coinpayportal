-- Allow Plaid as a second finances provider.
--
-- `finance_connections.provider` was constrained to 'simplefin' alone. Plaid is
-- added for US institution coverage: SimpleFIN reaches fewer banks and makes the
-- merchant mint a setup token at the bridge first, whereas Plaid links inside
-- our own page.
--
-- Nothing else changes. Both providers write the same accounts and transactions
-- through the same sync path, and `access_url_encrypted` already holds "the
-- encrypted credential for this connection" — a SimpleFIN access URL or a Plaid
-- access token, depending on the row.

ALTER TABLE public.finance_connections
  DROP CONSTRAINT IF EXISTS finance_connections_provider_check;

ALTER TABLE public.finance_connections
  ADD CONSTRAINT finance_connections_provider_check
  CHECK (provider IN ('simplefin', 'plaid'));

COMMENT ON COLUMN public.finance_connections.access_url_encrypted IS
  'Encrypted provider credential: a SimpleFIN access URL, or a Plaid access token. Never returned by any route.';
