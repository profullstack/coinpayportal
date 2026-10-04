-- ACH pay-in, and the hold that goes with it.
--
-- An ACH debit is reported as succeeded when it is submitted, not when it
-- clears, and the bank can return it days later. On this rail we therefore do
-- not tell the merchant the payment is complete right away: the transaction
-- lands as 'held' with a hold_until, and the payments cron flips it to
-- 'completed' once that passes.
--
-- This gates our completion signal, not Stripe's money movement — these are
-- destination charges and the funds route on Stripe's schedule regardless.
-- Holding the money itself would mean taking it onto the platform account
-- first, which is money transmission and deliberately out of scope. See
-- src/lib/payments/ach-hold.ts.
--
-- Neither `status` nor `rail` has a CHECK constraint on this table, so 'held'
-- and 'ach' need no constraint change. The column is nullable and every
-- existing row keeps it null, which the release logic reads as "not held".

ALTER TABLE stripe_transactions
  ADD COLUMN IF NOT EXISTS hold_until timestamptz;

COMMENT ON COLUMN stripe_transactions.hold_until IS
  'When an ACH transaction may be reported complete to the merchant. Null on the card rail and on every row predating ACH, which the release logic treats as not held.';

-- The cron scans for due holds on every tick, so it wants status and hold_until
-- together. Partial: only held rows are ever scanned, and they are a small and
-- self-clearing slice of the table.
CREATE INDEX IF NOT EXISTS idx_stripe_transactions_held_until
  ON stripe_transactions (hold_until)
  WHERE status = 'held';
