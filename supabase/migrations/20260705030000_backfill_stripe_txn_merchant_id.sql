-- Backfill stripe_transactions.merchant_id from the owning business.
--
-- Background: the Stripe webhook writes merchant_id from Stripe metadata
-- (paymentIntent.metadata.merchant_id / checkout session metadata). Charges made
-- without CoinPay metadata landed with a NULL merchant_id, so every dashboard read
-- that filtered `.eq('merchant_id', …)` silently dropped them — the reported
-- "Stripe shows 4 transactions but the dashboard shows 2" gap.
--
-- The read paths (/api/stripe/transactions, /api/stripe/analytics) now scope by
-- business_id instead, but this backfill also repairs the stored data so any
-- remaining merchant_id-keyed consumers (disputes, reputation events) resolve.
--
-- Rows whose business_id is ALSO null cannot be attributed here — those charges
-- were recorded with no metadata at all and must be reconciled from Stripe.

UPDATE stripe_transactions st
SET merchant_id = b.merchant_id
FROM businesses b
WHERE st.business_id = b.id
  AND st.business_id IS NOT NULL
  AND st.merchant_id IS NULL;
