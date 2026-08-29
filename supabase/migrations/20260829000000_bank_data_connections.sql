-- Bank & card data connections.
--
-- Stores the merchant's linked institutions (Plaid by default) plus the accounts and
-- transactions we pull from them, so fiat settlements can be reconciled against what
-- CoinPay believes it paid out.
--
-- Two properties matter more than the rest of the schema:
--   * `access_token_encrypted` is a long-lived read credential for someone's bank. It
--     is encrypted at the application layer and must never be selectable by a browser
--     role, hence the REVOKEs at the bottom.
--   * Money is stored as BIGINT minor units, signed, positive = money into the
--     account. No numeric/float amounts anywhere in this feature.

CREATE TABLE IF NOT EXISTS bank_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'plaid',
  -- Provider's id for this linked institution instance (Plaid calls it an item).
  provider_item_id TEXT NOT NULL,
  institution_id TEXT,
  institution_name TEXT,
  -- Application-layer encrypted; see src/lib/crypto/encryption.ts.
  access_token_encrypted TEXT NOT NULL,
  -- Opaque incremental-sync cursor. NULL means "never synced".
  sync_cursor TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'reauth_required', 'disconnected', 'error')),
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Re-linking the same institution must update the existing row rather than create a
-- duplicate that would double-count every transaction in reconciliation.
CREATE UNIQUE INDEX IF NOT EXISTS bank_connections_provider_item_idx
  ON bank_connections (provider, provider_item_id);

CREATE INDEX IF NOT EXISTS bank_connections_business_idx
  ON bank_connections (business_id);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
  provider_account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mask TEXT,
  type TEXT NOT NULL DEFAULT 'other'
    CHECK (type IN ('depository', 'credit', 'loan', 'investment', 'other')),
  subtype TEXT,
  current_balance_minor BIGINT,
  available_balance_minor BIGINT,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS bank_accounts_provider_account_idx
  ON bank_accounts (connection_id, provider_account_id);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  provider_transaction_id TEXT NOT NULL,
  -- Signed minor units; POSITIVE = money into the account (a deposit/credit).
  amount_minor BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  posted_on DATE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  counterparty TEXT,
  -- Pending rows can still change id and amount, so reconciliation ignores them.
  pending BOOLEAN NOT NULL DEFAULT false,
  category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS bank_transactions_provider_txn_idx
  ON bank_transactions (connection_id, provider_transaction_id);

-- Reconciliation scans a date range of one connection's credits, newest first.
CREATE INDEX IF NOT EXISTS bank_transactions_connection_date_idx
  ON bank_transactions (connection_id, posted_on DESC);

COMMENT ON COLUMN bank_connections.access_token_encrypted IS
  'Application-layer encrypted provider access token. Never expose over the API.';
COMMENT ON COLUMN bank_connections.sync_cursor IS
  'Opaque provider cursor for incremental transaction sync. NULL means never synced.';
COMMENT ON COLUMN bank_transactions.amount_minor IS
  'Signed minor units. Positive means money into the account (deposit/credit).';

-- ---------------------------------------------------------------------------
-- Access control
--
-- Authorization for this feature lives in the app layer (src/lib/auth/authz.ts) and
-- every query runs through the service-role client, so browser roles need no access at
-- all. RLS is enabled with no policies, which denies anon/authenticated by default and
-- leaves service_role (which bypasses RLS) working.
-- ---------------------------------------------------------------------------
ALTER TABLE bank_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.bank_connections FROM anon, authenticated;
REVOKE ALL ON public.bank_accounts FROM anon, authenticated;
REVOKE ALL ON public.bank_transactions FROM anon, authenticated;
