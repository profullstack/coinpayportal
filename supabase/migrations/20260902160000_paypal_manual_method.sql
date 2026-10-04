-- PayPal.Me as a manual 3rd-party rail.
--
-- This is the no-setup floor for PayPal, sitting under the two API-backed modes:
--
--   paypal_manual  merchant saves a PayPal.Me link; the customer pays them
--                  directly and the merchant marks the invoice paid. No API, no
--                  app, no PayPal review. CoinPay is display + bookkeeping only.
--   paypal         merchant's own REST credentials (self-serve) or CoinPay
--                  partner onboarding — see 20260902120000_paypal_payment_plugin.
--
-- Deliberately a SEPARATE method_id from 'paypal' rather than a mode of it. The
-- existing row is integration_type 'paypal' and drives the automated rail; the
-- manual list is selected by integration_type = 'manual', so overloading one row
-- would either hide the automated rail or drag the manual one into the payment
-- resolver. They are different products that happen to share a brand.
--
-- Nothing else is needed to make this work: the manual methods API and
-- configureManualMethod() are catalog-driven, so publishing the row is the
-- whole feature.

INSERT INTO payment_method_catalog (method_id, display_name, integration_type, published, sort_order)
VALUES ('paypal_manual', 'PayPal.Me', 'manual', TRUE, 35)
ON CONFLICT (method_id) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      integration_type = EXCLUDED.integration_type,
      published = EXCLUDED.published,
      sort_order = EXCLUDED.sort_order,
      updated_at = NOW();
