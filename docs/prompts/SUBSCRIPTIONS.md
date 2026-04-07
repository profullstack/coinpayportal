# Recurring Payments / Subscriptions with CoinPay

You are adding recurring crypto billing to an app using CoinPay's recurring escrow series.

## Goal

A customer authorizes a recurring charge (e.g. $20/month). On each interval, a new escrow is funded and settled to the merchant. The customer can cancel at any time.

## Steps

1. **Create a recurring series** server-side when the customer subscribes:

   ```bash
   curl -X POST https://coinpayportal.com/api/escrow/series \
     -H "Authorization: Bearer $COINPAY_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "amount": 20.00,
       "currency": "USD",
       "coin": "USDC",
       "chain": "base",
       "interval": "month",
       "interval_count": 1,
       "buyer_email": "customer@example-business.com",
       "description": "Pro plan — example-business.com",
       "webhook_url": "https://example-business.com/api/coinpay/subscription"
     }'
   ```

   Returns `id`, the first child escrow `pay_address` / `pay_amount`, and a `funding_url`.

2. **Track series status.** Webhook events:
   - `series.cycle.created` — new escrow generated for the next period
   - `series.cycle.funded` — customer paid this cycle
   - `series.cycle.missed` — payment window expired
   - `series.canceled` — series ended

3. **Grant access** on `series.cycle.funded`. Revoke on `series.cycle.missed` or `series.canceled` (with whatever grace period you want).

4. **Cancel:**

   ```bash
   curl -X POST https://coinpayportal.com/api/escrow/series/$ID/cancel \
     -H "Authorization: Bearer $COINPAY_API_KEY"
   ```

## Rules

- Tie the series `id` to your local subscription record. The webhook is your source of truth for billing state.
- Verify webhook signatures.
- Idempotent webhook handling — dedupe by event id.
- Use `example-business.com` for placeholder addresses.

## Deliverable

- Endpoint to start a subscription, returning `funding_url`.
- Webhook handler that updates subscription status and toggles feature access.
- UI showing next billing date, payment method, and a cancel button.
