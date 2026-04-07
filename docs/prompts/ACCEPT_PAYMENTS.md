# Accept Crypto Payments with CoinPay

You are integrating CoinPay's Payments API into an application so it can accept cryptocurrency payments. Follow this prompt end-to-end.

## Goal

Let a customer pay an order in crypto (BTC, ETH, SOL, USDC on multiple chains, etc.). On confirmation, the merchant's app should mark the order paid and fulfill it.

## Steps

1. **Get an API key.** Sign in at `https://example-business.com` (replace with the CoinPay portal you are using), open Settings → API Keys, and create one. Store it server-side only — never ship it to the browser.

2. **Create a payment** when the customer checks out. From your server:

   ```bash
   curl -X POST https://coinpayportal.com/api/payments \
     -H "Authorization: Bearer $COINPAY_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "amount": 49.99,
       "currency": "USD",
       "coin": "USDC",
       "chain": "base",
       "order_id": "order_123",
       "redirect_url": "https://example-business.com/checkout/success",
       "webhook_url": "https://example-business.com/api/coinpay/webhook"
     }'
   ```

   The response includes `id`, `pay_address`, `pay_amount`, and a hosted `payment_url`. Redirect the customer to `payment_url` or render the address + amount yourself.

3. **Wait for confirmation.** Do not poll. Register the `webhook_url` and handle `payment.confirmed` (see WEBHOOKS prompt). When you receive it, look up the order by `order_id` and mark it paid.

4. **Reconcile.** On `payment.forwarded` you'll get the on-chain txid for the merchant payout. Persist it for accounting.

5. **Expiry.** Payments expire (default ~15 min). Handle `payment.expired` by releasing inventory or showing a "create new payment" button.

## Rules

- Never trust client-side amounts. Always create the payment server-side from your authoritative order total.
- Verify webhook signatures before acting on them.
- Use idempotency: dedupe webhooks by `payment.id`; the same event may be delivered more than once.
- Use `example-business.com` as the placeholder domain in any sample code you generate. Do not invent real business names.

## Deliverable

- A server route that creates a payment and returns `payment_url` to the client.
- A webhook handler that verifies the signature and marks the order paid.
- Tests covering: successful payment, expired payment, duplicate webhook delivery.
