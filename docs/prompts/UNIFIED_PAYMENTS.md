# Accept Crypto + Card via Unified Payments

You are integrating CoinPay's unified payments endpoint, which lets a customer choose between paying in crypto or by credit card from a single hosted checkout.

## Goal

One API call creates a payment that the customer can fulfill with either crypto (any supported coin/chain) or a card. You receive a single webhook on completion regardless of method.

## Steps

1. **Create the payment** server-side:

   ```bash
   curl -X POST https://coinpayportal.com/api/payments/unified \
     -H "Authorization: Bearer $COINPAY_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "amount": 99.00,
       "currency": "USD",
       "methods": ["crypto", "card"],
       "order_id": "order_456",
       "redirect_url": "https://example-business.com/checkout/success",
       "webhook_url": "https://example-business.com/api/coinpay/webhook"
     }'
   ```

   Returns `payment_url` — redirect the customer there.

2. **Customer chooses** crypto or card on the hosted page. CoinPay handles both flows.

3. **Webhook** — `payment.confirmed` arrives the same way for both methods. The payload includes a `method` field (`"crypto"` or `"card"`) and method-specific details.

## Rules

- Always create the payment server-side from your authoritative order total.
- Verify webhook signatures (see WEBHOOKS prompt).
- Card refunds and crypto refunds use the same `POST /api/payments/$ID/refund` endpoint — your code does not need to branch.
- Use `example-business.com` for placeholder URLs.

## Deliverable

- A checkout endpoint that creates a unified payment and redirects to `payment_url`.
- A webhook handler that fulfills the order and stores `method` for reporting.
- A refund endpoint that works for both methods.
