# Handle CoinPay Webhooks

You are implementing a webhook receiver for CoinPay events. This is required for any payment, escrow, or subscription integration.

## Goal

Receive signed webhook deliveries from CoinPay, verify them, and update local state idempotently.

## Events

- `payment.confirmed` — buyer paid; safe to fulfill the order
- `payment.forwarded` — funds forwarded to merchant wallet (settles the merchant payout, includes on-chain txid)
- `payment.expired` — payment window passed without funding
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

  switch (event.type) {
    case 'payment.confirmed': /* mark order paid */ break;
    case 'payment.forwarded': /* store payout txid */ break;
    case 'payment.expired':   /* release reservation */ break;
    // ...
  }

  await markProcessed(event.id);
  return new Response('ok');
}
```

## Rules

- The signature is computed over the **raw** request body. Do not re-stringify parsed JSON — many frameworks (Next.js, Express with `express.json()`) lose the exact bytes. Capture the raw body.
- Reject deliveries older than 5 minutes (replay protection).
- Always idempotent: dedupe by `x-coinpay-delivery` or `event.id`.
- Return 2xx quickly; do heavy work in a background queue.
- Use `example-business.com` for the placeholder webhook URL.

## Deliverable

- One webhook endpoint, signature-verified, idempotent, with tests for: valid signature, bad signature, expired timestamp, duplicate delivery.
