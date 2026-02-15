# SDK Getting Started Guide

The `@profullstack/coinpay` SDK lets you integrate CoinPay crypto payments into any Node.js or browser application in minutes.

---

## Installation

```bash
npm install @profullstack/coinpay
# or
pnpm add @profullstack/coinpay
# or
yarn add @profullstack/coinpay
```

The SDK has zero dependencies — it uses the native `fetch` API (Node 18+ / modern browsers).

---

## Quick Start

### 1. Get Your API Key

1. Sign up at [coinpayportal.com](https://coinpayportal.com)
2. Create a business from the dashboard
3. Go to **Business Settings → API Keys**
4. Copy your API key (starts with `cp_live_`)

### 2. Initialize the Client

```javascript
import { CoinPayClient, Blockchain } from '@profullstack/coinpay';

const client = new CoinPayClient({
  apiKey: 'cp_live_your_api_key_here',
  // baseUrl: 'https://coinpayportal.com/api',  // default
  // timeout: 30000,                              // default: 30s
});
```

### 3. Create a Payment

```javascript
const result = await client.createPayment({
  businessId: 'your-business-uuid',
  amount: 49.99,
  currency: 'USD',
  blockchain: Blockchain.BTC,
  description: 'Premium Plan - Monthly',
  metadata: {
    orderId: 'ORD-2025-001',
    customerEmail: 'buyer@example.com',
  },
});

console.log('Pay to:', result.payment.payment_address);
console.log('Amount:', result.payment.crypto_amount, 'BTC');
console.log('QR Code:', client.getPaymentQRUrl(result.payment.id));
```

### 4. Check Payment Status

```javascript
// Option A: Poll manually
const status = await client.getPayment(result.payment.id);
console.log(status.payment.status); // 'pending' | 'confirmed' | 'forwarded' | 'expired'

// Option B: Wait for completion (blocks until done)
const final = await client.waitForPayment(result.payment.id, {
  interval: 5000,        // check every 5s
  timeout: 600000,       // give up after 10 min
  onStatusChange: (newStatus, payment) => {
    console.log(`Status changed to: ${newStatus}`);
  },
});

if (final.payment.status === 'confirmed' || final.payment.status === 'forwarded') {
  console.log('Payment successful!');
}
```

### 5. Handle Webhooks

```javascript
import express from 'express';
import { verifyWebhookSignature, parseWebhookPayload, WebhookEvent } from '@profullstack/coinpay';

const app = express();

// IMPORTANT: Use raw body for signature verification
app.post('/webhooks/coinpay', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-coinpay-signature'];
  const payload = req.body.toString();

  // Verify the webhook is from CoinPay
  const isValid = verifyWebhookSignature({
    payload,
    signature,
    secret: process.env.COINPAY_WEBHOOK_SECRET,
    tolerance: 300, // reject webhooks older than 5 minutes
  });

  if (!isValid) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Parse and handle the event
  const event = parseWebhookPayload(payload);

  switch (event.type) {
    case WebhookEvent.PAYMENT_COMPLETED:
      console.log('✅ Payment confirmed:', event.data);
      // Fulfill the order, send confirmation email, etc.
      break;

    case WebhookEvent.PAYMENT_EXPIRED:
      console.log('⏰ Payment expired:', event.data);
      // Cancel the order, notify the customer
      break;

    case WebhookEvent.PAYMENT_FAILED:
      console.error('❌ Payment failed:', event.data);
      break;
  }

  res.json({ received: true });
});

app.listen(3000);
```

---

## Supported Blockchains

Use the `Blockchain` enum for type-safe chain selection:

```javascript
import { Blockchain } from '@profullstack/coinpay';

Blockchain.BTC       // Bitcoin
Blockchain.BCH       // Bitcoin Cash
Blockchain.ETH       // Ethereum
Blockchain.POL       // Polygon
Blockchain.SOL       // Solana
Blockchain.USDC_ETH  // USDC on Ethereum
Blockchain.USDC_POL  // USDC on Polygon
Blockchain.USDC_SOL  // USDC on Solana
```

---

## Client Methods

### Payments

| Method | Description |
|--------|-------------|
| `createPayment(params)` | Create a new payment request |
| `getPayment(id)` | Get payment details and status |
| `waitForPayment(id, options?)` | Poll until payment reaches terminal status |
| `listPayments(params)` | List payments for a business |
| `getPaymentQRUrl(id)` | Get QR code image URL |
| `getPaymentQR(id)` | Get QR code as binary ArrayBuffer |

### Businesses

| Method | Description |
|--------|-------------|
| `listBusinesses()` | List all businesses |
| `getBusiness(id)` | Get business details |
| `createBusiness(params)` | Create a new business |
| `updateBusiness(id, params)` | Update business settings |

### Rates & Webhooks

| Method | Description |
|--------|-------------|
| `getExchangeRate(crypto, fiat?)` | Get single exchange rate |
| `getExchangeRates(cryptos, fiat?)` | Get multiple exchange rates |
| `getWebhookLogs(businessId, limit?)` | Get webhook delivery logs |
| `testWebhook(businessId, eventType?)` | Send a test webhook |

---

## Webhook Utilities

| Function | Description |
|----------|-------------|
| `verifyWebhookSignature(params)` | Verify webhook HMAC signature |
| `parseWebhookPayload(rawBody)` | Parse raw body into typed event |
| `createWebhookHandler(options)` | Express middleware for webhook handling |
| `generateWebhookSignature(params)` | Generate signature (for testing) |

---

## CLI Tool

The SDK includes a command-line tool:

```bash
# Install globally
npm install -g @profullstack/coinpay

# Configure
coinpay config set-key cp_live_your_key

# Create a payment
coinpay payment create --business-id biz_123 --amount 100 --blockchain BTC

# Check payment status
coinpay payment get pay_abc123

# List businesses
coinpay business list

# Get exchange rates
coinpay rates get BTC
```

Run `coinpay --help` for full command reference.

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `COINPAY_API_KEY` | API key (overrides constructor/config) |
| `COINPAY_BASE_URL` | Custom API URL |
| `COINPAY_WEBHOOK_SECRET` | Webhook signing secret |

---

## Error Handling

```javascript
try {
  const payment = await client.createPayment({ ... });
} catch (error) {
  console.error(error.message);   // "No BTC wallet configured for this business"
  console.error(error.status);    // 400
  console.error(error.response);  // Full API response object
}
```

Timeout errors throw with `error.message === 'Request timeout after 30000ms'`.

---

## TypeScript

The SDK is written in JavaScript with JSDoc types. TypeScript projects get full IntelliSense out of the box without needing `@types/*`.

---

## Lightning Network

The SDK includes full Lightning Network support via LNbits.

### Lightning Address

```typescript
// Get current Lightning Address
const addr = await wallet.getLightningAddress();
console.log(addr.lightning_address); // "alice@coinpayportal.com"

// Register a Lightning Address
const result = await wallet.setLightningAddress('alice');
console.log(result.lightning_address); // "alice@coinpayportal.com"
```

### Create & Pay Invoices

```typescript
// Create a BOLT11 invoice (receive payment)
const invoice = await wallet.createLightningInvoice(1000, 'Coffee payment');
console.log(invoice.payment_request); // "lnbc10u1p..."

// Pay a BOLT11 invoice
const payment = await wallet.payLightningInvoice('lnbc10u1p...');
console.log(payment.payment_hash);

// Check payment status
const status = await wallet.checkLightningPayment(payment.payment_hash);
console.log(status.paid); // true

// List recent payments
const payments = await wallet.listLightningPayments(20);
```

### Lightning Address Resolution

Anyone can pay `alice@coinpayportal.com` from any Lightning wallet (Phoenix, Muun, Wallet of Satoshi, etc). The address resolves via the LNURL-pay protocol at `coinpayportal.com/.well-known/lnurlp/alice`.

---

## Next Steps

- [Integration Examples](../integration-examples/) — Node.js bot, browser app, e-commerce
- [API Reference](../api/README.md) — Full endpoint documentation
- [Security Best Practices](../security/best-practices.md) — Keep your integration secure
- [Webhook Guide](../api/README.md#webhooks) — Handle real-time payment notifications
