# Accept Crypto + Card via Unified Payments

You are integrating CoinPay's create-payment endpoint with **both** rails enabled (crypto and credit card). The customer either picks crypto on the CoinPay-hosted page or completes a Stripe Checkout for card — your code handles both via one merchant webhook.

## Goal

One API call creates a payment that the customer can fulfill with either crypto (any supported coin/chain that you've configured a wallet for) or a card via Stripe. You receive a webhook on completion regardless of method.

## Environment variables

```
COINPAY_API_KEY=sk_live_...
COINPAY_API_URL=https://coinpayportal.com
COINPAY_MERCHANT_ID=<your business id, UUID>
COINPAY_WEBHOOK_SECRET=whsec_...
```

Where to find them:
- `COINPAY_API_KEY` — `https://coinpayportal.com/businesses/<your-business-id>` → **API Keys** tab → **Create API Key**. Shown once.
- `COINPAY_MERCHANT_ID` — the business UUID from the URL on that same page.
- `COINPAY_WEBHOOK_SECRET` — same business page → **Webhooks** tab → create endpoint → **Signing Secret**. Each endpoint has its own secret.
- **Card support also requires Stripe Connect.** Open the business page → **Stripe** tab → connect. You don't add any Stripe env vars on your side — CoinPay's platform routes the card flow through its own connected-account Stripe Checkout.

## Endpoint and required body

`POST {COINPAY_API_URL}/api/payments/create` (the documented `/api/payments/unified` does not exist — use this endpoint).

```jsonc
{
  "business_id": "<COINPAY_MERCHANT_ID>",
  "amount_usd": 49.99,
  "payment_method": "both",            // crypto + card. NOT "card" — see Gotchas.
  "currency": "usdc_pol",              // required even in `both`/card mode (used as crypto fallback)
  "description": "Order #123",
  "success_url": "https://example-business.com/checkout/success",
  "cancel_url":  "https://example-business.com/checkout/cancel",
  "redirect_url":"https://example-business.com/checkout/success",
  "metadata": { "order_id": "123" }
}
```

Critical fields explained:

- `payment_method: "both"` — returns both a crypto `payment_address` and a Stripe `stripe_checkout_url`. **Do not use `payment_method: "card"` — it currently 500s.**
- `currency` — even when you only care about the card, CoinPay requires a crypto currency on the request. Default to `usdc_pol`.
- `success_url` / `cancel_url` — used **verbatim** as Stripe Checkout's success/cancel URLs. **If you omit them, Stripe will redirect the customer to `coinpayportal.com/pay/<id>?status=success` after paying** (a CoinPay-hosted landing page that doesn't bounce back to your domain). The `redirect_url` field is documented for crypto only and is ignored on the card leg.
- `redirect_url` — used by the CoinPay-hosted page after a crypto payment completes (5-second auto-redirect). Always include both `success_url` and `redirect_url`.

## Response

```json
{
  "success": true,
  "payment": {
    "id": "<payment_id>",
    "payment_address": "0x…",         // crypto address (USDC_POL by default)
    "amount_crypto": "49.99",
    "expires_at": "2026-05-13T10:28:34Z",
    "stripe_checkout_url": "https://checkout.stripe.com/c/pay/cs_live_…",
    "stripe_session_id": "cs_live_…"
  }
}
```

Customer choice:

- **Card:** redirect them to `payment.stripe_checkout_url`. After paying, Stripe sends them to your `success_url`.
- **Crypto:** render the `payment_address` + `amount_crypto` (or redirect to `https://coinpayportal.com/pay/<id>` for the hosted page).

## Webhook

You receive **one** event per completed payment regardless of rail:

- Card → `payment.confirmed` (Stripe → CoinPay → you)
- Crypto → `payment.forwarded` (chain → CoinPay → you, includes on-chain `tx_hash`)

**Treat BOTH as terminal "complete" states.** See the `WEBHOOKS` prompt for handler shape and the events table.

## Rules

- Always create the payment server-side from your authoritative order total.
- Always pass `success_url` AND `cancel_url` — without them the card flow strands users on coinpayportal.com.
- Verify webhook signatures (see WEBHOOKS prompt) and return 2xx within milliseconds; defer slow IO (email, PDF) with `void`.
- Dedupe by `payment.id` since both `payment.confirmed` and `payment.forwarded` can fire for the same crypto payment.
- Use `example-business.com` for placeholder URLs.

## Deliverable

- A checkout endpoint that POSTs to `/api/payments/create` with `payment_method: "both"` + `success_url` + `cancel_url` and returns either the Stripe URL or the crypto address.
- A webhook handler that recognizes both `payment.confirmed` and `payment.forwarded` as completion and fulfills the order idempotently.
- Tests covering: card success, crypto success, card cancel, expired crypto.
