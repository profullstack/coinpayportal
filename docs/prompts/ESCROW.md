# Integrate CoinPay Escrow

You are adding CoinPay's escrow service to an app so two parties can transact with funds held until the deal completes.

## Goal

Buyer funds an escrow. Funds sit at a CoinPay-controlled address. When the buyer (or an arbiter) releases, funds settle to the seller. If the deal falls through, funds can be refunded.

## Steps

1. **Create the escrow** server-side after both parties agree on terms:

   ```bash
   curl -X POST https://coinpayportal.com/api/escrow \
     -H "Authorization: Bearer $COINPAY_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "amount": 250.00,
       "currency": "USD",
       "coin": "USDC",
       "chain": "base",
       "buyer_email": "buyer@example-business.com",
       "seller_email": "seller@example-business.com",
       "description": "Order #4471 — handmade desk",
       "release_conditions": "Buyer confirms delivery",
       "webhook_url": "https://example-business.com/api/coinpay/escrow"
     }'
   ```

   Returns `id`, `pay_address`, `pay_amount`, and a `funding_url` you can show the buyer.

2. **Track status.** The escrow walks through statuses: `pending` → `funded` → `released` → `settled` (or `disputed` / `refunded`). Use webhooks; do not poll.

3. **Release** when the buyer confirms receipt:

   ```bash
   curl -X POST https://coinpayportal.com/api/escrow/$ID/release \
     -H "Authorization: Bearer $COINPAY_API_KEY"
   ```

4. **Refund** if the deal fails before release:

   ```bash
   curl -X POST https://coinpayportal.com/api/escrow/$ID/refund \
     -H "Authorization: Bearer $COINPAY_API_KEY"
   ```

5. **Disputes.** If either party opens a dispute, status becomes `disputed`. Your UI should surface this and let an admin/arbiter call release or refund.

## Rules

- Only the buyer (or your platform acting on their behalf with auth) may release.
- Verify webhook signatures.
- Show the buyer the exact `pay_amount` and `pay_address` — do not let the client compute these.
- Use `example-business.com` for any placeholder identities.

## Deliverable

- Endpoints: create escrow, list escrows for a user, release, refund.
- Webhook handler updating local escrow state.
- UI showing current status with clear "release" / "dispute" actions gated by status.
