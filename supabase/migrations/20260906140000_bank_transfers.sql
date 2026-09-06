-- Bank transfers: money in and out of a user's own bank account.
--
-- The leg CoinPay was missing. Stablecoin already carries value across a
-- border and src/lib/remittance pays it into a local rail at the far end; what
-- had no home was moving money between a user and us over their domestic
-- banking rail. ACH is US-domestic, so a cross-border transfer is always three
-- legs and this table records one end of it.
--
-- Provider-neutral on purpose. The card rail was written against a single
-- processor and losing access to that processor left no path to money at all,
-- which is the reason this module exists.

CREATE TABLE IF NOT EXISTS bank_transfers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  merchant_id          uuid REFERENCES merchants(id),
  business_id          uuid REFERENCES businesses(id),

  -- Which originator moved it, and their id for it. Kept even after a provider
  -- is retired: a returned transfer has to be traceable to the rail it went out
  -- on, and 'the one we use now' is not that.
  provider             text NOT NULL,
  provider_transfer_id text,

  -- Always from CoinPay's point of view: 'debit' pulls from the user's bank
  -- into us, 'credit' pushes out to them. The word means the opposite to a bank
  -- and to its customer, so it is pinned here rather than left to a reader.
  direction            text NOT NULL CHECK (direction IN ('debit', 'credit')),

  -- Minor units, integer. Money never travels through a float: a rounding error
  -- here is a wrong amount taken from somebody's bank account.
  amount_minor         bigint NOT NULL CHECK (amount_minor > 0),
  currency             text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),

  -- 'settled' is not 'completed'. Settled means the funds moved; completed is
  -- our decision to stop waiting for a return, which can still arrive after it.
  status               text NOT NULL DEFAULT 'initiated'
                         CHECK (status IN ('initiated', 'pending', 'settled',
                                           'completed', 'returned', 'failed',
                                           'canceled')),
  -- The originator's own status string, verbatim, for support and debugging.
  provider_status      text,
  -- Populated on a return: the raw NACHA code, e.g. R01.
  return_code          text,

  counterparty_id      text,
  description          text,

  -- Caller-supplied, never generated here: a key invented on the retry would be
  -- different from the one on the first attempt, which is the exact case it
  -- exists to protect against.
  idempotency_key      text NOT NULL,

  created_at           timestamptz NOT NULL DEFAULT now(),
  settled_at           timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- The money-safety constraint, and the reason it is in the database rather than
-- only in code: a retried create that originates a second debit is the worst
-- failure this table can record, and network timeouts guarantee retries happen.
-- Application-level checks race; a unique index does not.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_transfers_idempotency
  ON bank_transfers (idempotency_key);

-- Reconciling a webhook or a poll against a provider's own id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_transfers_provider_ref
  ON bank_transfers (provider, provider_transfer_id)
  WHERE provider_transfer_id IS NOT NULL;

-- The sweep that advances in-flight transfers only ever looks at the ones that
-- have not reached a terminal state.
CREATE INDEX IF NOT EXISTS idx_bank_transfers_in_flight
  ON bank_transfers (status, created_at)
  WHERE status IN ('initiated', 'pending', 'settled');

CREATE INDEX IF NOT EXISTS idx_bank_transfers_business
  ON bank_transfers (business_id, created_at DESC);

COMMENT ON TABLE bank_transfers IS
  'Money moved between a user''s bank account and CoinPay over a domestic rail (ACH today). One end of a cross-border transfer; the crossing itself is stablecoin and the far end is src/lib/remittance.';

COMMENT ON COLUMN bank_transfers.status IS
  'Normalised lifecycle. settled = funds moved but still returnable; completed = our decision to stop waiting. A return can arrive after completed.';

ALTER TABLE bank_transfers ENABLE ROW LEVEL SECURITY;

-- Service role only. Nothing about a bank transfer should be reachable from an
-- anon or authenticated client directly; reads go through a route that has
-- already resolved which business is asking.
CREATE POLICY bank_transfers_service_role ON bank_transfers
  FOR ALL USING (auth.role() = 'service_role');
