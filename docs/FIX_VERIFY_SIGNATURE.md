# CoinPay Webhook Integration Update

We've fixed an issue with webhook signatures. Your existing integration should now work correctly without any changes if you followed the test webhook format.

## What Changed (Server-Side Fix)

Production webhooks now match the test webhook format exactly:
- **Signature**: Now uses your webhook secret directly (was incorrectly being transformed)
- **Payload**: Now uses nested format matching test webhooks

**No client-side changes are required** if you implemented verification based on test webhooks.

---

## Webhook Payload Format

All webhooks now use this nested structure:

```json
{
  "id": "evt_pay_abc123_1705315800",
  "type": "payment.confirmed",
  "data": {
    "payment_id": "pay_abc123",
    "status": "confirmed",
    "amount_crypto": "0.05",
    "amount_usd": "150.00",
    "currency": "ETH",
    "payment_address": "0x1234...5678",
    "tx_hash": "0xabc...def",
    "metadata": {
      "order_id": "order_12345",
      "customer_email": "customer@example.com"
    }
  },
  "created_at": "2024-01-15T10:30:00Z",
  "business_id": "biz_xyz789"
}
```

**Important**:
- Payment data is inside the `data` object, not at the top level
- The `metadata` field contains any custom data you passed when creating the payment (order IDs, customer info, etc.)

---

## Signature Verification

### Header Format
```
X-CoinPay-Signature: t=1705315800,v1=5d41402abc4b2a76b9719d911017c592
```

### Verification Algorithm
```
signature = HMAC-SHA256(timestamp + "." + rawBody, your_webhook_secret)
```

---

## Node.js / Express Example

```javascript
import crypto from 'crypto';
import express from 'express';

const app = express();

// IMPORTANT: Use express.raw() to get the raw body for signature verification
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body.toString();
  const signature = req.headers['x-coinpay-signature'];
  const secret = process.env.COINPAY_WEBHOOK_SECRET;

  // Verify signature
  if (!verifySignature(rawBody, signature, secret)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Parse the event
  const event = JSON.parse(rawBody);

  // Handle based on event type
  switch (event.type) {
    case 'payment.confirmed':
      // Safe to fulfill the order
      const paymentId = event.data.payment_id;
      const amount = event.data.amount_crypto;
      console.log(`Payment ${paymentId} confirmed for ${amount}`);
      // TODO: Fulfill order
      break;

    case 'payment.forwarded':
      // Funds sent to your wallet
      console.log(`Funds forwarded: ${event.data.merchant_tx_hash}`);
      break;

    case 'payment.expired':
      // Payment window expired
      console.log(`Payment expired: ${event.data.payment_id}`);
      break;
  }

  res.json({ received: true });
});

function verifySignature(rawBody, signatureHeader, secret) {
  try {
    // Parse header: t=timestamp,v1=signature
    const parts = {};
    for (const part of signatureHeader.split(',')) {
      const [key, value] = part.split('=');
      parts[key] = value;
    }

    const timestamp = parts.t;
    const expectedSig = parts.v1;

    // Check timestamp (reject if older than 5 minutes)
    const age = Math.floor(Date.now() / 1000) - parseInt(timestamp);
    if (Math.abs(age) > 300) {
      return false;
    }

    // Compute signature
    const signedPayload = `${timestamp}.${rawBody}`;
    const computedSig = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    // Timing-safe comparison
    return crypto.timingSafeEqual(
      Buffer.from(expectedSig, 'hex'),
      Buffer.from(computedSig, 'hex')
    );
  } catch {
    return false;
  }
}

app.listen(3000);
```

---

## Python / Flask Example

```python
import hmac
import hashlib
import time
from flask import Flask, request, jsonify

app = Flask(__name__)
WEBHOOK_SECRET = "your_webhook_secret"

@app.route('/webhook', methods=['POST'])
def webhook():
    raw_body = request.get_data(as_text=True)
    signature = request.headers.get('X-CoinPay-Signature')

    if not verify_signature(raw_body, signature, WEBHOOK_SECRET):
        return jsonify({'error': 'Invalid signature'}), 401

    event = request.get_json()

    if event['type'] == 'payment.confirmed':
        payment_id = event['data']['payment_id']
        print(f"Payment confirmed: {payment_id}")
        # TODO: Fulfill order

    return jsonify({'received': True})

def verify_signature(raw_body, signature_header, secret):
    try:
        parts = dict(p.split('=') for p in signature_header.split(','))
        timestamp = parts['t']
        expected_sig = parts['v1']

        # Check timestamp
        age = abs(int(time.time()) - int(timestamp))
        if age > 300:
            return False

        # Compute signature
        signed_payload = f"{timestamp}.{raw_body}"
        computed_sig = hmac.new(
            secret.encode(),
            signed_payload.encode(),
            hashlib.sha256
        ).hexdigest()

        return hmac.compare_digest(expected_sig, computed_sig)
    except:
        return False
```

---

## PHP Example

```php
<?php

$webhookSecret = getenv('COINPAY_WEBHOOK_SECRET');
$rawBody = file_get_contents('php://input');
$signature = $_SERVER['HTTP_X_COINPAY_SIGNATURE'] ?? '';

if (!verifySignature($rawBody, $signature, $webhookSecret)) {
    http_response_code(401);
    echo json_encode(['error' => 'Invalid signature']);
    exit;
}

$event = json_decode($rawBody, true);

switch ($event['type']) {
    case 'payment.confirmed':
        $paymentId = $event['data']['payment_id'];
        // TODO: Fulfill order
        break;
    case 'payment.forwarded':
        // Funds forwarded
        break;
}

echo json_encode(['received' => true]);

function verifySignature($rawBody, $signatureHeader, $secret) {
    // Parse header
    $parts = [];
    foreach (explode(',', $signatureHeader) as $part) {
        list($key, $value) = explode('=', $part, 2);
        $parts[$key] = $value;
    }

    $timestamp = $parts['t'] ?? '';
    $expectedSig = $parts['v1'] ?? '';

    // Check timestamp (5 minute tolerance)
    if (abs(time() - intval($timestamp)) > 300) {
        return false;
    }

    // Compute signature
    $signedPayload = $timestamp . '.' . $rawBody;
    $computedSig = hash_hmac('sha256', $signedPayload, $secret);

    return hash_equals($expectedSig, $computedSig);
}
```

---

## Common Mistakes to Avoid

### 1. Don't parse then re-stringify the body

```javascript
// WRONG - whitespace changes break signature
const body = JSON.stringify(JSON.parse(rawBody));

// CORRECT - use raw body exactly as received
const body = req.body.toString();
```

### 2. Access payment data from `event.data`, not `event`

```javascript
// WRONG
const paymentId = event.payment_id;

// CORRECT
const paymentId = event.data.payment_id;
```

### 3. Use the webhook secret from your dashboard directly

- Don't encode, decode, or transform it
- Copy it exactly as shown

---

## Event Types

| Event | Description |
|-------|-------------|
| `payment.confirmed` | Payment confirmed on blockchain - safe to fulfill order |
| `payment.forwarded` | Funds forwarded to your merchant wallet |
| `payment.expired` | Payment request expired (15 minute window) |

---

## Testing

Use the **"Test Webhook"** button in your business dashboard to verify your integration works before processing real payments.

---

## Questions?

Contact support if you have any issues with your webhook integration.
