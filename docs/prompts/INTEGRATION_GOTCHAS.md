# CoinPay Integration Gotchas

Pitfalls that have bitten every CoinPay integration so far. Read this BEFORE shipping a CoinPay payment flow. Each item is an actual bug observed in production — not a hypothetical.

## 1. Crypto fulfillment fires on `payment.forwarded`, not `payment.confirmed`

For card payments, the merchant-bound webhook is `payment.confirmed`. For crypto, depending on the chain/wallet config, you may get `payment.forwarded` and nothing else — the funds are in your merchant wallet, but `payment.confirmed` never fires on the merchant webhook.

**Wrong** (silently misses crypto):

```js
if (event.type === 'payment.confirmed') {
  markOrderPaid(event.data.payment_id);
}
```

**Right** (use an allowlist Set, treat both as terminal):

```js
const COMPLETE = new Set(['payment.confirmed', 'payment.forwarded']);
if (COMPLETE.has(event.type)) {
  markOrderPaid(event.data.payment_id); // idempotent — see #4
}
```

The same applies to the local-row `status` field if you're reconciling by polling `/api/payments/{id}` — `status: "forwarded"` is a terminal "credit the user" state, not an intermediate state.

## 2. For card payments, pass `success_url` AND `cancel_url`

CoinPay's create-payment route uses `success_url` and `cancel_url` from your request body **verbatim** as Stripe Checkout's success/cancel URLs. If you omit them, Stripe is configured with `coinpayportal.com/pay/<id>?status=success` — meaning your customer pays Stripe, gets redirected to a CoinPay-hosted page they don't recognize, and is **stranded there**. They never come back to your site.

The `redirect_url` field documented for crypto is **not** what Stripe uses. Always pass:

```json
{
  "success_url": "https://example-business.com/checkout/success",
  "cancel_url":  "https://example-business.com/checkout/cancel",
  "redirect_url":"https://example-business.com/checkout/success"
}
```

`redirect_url` covers the crypto-hosted-page case (5-second auto-redirect after on-chain confirmation). `success_url`/`cancel_url` cover Stripe. Send all three.

## 3. Do not use `payment_method: "card"` — use `"both"`

The documented `payment_method: "card"` value currently returns HTTP 500 (`"Failed to create payment record"`). Use `"both"` with a fallback `currency` like `"usdc_pol"`. The response will still include `stripe_checkout_url` and you can ignore the crypto side if your flow is card-only.

```jsonc
{
  "payment_method": "both",
  "currency": "usdc_pol"   // required even when only the card is wanted
}
```

## 4. Idempotency: dedupe by `payment.id`

Because both `payment.confirmed` and `payment.forwarded` can fire for the same crypto payment (different lifecycle steps), AND because CoinPay retries deliveries on failure, AND because Stripe can redeliver after a transient outage, your handler will receive duplicates. Dedupe by `event.data.payment_id` and make the credit grant short-circuit on already-completed rows. A Postgres `INSERT … ON CONFLICT DO NOTHING` or a status-guarded UPDATE works.

## 5. Don't `await` slow IO in your webhook handler

CoinPay's outbound merchant webhook has a 3 × 30s retry budget (up to 93 seconds). On the upstream side, Stripe's webhook to CoinPay also has a 30s budget. If your merchant handler awaits a PDF render, email send, or any third-party API call, you can blow CoinPay's retry budget — and because CoinPay's older code path awaited the merchant call inside its Stripe webhook handler, slow merchants could ripple all the way back to Stripe and silently break the chain.

**Wrong:**

```js
await markOrderPaid(id);
await sendReceiptEmail(...);   // blocks for seconds
await uploadPdfToS3(...);      // more seconds
return new Response('ok');     // Stripe/CoinPay timed out 20s ago
```

**Right:**

```js
await markOrderPaid(id);                           // fast: DB only
void sendReceiptEmail(...).catch(console.error);   // async, doesn't block 2xx
void uploadPdfToS3(...).catch(console.error);
return new Response('ok');                         // 200 in milliseconds
```

Caveat: `void` only works on long-running Node servers (Railway, Fly, etc.). On Vercel/Cloudflare Workers, use the platform's `waitUntil` / `after()` primitive or queue the work to a job table.

## 6. Stripe webhook secret rotation: re-deploy CoinPay's env

If you operate CoinPay (not a merchant integration concern), be aware that Stripe's `whsec_` for the platform webhook lives in CoinPay's `STRIPE_WEBHOOK_SECRET` env. If the Stripe Dashboard secret is rotated or regenerated, every incoming Stripe event will fail signature verification → 400 → Stripe marks delivery failed → `pending_webhooks` counter on each event sits >0 → no merchant gets their `payment.confirmed`. Verify by checking that the value in Stripe Dashboard → Developers → Webhooks → endpoint → "Reveal signing secret" matches your deployed env.

## 7. `pending_webhooks` doesn't decrement on signature failure

When Stripe's POST to CoinPay returns 400 (bad signature), Stripe records the delivery as failed and the event's `pending_webhooks` counter does not go down. If you query Stripe events via the API and see `pending_webhooks: 2` on every recent `checkout.session.completed`, the issue is signature verification — not slow delivery. Check the Stripe Dashboard "Recent deliveries" for the HTTP status.

## 8. Manual webhook replay is safe (and a useful diagnostic)

Both CoinPay's Stripe handler and a properly-implemented merchant handler are idempotent. If a payment is stuck in `pending` despite the customer's card being charged, you can manually replay the event:

1. Fetch the event JSON: `GET /v1/events/{evt_id}` from Stripe.
2. HMAC-SHA256 the body with `${timestamp}.${rawBody}` using your `STRIPE_WEBHOOK_SECRET` (32-byte hex of `whsec_…`).
3. POST to `https://coinpayportal.com/api/stripe/webhook` with header `stripe-signature: t=<ts>,v1=<hex>`.

The handler verifies, processes, fires the merchant webhook, returns 200. If your `whsec_` matches what Stripe is signing with, the manual replay succeeds — proving the bug is delivery-side. If it 400s, the secret is wrong.

## 9. Don't trust the UI's success banner

Stripe's `success_url` is hit by the customer's browser as soon as Stripe accepts the card — **before** Stripe's webhook to CoinPay completes, and well before CoinPay's webhook to you completes. A success banner shown purely from `?purchase=success` query params is optimistic; it doesn't mean credits have been granted on your side.

For a trustworthy "Payment received" UI, gate the banner on the actual local row status (`status = 'complete'`) and poll your `/api/credits/status` (or equivalent) for a few seconds while it's still `pending`. Otherwise customers see a green checkmark and never realize they were silently dropped.

## 10. webhook_url in the request body is ignored

CoinPay reads the merchant `webhook_url` from the `businesses` table (set in your business dashboard), not from the create-payment request body. Passing `webhook_url` in the body is harmless but does nothing. Configure it once per business via the portal.

---

If you hit a new gotcha, add it here.
