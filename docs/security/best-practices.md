# Security Best Practices

Guidelines for keeping your CoinPay integration, merchant accounts, and customer data secure.

---

## API Key Security

### Do

- **Store API keys in environment variables**, never in source code
- **Use server-side API calls only** — never expose your API key in browser JavaScript
- **Rotate keys** if you suspect a leak: Business Settings → Regenerate API Key
- **Use separate keys** for staging and production environments
- **Restrict API key scope** — each key is tied to one business

### Don't

- ❌ Commit API keys to Git (even in private repos)
- ❌ Log API keys in application logs
- ❌ Share API keys via chat, email, or tickets
- ❌ Use the same API key across multiple environments

### Key Rotation

If an API key may be compromised:

1. Go to **Business Settings → API Keys → Regenerate**
2. Update your server's environment variable immediately
3. The old key is invalidated instantly — no grace period
4. Monitor webhook logs for any unexpected activity

---

## Webhook Security

Webhooks are how CoinPay tells your server about payment events. **Always verify signatures.**

### Verify Every Webhook

```javascript
import { verifyWebhookSignature } from '@profullstack/coinpay';

// Express middleware — use raw body parsing
app.post('/webhooks/coinpay', express.raw({ type: 'application/json' }), (req, res) => {
  const isValid = verifyWebhookSignature({
    payload: req.body.toString(),               // raw string, not parsed JSON
    signature: req.headers['x-coinpay-signature'],
    secret: process.env.COINPAY_WEBHOOK_SECRET,
    tolerance: 300,                              // reject if >5 min old
  });

  if (!isValid) {
    console.warn('Rejected webhook with invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Process the event...
  res.json({ received: true });
});
```

### Why This Matters

Without signature verification, anyone can send a fake `payment.confirmed` webhook to your server and trick your application into fulfilling unpaid orders.

### Webhook Signature Format

```
X-CoinPay-Signature: t=1705312500,v1=5257a869e7ecebeda32affa62cdca3fa51cad...
```

- `t` = Unix timestamp when the webhook was sent
- `v1` = HMAC-SHA256 of `{timestamp}.{payload}` using your webhook secret
- `tolerance` = reject signatures older than N seconds (default 300 = 5 minutes)

### Idempotency

Webhooks may be delivered more than once (retries on network errors). Protect against duplicate processing:

```javascript
// Before processing
const alreadySeen = await db.webhookEvents.exists(event.id);
if (alreadySeen) {
  return res.json({ received: true }); // acknowledge but don't re-process
}
await db.webhookEvents.create({ eventId: event.id });
// Now process the event...
```

---

## Payment Verification

### Never Trust the Client

Always verify payment status server-side before fulfilling orders:

```javascript
// ❌ BAD: Trusting frontend claim of payment
app.post('/fulfill', (req, res) => {
  const { orderId, paymentConfirmed } = req.body;
  if (paymentConfirmed) fulfillOrder(orderId); // Anyone can send this!
});

// ✅ GOOD: Verify via webhook or API
app.post('/webhooks/coinpay', (req, res) => {
  // Signature verification happens first (see above)
  const event = parseWebhookPayload(req.body.toString());
  if (event.type === 'payment.confirmed') {
    fulfillOrder(event.data.metadata.orderId);
  }
});

// ✅ ALSO GOOD: Double-check via API
async function verifyPayment(paymentId) {
  const result = await client.getPayment(paymentId);
  return result.payment.status === 'confirmed' || result.payment.status === 'forwarded';
}
```

### Verify Amounts

When a payment webhook arrives, check the amount matches what you expected:

```javascript
if (event.type === 'payment.confirmed') {
  const order = await db.orders.findByPaymentId(event.data.payment_id);

  // Verify the amount matches (within 1% tolerance for exchange rate drift)
  const expectedUsd = order.totalUsd;
  const receivedUsd = parseFloat(event.data.amount_usd);
  const tolerance = expectedUsd * 0.01;

  if (Math.abs(receivedUsd - expectedUsd) > tolerance) {
    console.warn(`Amount mismatch: expected $${expectedUsd}, got $${receivedUsd}`);
    // Flag for manual review instead of auto-fulfilling
    await flagForReview(order.id);
    return;
  }

  fulfillOrder(order.id);
}
```

---

## Wallet Security

### Merchant Wallets

- Use **dedicated wallet addresses** for receiving CoinPay payments — don't mix with personal wallets
- Use **hardware wallets** or **multisig wallets** for your merchant receiving address
- **Monitor your receiving address** independently (e.g., on a block explorer) as a backup check
- Consider a **cold storage strategy**: sweep funds from your receiving wallet to cold storage periodically

### Web Wallet Users

If you're using the CoinPay Web Wallet:

- **Never share your seed phrase** — CoinPay staff will never ask for it
- **Back up your seed phrase offline** — write it on paper, store in a safe
- Your seed phrase is the **only way to recover** your wallet if you lose access
- **Enable daily spend limits** in wallet settings to limit damage if your device is compromised
- **Use address whitelisting** if you only send to known addresses
- Your private keys **never leave your browser** — the server only stores public keys

---

## Network & Infrastructure

### HTTPS Everywhere

- All CoinPay API calls use HTTPS (TLS 1.2+)
- Your webhook endpoint **must** use HTTPS — CoinPay will not deliver to HTTP URLs
- Use HSTS headers on your webhook server

### Rate Limiting

CoinPay enforces rate limits per IP and per account:

- 100 requests/minute per IP
- 1000 requests/hour per account

If you get 429 responses, implement exponential backoff:

```javascript
async function requestWithRetry(fn, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (error.status === 429 && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        console.warn(`Rate limited, retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
}
```

### Firewall Rules

- Allow outbound HTTPS to `coinpayportal.com` (API calls)
- Allow inbound HTTPS from CoinPay's IP range for webhooks (or don't restrict, since you verify signatures)
- Block all unnecessary inbound traffic to your webhook endpoint

---

## Environment Variables Checklist

Your production server should have these secrets configured securely:

```bash
# CoinPay credentials
COINPAY_API_KEY=cp_live_xxx          # API key for your business
COINPAY_WEBHOOK_SECRET=whsec_xxx     # Webhook signing secret

# Database (Supabase)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJxxx

# Application
JWT_SECRET=your-random-256-bit-secret
ENCRYPTION_MASTER_KEY=your-aes-key   # For encrypting stored private keys
INTERNAL_API_KEY=your-internal-key   # For internal service calls
```

Use a secrets manager in production:
- **Vercel**: Environment Variables (encrypted at rest)
- **Railway**: Variables panel (encrypted)
- **AWS**: Secrets Manager or Parameter Store
- **Docker**: Docker secrets

---

## Incident Response

### If Your API Key Is Compromised

1. **Immediately** regenerate via Business Settings
2. Deploy the new key to your servers
3. Check webhook logs for unauthorized payment creations
4. Review payment history for suspicious activity
5. Contact CoinPay support if needed

### If Your Webhook Secret Is Compromised

1. Regenerate via Business Settings
2. Update your webhook handler
3. An attacker with your webhook secret could **forge webhook signatures** — check if any orders were fulfilled fraudulently

### If You See Suspicious Payments

1. Check the payment details — is the address/amount what you expected?
2. Verify on a block explorer independently
3. Don't fulfill suspicious orders
4. Contact CoinPay support with the payment ID

---

## Summary Checklist

- [ ] API keys stored in environment variables, not code
- [ ] API calls made server-side only (never from browser)
- [ ] Webhook signatures verified on every request
- [ ] Webhook events deduplicated (idempotency)
- [ ] Payment amounts verified before fulfillment
- [ ] HTTPS on all endpoints
- [ ] Rate limit handling with exponential backoff
- [ ] Separate staging/production API keys
- [ ] Key rotation procedure documented
- [ ] Incident response plan in place
