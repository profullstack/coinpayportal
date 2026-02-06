# @profullstack/coinpay

> CoinPay SDK & CLI — Accept cryptocurrency payments in your Node.js application.

[![npm version](https://img.shields.io/npm/v/@profullstack/coinpay)](https://www.npmjs.com/package/@profullstack/coinpay)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)

Non-custodial, multi-chain payment processing for **Bitcoin**, **Ethereum**, **Solana**, **Polygon**, **Bitcoin Cash**, and **USDC** (on ETH, POL, SOL).

---

## Table of Contents

- [How It Works](#how-it-works)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Supported Blockchains](#supported-blockchains)
- [API Reference](#api-reference)
  - [CoinPayClient](#coinpayclient)
  - [Payments](#payments)
  - [Payment Status Polling](#payment-status-polling)
  - [QR Codes](#qr-codes)
  - [Exchange Rates](#exchange-rates)
  - [Business Management](#business-management)
  - [Webhooks](#webhooks)
  - [Standalone Functions](#standalone-functions)
  - [Constants](#constants)
- [CLI Reference](#cli-reference)
- [Webhook Integration](#webhook-integration)
- [Error Handling](#error-handling)
- [Integration Patterns](#integration-patterns)
- [TypeScript](#typescript)
- [Environment Variables](#environment-variables)
- [Examples](#examples)
- [Testing](#testing)
- [License](#license)

---

## How It Works

```
┌──────────┐    1. Create payment     ┌──────────┐
│  Your    │ ───────────────────────> │ CoinPay  │
│  Server  │ <─────────────────────── │   API    │
│          │    Address + QR code     │          │
└────┬─────┘                          └────┬─────┘
     │                                     │
     │  2. Show address/QR                 │  4. Webhook notification
     │     to customer                     │     (payment confirmed)
     ▼                                     │
┌──────────┐    3. Sends crypto       ┌────▼─────┐
│ Customer │ ───────────────────────> │Blockchain│
│          │                          │ Network  │
└──────────┘                          └──────────┘
```

1. **Your server** calls the CoinPay API to create a payment request
2. **CoinPay** generates a unique payment address and QR code — display these to your customer
3. **Customer** sends cryptocurrency to the address
4. **CoinPay** monitors the blockchain and notifies you via webhook when payment is confirmed
5. **Funds** are automatically forwarded to your configured wallet

---

## Installation

```bash
# pnpm (recommended)
pnpm add @profullstack/coinpay

# npm
npm install @profullstack/coinpay

# Global CLI
pnpm add -g @profullstack/coinpay
```

**Requirements:** Node.js ≥ 20. Zero runtime dependencies — uses built-in `fetch` and `crypto`.

---

## Quick Start

### 1. Get Your API Key

1. Sign up at [coinpayportal.com](https://coinpayportal.com)
2. Create a business in your dashboard
3. Configure wallet addresses for each crypto you want to accept
4. Copy your API key (starts with `cp_live_`)

### 2. Create a Payment

```javascript
import { CoinPayClient, Blockchain } from '@profullstack/coinpay';

const client = new CoinPayClient({
  apiKey: 'cp_live_your_api_key_here',
});

const { payment } = await client.createPayment({
  businessId: 'your-business-id',
  amount: 99.99,
  currency: 'USD',
  blockchain: Blockchain.BTC,
  description: 'Order #12345',
  metadata: { orderId: '12345' },
});

console.log('Send payment to:', payment.payment_address);
console.log('Amount:', payment.crypto_amount, 'BTC');
console.log('QR Code:', payment.qr_code);
```

### 3. Handle Payment Confirmation

```javascript
import { createWebhookHandler, WebhookEvent } from '@profullstack/coinpay';

app.post('/webhook', createWebhookHandler({
  secret: 'your-webhook-secret',
  onEvent: async (event) => {
    if (event.type === WebhookEvent.PAYMENT_COMPLETED) {
      const orderId = event.data.payment.metadata.orderId;
      await markOrderAsPaid(orderId);
    }
  },
}));
```

---

## Supported Blockchains

| Blockchain | Code | Type |
|------------|------|------|
| Bitcoin | `BTC` | Native |
| Bitcoin Cash | `BCH` | Native |
| Ethereum | `ETH` | Native |
| Polygon | `POL` | Native |
| Solana | `SOL` | Native |
| USDC (Ethereum) | `USDC_ETH` | Stablecoin |
| USDC (Polygon) | `USDC_POL` | Stablecoin |
| USDC (Solana) | `USDC_SOL` | Stablecoin |

Use the `Blockchain` constant to avoid typos:

```javascript
import { Blockchain } from '@profullstack/coinpay';

Blockchain.BTC      // 'BTC'
Blockchain.ETH      // 'ETH'
Blockchain.USDC_POL // 'USDC_POL'
```

---

## API Reference

### CoinPayClient

The main class for all API operations.

```javascript
import { CoinPayClient } from '@profullstack/coinpay';

const client = new CoinPayClient({
  apiKey: 'cp_live_xxxxx',                     // Required
  baseUrl: 'https://coinpayportal.com/api',    // Optional (default)
  timeout: 30000,                               // Optional: ms (default: 30s)
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | — | **Required.** Your CoinPay API key |
| `baseUrl` | `string` | `https://coinpayportal.com/api` | API base URL |
| `timeout` | `number` | `30000` | Request timeout in milliseconds |

**Throws** `Error` if `apiKey` is missing or empty.

---

### Payments

#### `client.createPayment(params)`

Create a new payment request. Generates a unique blockchain address for the customer to pay.

```javascript
const { payment, usage } = await client.createPayment({
  businessId: 'biz_123',      // Required — from your dashboard
  amount: 100.00,             // Required — fiat amount
  currency: 'USD',            // Optional — fiat currency (default: 'USD')
  blockchain: 'ETH',          // Required — see Supported Blockchains
  description: 'Order #123',  // Optional — shown to customer
  metadata: {                 // Optional — your custom data
    orderId: '123',
    customerEmail: 'a@b.com',
  },
});
```

**Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `businessId` | `string` | ✅ | Business ID from your dashboard |
| `amount` | `number` | ✅ | Amount in fiat currency |
| `currency` | `string` | — | Fiat currency code (default: `'USD'`). Supports: `USD`, `EUR`, `GBP`, `CAD`, `AUD` |
| `blockchain` | `string` | ✅ | Blockchain code (e.g., `'BTC'`, `'ETH'`, `'USDC_POL'`) |
| `description` | `string` | — | Payment description visible to the customer |
| `metadata` | `object` | — | Arbitrary key-value data attached to the payment |

**Returns:**

```javascript
{
  success: true,
  payment: {
    id: 'pay_abc123',
    business_id: 'biz_123',
    amount: 100,
    currency: 'USD',
    blockchain: 'ETH',
    crypto_amount: '0.0456',
    payment_address: '0x1234...5678',
    qr_code: 'data:image/png;base64,...',
    status: 'pending',
    expires_at: '2024-01-01T01:00:00.000Z',
    created_at: '2024-01-01T00:00:00.000Z',
    metadata: { orderId: '123' }
  },
  usage: {
    current: 45,
    limit: 100,
    remaining: 55
  }
}
```

---

#### `client.getPayment(paymentId)`

Retrieve a payment by its ID.

```javascript
const { payment } = await client.getPayment('pay_abc123');

console.log(payment.status);          // 'pending', 'confirmed', etc.
console.log(payment.crypto_amount);   // '0.0456'
console.log(payment.tx_hash);         // '0xabc...def' (once detected)
```

---

#### `client.listPayments(params)`

List payments for a business with optional filtering and pagination.

```javascript
const { payments } = await client.listPayments({
  businessId: 'biz_123',     // Required
  status: 'completed',       // Optional — filter by status
  limit: 20,                 // Optional — results per page (default: 20)
  offset: 0,                 // Optional — pagination offset (default: 0)
});
```

---

### Payment Status Polling

#### `client.waitForPayment(paymentId, options?)`

Polls `getPayment()` until the payment reaches a terminal status. Useful for simple integrations that don't use webhooks.

```javascript
const { payment } = await client.waitForPayment('pay_abc123', {
  interval: 5000,        // Poll every 5s (default)
  timeout: 600000,       // Give up after 10 min (default: 1 hour)
  targetStatuses: ['confirmed', 'forwarded', 'expired', 'failed'],
  onStatusChange: (status, payment) => {
    console.log(`Status → ${status}`);
  },
});

if (payment.status === 'confirmed' || payment.status === 'forwarded') {
  console.log('Payment successful!');
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `interval` | `number` | `5000` | Polling interval in ms |
| `timeout` | `number` | `3600000` | Max wait time in ms |
| `targetStatuses` | `string[]` | `['confirmed','forwarded','expired','failed']` | Statuses that stop polling |
| `onStatusChange` | `function` | — | Callback `(status, payment) => void` |

> ⚠️ For production, use [webhooks](#webhook-integration) instead of polling.

---

### Payment Statuses

| Status | Description |
|--------|-------------|
| `pending` | Waiting for customer to send payment |
| `detected` | Payment detected on blockchain, awaiting confirmations |
| `confirmed` | Payment confirmed — safe to fulfill the order |
| `forwarding` | Forwarding funds to your wallet |
| `forwarded` | Funds successfully sent to your wallet |
| `expired` | Payment request expired (customer didn't pay in time) |
| `failed` | Payment failed |

---

### QR Codes

#### `client.getPaymentQRUrl(paymentId)`

Returns the URL to the QR code image. **Synchronous** — no network request.

```javascript
const url = client.getPaymentQRUrl('pay_abc123');
// "https://coinpayportal.com/api/payments/pay_abc123/qr"

// Use in HTML:
// <img src={url} alt="Payment QR Code" />
```

#### `client.getPaymentQR(paymentId)`

Fetches the QR code as binary PNG data.

```javascript
import fs from 'fs';

const imageData = await client.getPaymentQR('pay_abc123');
fs.writeFileSync('payment-qr.png', Buffer.from(imageData));
```

---

### Exchange Rates

#### `client.getExchangeRate(crypto, fiat?)`

Get the exchange rate for a single cryptocurrency.

```javascript
const rate = await client.getExchangeRate('BTC', 'USD');
```

#### `client.getExchangeRates(cryptos, fiat?)`

Get rates for multiple cryptocurrencies in one request.

```javascript
const rates = await client.getExchangeRates(['BTC', 'ETH', 'SOL'], 'USD');
```

---

### Business Management

#### `client.createBusiness(params)`

```javascript
const result = await client.createBusiness({
  name: 'My Store',
  webhookUrl: 'https://mystore.com/webhook',
  walletAddresses: {
    BTC: 'bc1q...',
    ETH: '0x...',
    SOL: '...',
  },
});
```

#### `client.getBusiness(businessId)`

```javascript
const result = await client.getBusiness('biz_123');
```

#### `client.listBusinesses()`

```javascript
const result = await client.listBusinesses();
```

#### `client.updateBusiness(businessId, params)`

```javascript
const result = await client.updateBusiness('biz_123', {
  name: 'Updated Store Name',
  webhookUrl: 'https://mystore.com/webhook/v2',
});
```

---

### Webhooks

#### `client.getWebhookLogs(businessId, limit?)`

Retrieve recent webhook delivery logs.

```javascript
const logs = await client.getWebhookLogs('biz_123', 50);
```

#### `client.testWebhook(businessId, eventType?)`

Send a test webhook event to your configured endpoint.

```javascript
await client.testWebhook('biz_123', 'payment.completed');
```

---

### Standalone Functions

Convenience functions that auto-create a client. Best for one-off operations.

```javascript
import { createPayment, getPayment, listPayments } from '@profullstack/coinpay';

// Create payment without instantiating a client
const result = await createPayment({
  apiKey: 'cp_live_xxxxx',
  businessId: 'biz_123',
  amount: 50,
  blockchain: 'BTC',
});

// Or pass an existing client
const result2 = await createPayment({
  client: existingClient,
  businessId: 'biz_123',
  amount: 50,
  blockchain: 'BTC',
});

// Get payment
const payment = await getPayment({
  apiKey: 'cp_live_xxxxx',
  paymentId: 'pay_abc123',
});

// List payments
const list = await listPayments({
  apiKey: 'cp_live_xxxxx',
  businessId: 'biz_123',
  status: 'completed',
  limit: 10,
});
```

---

### Constants

```javascript
import {
  Blockchain,
  PaymentStatus,
  FiatCurrency,
  WebhookEvent,
} from '@profullstack/coinpay';
```

#### `Blockchain`

| Key | Value | Description |
|-----|-------|-------------|
| `BTC` | `'BTC'` | Bitcoin |
| `BCH` | `'BCH'` | Bitcoin Cash |
| `ETH` | `'ETH'` | Ethereum |
| `POL` | `'POL'` | Polygon |
| `SOL` | `'SOL'` | Solana |
| `USDC_ETH` | `'USDC_ETH'` | USDC on Ethereum |
| `USDC_POL` | `'USDC_POL'` | USDC on Polygon |
| `USDC_SOL` | `'USDC_SOL'` | USDC on Solana |

> `Cryptocurrency` is exported as a **deprecated** alias for `Blockchain`.

#### `PaymentStatus`

| Key | Value |
|-----|-------|
| `PENDING` | `'pending'` |
| `CONFIRMING` | `'confirming'` |
| `COMPLETED` | `'completed'` |
| `EXPIRED` | `'expired'` |
| `FAILED` | `'failed'` |
| `REFUNDED` | `'refunded'` |

#### `FiatCurrency`

| Key | Value |
|-----|-------|
| `USD` | `'USD'` |
| `EUR` | `'EUR'` |
| `GBP` | `'GBP'` |
| `CAD` | `'CAD'` |
| `AUD` | `'AUD'` |

#### `WebhookEvent`

| Key | Value |
|-----|-------|
| `PAYMENT_CREATED` | `'payment.created'` |
| `PAYMENT_PENDING` | `'payment.pending'` |
| `PAYMENT_CONFIRMING` | `'payment.confirming'` |
| `PAYMENT_COMPLETED` | `'payment.completed'` |
| `PAYMENT_EXPIRED` | `'payment.expired'` |
| `PAYMENT_FAILED` | `'payment.failed'` |
| `PAYMENT_REFUNDED` | `'payment.refunded'` |
| `BUSINESS_CREATED` | `'business.created'` |
| `BUSINESS_UPDATED` | `'business.updated'` |

---

## CLI Reference

### Installation

```bash
# Global
pnpm add -g @profullstack/coinpay

# Or use npx
npx @profullstack/coinpay --help
```

### Configuration

```bash
coinpay config set-key cp_live_xxxxx     # Save API key
coinpay config set-url http://localhost:3000/api  # Custom URL
coinpay config show                       # Display config
```

### Payments

```bash
# Create a payment
coinpay payment create \
  --business-id biz_123 \
  --amount 100 \
  --blockchain BTC \
  --description "Order #12345"

# Get payment details
coinpay payment get pay_abc123

# List payments
coinpay payment list --business-id biz_123 --status pending --limit 10

# Get QR code
coinpay payment qr pay_abc123
```

### Businesses

```bash
coinpay business list
coinpay business get biz_123
coinpay business create --name "My Store" --webhook-url https://mysite.com/webhook
coinpay business update biz_123 --name "New Name"
```

### Exchange Rates

```bash
coinpay rates get BTC
coinpay rates list
```

### Webhooks

```bash
coinpay webhook logs biz_123
coinpay webhook test biz_123 --event payment.completed
```

---

## Webhook Integration

### Webhook Payload

When a payment status changes, CoinPay sends a `POST` request to your webhook URL:

```json
{
  "id": "evt_abc123",
  "type": "payment.completed",
  "created_at": "2024-01-01T00:15:00.000Z",
  "business_id": "biz_123",
  "data": {
    "payment": {
      "id": "pay_abc123",
      "status": "confirmed",
      "amount": 100.00,
      "currency": "USD",
      "crypto_amount": "0.0456",
      "blockchain": "ETH",
      "tx_hash": "0xabc...def",
      "metadata": { "orderId": "12345" }
    }
  }
}
```

### Signature Verification

Every webhook includes an `X-CoinPay-Signature` header in the format `t=<timestamp>,v1=<hmac-sha256>`. Always verify signatures before processing events.

#### Using the Middleware (Express)

```javascript
import express from 'express';
import { createWebhookHandler, WebhookEvent } from '@profullstack/coinpay';

const app = express();

app.post('/webhook',
  express.text({ type: 'application/json' }),
  createWebhookHandler({
    secret: process.env.COINPAY_WEBHOOK_SECRET,
    onEvent: async (event) => {
      switch (event.type) {
        case WebhookEvent.PAYMENT_COMPLETED:
          await fulfillOrder(event.data.payment.metadata.orderId);
          break;
        case WebhookEvent.PAYMENT_EXPIRED:
          await cancelOrder(event.data.payment.metadata.orderId);
          break;
      }
    },
    onError: (error) => {
      console.error('Webhook error:', error);
    },
  })
);
```

#### Manual Verification

```javascript
import { verifyWebhookSignature, parseWebhookPayload } from '@profullstack/coinpay';

const isValid = verifyWebhookSignature({
  payload: rawBody,                              // Raw request body string
  signature: req.headers['x-coinpay-signature'], // Signature header
  secret: process.env.COINPAY_WEBHOOK_SECRET,    // Your secret
  tolerance: 300,                                 // Optional: seconds (default: 300)
});

if (isValid) {
  const event = parseWebhookPayload(rawBody);
  // event.id, event.type, event.data, event.createdAt, event.businessId
}
```

#### Generating Test Signatures

```javascript
import { generateWebhookSignature } from '@profullstack/coinpay';

const signature = generateWebhookSignature({
  payload: JSON.stringify(testEvent),
  secret: 'whsec_test_secret',
  timestamp: Math.floor(Date.now() / 1000), // Optional
});
// "t=1705312500,v1=a3f2b1..."
```

### Webhook Events

| Event | When |
|-------|------|
| `payment.created` | Payment request created |
| `payment.pending` | Awaiting blockchain detection |
| `payment.confirming` | Transaction detected, awaiting confirmations |
| `payment.completed` | **Payment confirmed — safe to fulfill** |
| `payment.expired` | Customer didn't pay in time |
| `payment.failed` | Payment failed |
| `payment.refunded` | Payment was refunded |
| `business.created` | New business created |
| `business.updated` | Business settings updated |

---

## Error Handling

All API errors include a `status` code and optional `response` object:

```javascript
try {
  const payment = await client.createPayment({ ... });
} catch (error) {
  console.log(error.message);   // Human-readable message
  console.log(error.status);    // HTTP status code (401, 400, 429, etc.)
  console.log(error.response);  // Full error response from the API

  switch (error.status) {
    case 400:
      // Invalid request — check parameters
      break;
    case 401:
      // Invalid API key
      break;
    case 404:
      // Resource not found
      break;
    case 429:
      // Rate limit or transaction limit exceeded
      console.log('Usage:', error.response?.usage);
      break;
  }
}
```

**Timeout errors** throw a standard `Error` with message `"Request timeout after {ms}ms"`.

**Constructor errors** throw if `apiKey` is missing: `"API key is required"`.

---

## Integration Patterns

### E-commerce Checkout

```javascript
import { CoinPayClient, createWebhookHandler, WebhookEvent } from '@profullstack/coinpay';

const client = new CoinPayClient({ apiKey: process.env.COINPAY_API_KEY });

// Checkout endpoint
app.post('/checkout', async (req, res) => {
  const { orderId, amount, blockchain } = req.body;

  const { payment } = await client.createPayment({
    businessId: process.env.COINPAY_BUSINESS_ID,
    amount,
    blockchain,
    description: `Order #${orderId}`,
    metadata: { orderId },
  });

  await db.orders.update(orderId, {
    paymentId: payment.id,
    paymentAddress: payment.payment_address,
  });

  res.json({
    paymentAddress: payment.payment_address,
    cryptoAmount: payment.crypto_amount,
    qrCode: payment.qr_code,
    expiresAt: payment.expires_at,
  });
});

// Webhook
app.post('/webhook', express.text({ type: 'application/json' }),
  createWebhookHandler({
    secret: process.env.COINPAY_WEBHOOK_SECRET,
    onEvent: async (event) => {
      if (event.type === WebhookEvent.PAYMENT_COMPLETED) {
        const { orderId } = event.data.payment.metadata;
        await db.orders.update(orderId, { status: 'paid' });
        await sendConfirmationEmail(orderId);
      }
    },
  })
);
```

### Stablecoin Subscriptions

Use USDC for predictable pricing — no volatility:

```javascript
const { payment } = await client.createPayment({
  businessId: BUSINESS_ID,
  amount: 9.99,
  blockchain: Blockchain.USDC_POL,  // USDC on Polygon — low fees
  description: 'Monthly subscription',
  metadata: { userId: user.id, period: '2024-01' },
});
```

### Direct API (fetch / cURL)

```bash
# Create payment
curl -X POST https://coinpayportal.com/api/payments/create \
  -H "Authorization: Bearer cp_live_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "business_id": "your-business-id",
    "amount": 50.00,
    "currency": "USD",
    "blockchain": "ETH"
  }'

# Check payment status
curl https://coinpayportal.com/api/payments/pay_abc123 \
  -H "Authorization: Bearer cp_live_your_api_key"
```

---

## TypeScript

Full TypeScript support via `.d.ts` declaration files — no build step required.

```typescript
import {
  CoinPayClient,
  Blockchain,
  PaymentStatus,
  WebhookEvent,
} from '@profullstack/coinpay';

import type {
  CoinPayClientOptions,
  PaymentParams,
  Payment,
  CreatePaymentResponse,
  WaitForPaymentOptions,
  VerifyWebhookParams,
  ParsedWebhookEvent,
} from '@profullstack/coinpay';

const client = new CoinPayClient({ apiKey: 'cp_live_xxxxx' });

const { payment }: CreatePaymentResponse = await client.createPayment({
  businessId: 'biz_123',
  amount: 100,
  blockchain: Blockchain.ETH,
});
```

### Subpath Imports

```typescript
// Import only what you need
import { Blockchain, PaymentStatus } from '@profullstack/coinpay/payments';
import { verifyWebhookSignature, WebhookEvent } from '@profullstack/coinpay/webhooks';
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `COINPAY_API_KEY` | API key (overrides config file in CLI) |
| `COINPAY_BASE_URL` | Custom API URL (for development) |

---

## Examples

See the [`examples/`](./examples/) directory for runnable code:

| Example | Description |
|---------|-------------|
| [`01-quick-start.js`](./examples/01-quick-start.js) | Create a payment and check status |
| [`02-create-payment.js`](./examples/02-create-payment.js) | All blockchain types, metadata, multi-currency |
| [`03-check-payment-status.js`](./examples/03-check-payment-status.js) | One-time check and `waitForPayment` polling |
| [`04-list-payments.js`](./examples/04-list-payments.js) | Filtering and pagination |
| [`05-exchange-rates.js`](./examples/05-exchange-rates.js) | Single and batch rate lookups |
| [`06-webhook-handler.js`](./examples/06-webhook-handler.js) | Express webhook server |
| [`07-ecommerce-checkout.js`](./examples/07-ecommerce-checkout.js) | Complete checkout → webhook → fulfillment flow |
| [`08-business-management.js`](./examples/08-business-management.js) | Create, list, and update businesses |
| [`09-error-handling.js`](./examples/09-error-handling.js) | Auth, validation, rate-limit, and timeout errors |

```bash
COINPAY_API_KEY=cp_live_xxx COINPAY_BUSINESS_ID=biz_xxx node examples/01-quick-start.js
```

---

## Testing

```bash
# Run tests
pnpm test

# Watch mode
pnpm test:watch
```

Tests use [Vitest](https://vitest.dev/) with mocked `fetch` — no API key needed.

---

## Support

- **Docs:** [docs.coinpayportal.com](https://docs.coinpayportal.com)
- **Dashboard:** [coinpayportal.com](https://coinpayportal.com)
- **Email:** support@coinpayportal.com
- **Issues:** [github.com/profullstack/coinpayportal/issues](https://github.com/profullstack/coinpayportal/issues)

---

## License

[MIT](./LICENSE) © Profullstack, Inc.
