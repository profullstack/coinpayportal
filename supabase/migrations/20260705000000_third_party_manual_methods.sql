-- 3rd-party manual payment methods (Venmo, Cash App, Zelle).
--
-- Per product decision: CoinPay does NOT take a cut and does NOT touch the money
-- on these rails. The merchant shows the customer their own handle, the customer
-- pays them directly (P2P), and the merchant marks the invoice paid. This
-- sidesteps money-transmitter licensing (Zelle) and PayPal partner underwriting
-- (Venmo) entirely — CoinPay is display + bookkeeping only.
--
-- They plug into the W5 cascade as integration_type = 'manual'. The per-store
-- handle/instructions live in merchant_payment_settings.config.

-- Store-level free-form config for a method (e.g. { "handle": "...", "instructions": "..." }).
ALTER TABLE merchant_payment_settings
  ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Publish the manual rails so businesses can set them up. Apple/Google Pay stay
-- unpublished (they belong on the automated Stripe path, not manual).
UPDATE payment_method_catalog
SET integration_type = 'manual', published = TRUE
WHERE method_id IN ('venmo', 'cashapp', 'zelle');
