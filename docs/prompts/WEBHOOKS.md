# Handle CoinPay Webhooks

You are implementing a webhook receiver for CoinPay events. This is required for any payment, escrow, or subscription integration.

## Goal

Receive signed webhook deliveries from CoinPay, verify them, and update local state idempotently.

## Environment variables

```
COINPAY_WEBHOOK_SECRET=whsec_...
```

Where to find it:
- `https://coinpayportal.com/businesses/<your-business-id>` → **Webhooks** tab (or `?mode=webhooks`) → create an endpoint pointing at your `https://example-business.com/api/coinpay/webhook` URL → copy the **Signing Secret**.
- Each endpoint has its own secret. If you rotate it in the portal, update `.env` and redeploy.

## Events

**Treat BOTH `payment.confirmed` AND `payment.forwarded` as completion** — your handler should fulfill the order on whichever arrives first. They mean different things internally and which one fires depends on the payment rail:

| Event | Card rail | Crypto rail | Action |
| --- | --- | --- | --- |
| `payment.confirmed` | Fires after Stripe Checkout completes — funds in your CoinPay-connected Stripe account | Fires when the chain has enough confirmations — funds NOT yet in your merchant wallet | Fulfill if rail is card; safe to fulfill if rail is crypto (CoinPay forwards next) |
| `payment.forwarded` | Not fired for card | Fires when crypto funds are forwarded to your merchant wallet — includes the on-chain payout txid | Fulfill (this is the canonical "merchant has the money" event for crypto) |

A handler that only switches on `payment.confirmed` will silently miss every crypto payment — `payment.forwarded` is the only signal that fires for the crypto path on some chain/wallet configs. Make both events terminal `"complete"` states and dedupe by `payment.id` so it doesn't matter which lands first.

Other events:

- `payment.expired` — payment window passed without funding
- `payment.failed` — payment was attempted but failed (typically card decline)
- `escrow.funded` / `escrow.released` / `escrow.refunded` / `escrow.disputed`
- `series.cycle.created` / `series.cycle.funded` / `series.cycle.missed` / `series.canceled`

## Headers

Each delivery includes:

- `x-coinpay-signature: t=<timestamp>,v1=<hex_hmac>`
- `x-coinpay-event: <event_name>`
- `x-coinpay-delivery: <unique_id>` — use for dedupe

## Verification (Node)

```js
import crypto from 'crypto';

function verifyWebhookSignature(rawBody, signatureHeader, secret) {
  const parts = signatureHeader.split(',');
  const signatureParts = {};
  for (const part of parts) {
    const [key, value] = part.split('=');
    signatureParts[key] = value;
  }
  const timestamp = signatureParts.t;
  const expectedSignature = signatureParts.v1;

  const timestampAge = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (timestampAge > 300) return false; // reject anything older than 5 minutes

  const signedPayload = `${timestamp}.${rawBody}`;
  const computedSignature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(computedSignature),
    Buffer.from(expectedSignature)
  );
}
```

## Handler shape

```js
export async function POST(req) {
  const rawBody = await req.text(); // MUST be the raw body, not parsed JSON
  const signature = req.headers.get('x-coinpay-signature');
  const secret = process.env.COINPAY_WEBHOOK_SECRET;

  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    return new Response('Invalid signature', { status: 401 });
  }

  const event = JSON.parse(rawBody);

  // Idempotency: skip if we've seen this delivery before
  if (await alreadyProcessed(event.id)) return new Response('ok');

  // Use an allowlist Set, not a switch — adding a new completion event
  // should be one change in one place, and dedupe by payment.id covers
  // the case where both `payment.confirmed` and `payment.forwarded` fire
  // for the same crypto payment.
  const COMPLETE = new Set(['payment.confirmed', 'payment.forwarded']);
  const FAIL = new Set(['payment.expired', 'payment.failed']);

  if (COMPLETE.has(event.type)) {
    // Mark order paid + store payout txid if present (event.data.tx_hash
    // is set on `payment.forwarded` for crypto).
  } else if (FAIL.has(event.type)) {
    // Release reservation.
  }

  await markProcessed(event.id);
  return new Response('ok');
}
```

## Rules

- The signature is computed over the **raw** request body. Do not re-stringify parsed JSON — many frameworks (Next.js, Express with `express.json()`) lose the exact bytes. Capture the raw body.
- Reject deliveries older than 5 minutes (replay protection).
- Always idempotent: dedupe by `x-coinpay-delivery` or `event.id`.
- **Return 2xx quickly — do not `await` slow IO inside the handler.** CoinPay's outbound delivery uses 3 retries with a 30s timeout each (up to 93s). If your handler awaits PDF rendering, email sending, or any third-party API, you can blow CoinPay's retry budget — which in turn ripples back to Stripe (whose webhook to CoinPay also has a 30s budget for card payments) and silently breaks the whole chain. Grant the credit / mark the order paid synchronously, then `void` the slow work:

  ```js
  await markOrderPaid(event.data.payment_id); // fast: DB update
  void sendReceiptEmail(...).catch(console.error); // slow: defer
  return new Response('ok'); // 200 within milliseconds
  ```

- Treat `payment.confirmed` AND `payment.forwarded` as completion (see Events table above) — handlers that only listen for `payment.confirmed` silently miss crypto payments.
- Use `example-business.com` for the placeholder webhook URL.

## Deliverable

- One webhook endpoint, signature-verified, idempotent, with tests for: valid signature, bad signature, expired timestamp, duplicate delivery.
