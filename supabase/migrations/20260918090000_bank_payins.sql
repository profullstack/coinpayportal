-- ACH as a way to pay, wherever a payment is taken.
--
-- A bank transfer now says what it is for. A buyer paying an invoice or a
-- payment over ACH is a 'payin'; a merchant pulling their own money in is
-- 'funding'; a merchant paying out to their own bank is a 'payout'. The
-- distinction is what makes a balance computable: payins and funding add to
-- what a merchant may pay out, payouts subtract, and a return of a payin after
-- it completed subtracts again.
--
-- The payer's bank account is a counterparty like any other, with role
-- 'payer' so it never appears in the merchant's own list of accounts and can
-- never be the destination of a payout.

ALTER TABLE bank_transfers
  ADD COLUMN IF NOT EXISTS kind        text NOT NULL DEFAULT 'funding'
                                         CHECK (kind IN ('payin', 'funding', 'payout')),
  ADD COLUMN IF NOT EXISTS payment_id  uuid REFERENCES payments(id),
  ADD COLUMN IF NOT EXISTS invoice_id  uuid REFERENCES invoices(id),
  -- Platform fee and what the merchant keeps, both minor units. On a payin
  -- net_minor is amount_minor - fee_minor; on funding and payout it equals
  -- amount_minor and fee_minor is 0.
  ADD COLUMN IF NOT EXISTS fee_minor   bigint NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  ADD COLUMN IF NOT EXISTS net_minor   bigint,
  ADD COLUMN IF NOT EXISTS payer_email text;

CREATE INDEX IF NOT EXISTS idx_bank_transfers_payment ON bank_transfers (payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bank_transfers_invoice ON bank_transfers (invoice_id) WHERE invoice_id IS NOT NULL;

COMMENT ON COLUMN bank_transfers.kind IS
  'payin = a buyer paying a payment or invoice; funding = a merchant pulling from their own bank; payout = a merchant paying out to their own bank. Drives the balance.';

ALTER TABLE bank_counterparties
  ADD COLUMN IF NOT EXISTS role        text NOT NULL DEFAULT 'merchant'
                                         CHECK (role IN ('merchant', 'payer')),
  ADD COLUMN IF NOT EXISTS payer_email text;

COMMENT ON COLUMN bank_counterparties.role IS
  'merchant = the merchant''s own bank account, listed on /banking and a valid payout destination. payer = a buyer''s account used once to pay; never listed, never paid out to.';
