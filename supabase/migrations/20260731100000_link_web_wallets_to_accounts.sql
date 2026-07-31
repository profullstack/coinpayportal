-- Associate non-custodial web wallets with a CoinPay account.
--
-- `wallets` (web wallet) is deliberately anonymous: public keys only, no PII and
-- no owner column. That is still the right default for wallet-only users, so
-- rather than adding `merchant_id` to `wallets` this migration adds an explicit,
-- revocable link table. A wallet stays anonymous until its holder proves control
-- of it (signed auth challenge) while signed in to a merchant account.
--
-- Once linked, the wallet's derived receive addresses become a resolvable payee
-- source for invoices and proposals, alongside `business_wallets` (per-business)
-- and `merchant_wallets` (account-global).

BEGIN;

CREATE TABLE IF NOT EXISTS wallet_account_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,

    -- NULL = linked at the account level, usable by every business the merchant
    -- can act for. Set = scoped to that one business.
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,

    label TEXT,

    -- Preferred wallet when several are linked at the same scope. Enforced to at
    -- most one per (merchant, business scope) by the partial indexes below.
    is_default BOOLEAN NOT NULL DEFAULT false,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- A wallet links to a given scope at most once. Two partial indexes because
-- Postgres treats NULLs as distinct in a plain UNIQUE constraint, which would
-- otherwise let the same wallet be account-linked repeatedly.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_account_links_account_scope
    ON wallet_account_links(wallet_id, merchant_id)
    WHERE business_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_account_links_business_scope
    ON wallet_account_links(wallet_id, business_id)
    WHERE business_id IS NOT NULL;

-- At most one default per scope.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_account_links_default_account
    ON wallet_account_links(merchant_id)
    WHERE is_default AND business_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_account_links_default_business
    ON wallet_account_links(business_id)
    WHERE is_default AND business_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_account_links_merchant_id
    ON wallet_account_links(merchant_id);
CREATE INDEX IF NOT EXISTS idx_wallet_account_links_business_id
    ON wallet_account_links(business_id);
CREATE INDEX IF NOT EXISTS idx_wallet_account_links_wallet_id
    ON wallet_account_links(wallet_id);

ALTER TABLE wallet_account_links ENABLE ROW LEVEL SECURITY;

-- Direct (anon/authenticated) access is owner-only. Server routes use the
-- service role and enforce team permissions in application code, matching how
-- business_wallets / merchant_wallets are handled.
CREATE POLICY "Merchants can view their own wallet links"
    ON wallet_account_links FOR SELECT
    USING (merchant_id = auth.uid());

CREATE POLICY "Merchants can create their own wallet links"
    ON wallet_account_links FOR INSERT
    WITH CHECK (merchant_id = auth.uid());

CREATE POLICY "Merchants can update their own wallet links"
    ON wallet_account_links FOR UPDATE
    USING (merchant_id = auth.uid());

CREATE POLICY "Merchants can delete their own wallet links"
    ON wallet_account_links FOR DELETE
    USING (merchant_id = auth.uid());

COMMIT;
