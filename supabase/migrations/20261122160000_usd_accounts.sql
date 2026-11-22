-- Global USD accounts (shipped dark; see docs/USD-ACCOUNTS.md).
--
-- A licensed partner opens a US bank account IN THE USER'S NAME, runs KYC on
-- its own pages, converts deposits to USDC and delivers them to the user's own
-- wallet. CoinPay never holds or pools these funds, so nothing here is a
-- balance or a ledger: these tables keep the partner's references, status
-- words, the routing number, the LAST FOUR of the account number (the full
-- number is fetched live from the partner for display and never stored), the
-- destination wallet, and an append-only record of what the partner reported.
--
-- No identity data: no names, documents, ID numbers or dates of birth.

BEGIN;

CREATE TABLE IF NOT EXISTS usd_account_holders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_holder_id TEXT,
    country TEXT NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'needs_action', 'verified', 'rejected')),
    provider_status TEXT,
    onboarding_url TEXT,
    rejection_reason TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (merchant_id, provider)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_usd_account_holders_provider_ref
    ON usd_account_holders(provider, provider_holder_id) WHERE provider_holder_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS usd_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    holder_id UUID NOT NULL REFERENCES usd_account_holders(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_account_id TEXT,
    -- Other partner ids that belong to this account (a USDC sub-account, the
    -- wallet counterparty), so a webhook about any of them finds this row.
    provider_related_ids TEXT[] NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'pending', 'open', 'closed', 'failed')),
    provider_status TEXT,
    bank_name TEXT,
    routing_number TEXT CHECK (routing_number IS NULL OR routing_number ~ '^[0-9]{9}$'),
    -- Last four only. There is deliberately no column for the full number.
    account_last4 TEXT CHECK (account_last4 IS NULL OR account_last4 ~ '^[0-9]{4}$'),
    rails TEXT[] NOT NULL DEFAULT '{}',
    destination_asset TEXT NOT NULL DEFAULT 'USDC',
    destination_chain TEXT NOT NULL,
    destination_address TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    last_error TEXT,
    opened_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (merchant_id, provider)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_usd_accounts_provider_ref
    ON usd_accounts(provider, provider_account_id) WHERE provider_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usd_accounts_holder ON usd_accounts(holder_id);
CREATE INDEX IF NOT EXISTS idx_usd_accounts_related ON usd_accounts USING GIN (provider_related_ids);

-- What the partner reported, one row per partner event. Deposits are RECORDS
-- of the partner's reports, never credits: nothing sums these into a balance.
CREATE TABLE IF NOT EXISTS usd_account_events (
    id BIGSERIAL PRIMARY KEY,
    provider TEXT NOT NULL,
    event_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'holder.verified', 'holder.rejected',
        'account.opened', 'account.closed',
        'deposit.received', 'deposit.converted', 'deposit.delivered', 'deposit.returned'
    )),
    provider_type TEXT NOT NULL,
    merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
    usd_account_id UUID REFERENCES usd_accounts(id) ON DELETE SET NULL,
    provider_account_id TEXT,
    provider_holder_id TEXT,
    provider_deposit_id TEXT,
    amount_minor BIGINT CHECK (amount_minor IS NULL OR amount_minor >= 0),
    currency TEXT,
    rail TEXT,
    delivered_amount_atomic NUMERIC(78, 0),
    delivered_asset TEXT,
    delivered_chain TEXT,
    tx_hash TEXT,
    return_code TEXT,
    occurred_at TIMESTAMPTZ,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_usd_account_events_account
    ON usd_account_events(usd_account_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_usd_account_events_deposit
    ON usd_account_events(provider, provider_deposit_id) WHERE provider_deposit_id IS NOT NULL;

-- Append-only: the partner's reports are evidence and are never rewritten.
CREATE OR REPLACE FUNCTION usd_account_events_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'usd_account_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS usd_account_events_no_update ON usd_account_events;
CREATE TRIGGER usd_account_events_no_update
    BEFORE UPDATE ON usd_account_events
    FOR EACH ROW EXECUTE FUNCTION usd_account_events_append_only();

CREATE OR REPLACE FUNCTION usd_accounts_touch()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS usd_account_holders_updated_at ON usd_account_holders;
CREATE TRIGGER usd_account_holders_updated_at
    BEFORE UPDATE ON usd_account_holders
    FOR EACH ROW EXECUTE FUNCTION usd_accounts_touch();

DROP TRIGGER IF EXISTS usd_accounts_updated_at ON usd_accounts;
CREATE TRIGGER usd_accounts_updated_at
    BEFORE UPDATE ON usd_accounts
    FOR EACH ROW EXECUTE FUNCTION usd_accounts_touch();

COMMENT ON TABLE usd_account_holders IS
  'A user''s KYC application with a Global USD account partner. Partner reference and status only; no identity data.';
COMMENT ON TABLE usd_accounts IS
  'A partner-held US account in the user''s name. Routing number and last four only; the full account number is read live from the partner and never stored. Not a balance.';
COMMENT ON TABLE usd_account_events IS
  'Append-only record of partner webhooks, deduped by (provider, event_id). Deposits are records of what the partner reported, never credits.';

-- Service role only: no policies, and the browser roles get nothing.
ALTER TABLE usd_account_holders ENABLE ROW LEVEL SECURITY;
ALTER TABLE usd_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE usd_account_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON usd_account_holders, usd_accounts, usd_account_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON usd_account_holders, usd_accounts TO service_role;
GRANT SELECT, INSERT ON usd_account_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE usd_account_events_id_seq TO service_role;

COMMIT;
