-- Bank counterparties, and the columns the transfer sweep needs.
--
-- A counterparty is a user's bank account as the originator knows it. The
-- full account number goes to the provider and is never stored here: this
-- table keeps the provider's reference and the last four digits, so a read of
-- the database can never yield an account that could be debited.

CREATE TABLE IF NOT EXISTS bank_counterparties (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id              uuid NOT NULL REFERENCES merchants(id),
  business_id              uuid REFERENCES businesses(id),

  provider                 text NOT NULL,
  provider_counterparty_id text NOT NULL,

  holder_name              text NOT NULL,
  account_type             text NOT NULL CHECK (account_type IN ('checking', 'savings')),
  routing_number           text NOT NULL CHECK (routing_number ~ '^[0-9]{9}$'),
  account_last4            text NOT NULL CHECK (account_last4 ~ '^[0-9]{4}$'),

  status                   text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_counterparties_provider_ref
  ON bank_counterparties (provider, provider_counterparty_id);

CREATE INDEX IF NOT EXISTS idx_bank_counterparties_merchant
  ON bank_counterparties (merchant_id, created_at DESC);

COMMENT ON TABLE bank_counterparties IS
  'A user''s bank account as the ACH originator knows it. Provider reference and last four only; the account number is never stored.';

ALTER TABLE bank_counterparties ENABLE ROW LEVEL SECURITY;

CREATE POLICY bank_counterparties_service_role ON bank_counterparties
  FOR ALL USING (auth.role() = 'service_role');

-- The transfer lifecycle the sweep drives.
--
-- hold_until: settled_at plus the configured hold, after which we stop waiting
-- for a return and mark the transfer completed. A return can still arrive after
-- that, which is why completed_at and returned_at can both be set.
-- last_polled_at: completed transfers are re-checked daily for sixty days,
-- because an administrative return lands that late.
ALTER TABLE bank_transfers
  ADD COLUMN IF NOT EXISTS bank_counterparty_id uuid REFERENCES bank_counterparties(id),
  ADD COLUMN IF NOT EXISTS hold_until           timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at         timestamptz,
  ADD COLUMN IF NOT EXISTS returned_at          timestamptz,
  ADD COLUMN IF NOT EXISTS last_polled_at       timestamptz,
  ADD COLUMN IF NOT EXISTS last_error           text;

-- Completed transfers that can still come back: the daily re-check reads them
-- by when they settled.
CREATE INDEX IF NOT EXISTS idx_bank_transfers_returnable
  ON bank_transfers (settled_at)
  WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS idx_bank_transfers_merchant
  ON bank_transfers (merchant_id, created_at DESC);
