# @profullstack/coinpay

CoinPay SDK & CLI - Accept cryptocurrency payments in your application.

## Overview

CoinPay allows merchants to accept cryptocurrency payments from their customers. When a customer wants to pay:

1. **Your server** calls the CoinPay API to create a payment request
2. **CoinPay** generates a unique payment address and QR code
3. **Your customer** sends cryptocurrency to that address
4. **CoinPay** monitors the blockchain and notifies you via webhook when payment is confirmed
5. **Funds** are automatically forwarded to your configured wallet (minus a small fee)

## Installation

```bash
# Using pnpm (recommended)
pnpm add @profullstack/coinpay

# Using npm
npm install @profullstack/coinpay

# Global CLI installation
pnpm add -g @profullstack/coinpay
```

## Quick Start

### 1. Get Your API Key

1. Sign up at [coinpayportal.com](https://coinpayportal.com)
2. Create a business in your dashboard
3. Configure your wallet addresses for each cryptocurrency you want to accept
4. Copy your API key (starts with `cp_live_`)

### 2. Create a Payment (SDK)

```javascript
import { CoinPayClient } from '@profullstack/coinpay';

// Initialize with your API key
const coinpay = new CoinPayClient({
  apiKey: 'cp_live_your_api_key_here',
});

// Create a payment when customer checks out
const payment = await coinpay.createPayment({
  businessId: 'your-business-id',  // From your dashboard
  amount: 99.99,                    // Amount in fiat currency
  currency: 'USD',                  // Fiat currency (default: USD)
  blockchain: 'BTC',                // Cryptocurrency to accept
  description: 'Order #12345',      // Shown to customer
  metadata: {                       // Your custom data
    orderId: '12345',
    customerEmail: 'customer@example.com'
  }
});

// Display to customer
console.log('Send payment to:', payment.payment.payment_address);
console.log('Amount:', payment.payment.crypto_amount, payment.payment.blockchain);
console.log('QR Code:', payment.payment.qr_code);
```

### 3. Create a Payment (cURL)

```bash
curl -X POST https://coinpayportal.com/api/payments/create \
  -H "Authorization: Bearer cp_live_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "business_id": "your-business-id",
    "amount": 99.99,
    "currency": "USD",
    "blockchain": "BTC",
    "description": "Order #12345",
    "metadata": {
      "orderId": "12345",
      "customerEmail": "customer@example.com"
    }
  }'
```

### 4. Create a Payment (CLI)

```bash
# Configure your API key (one-time setup)
coinpay config set-key cp_live_your_api_key_here

# Create a payment
coinpay payment create \
  --business-id your-business-id \
  --amount 99.99 \
  --blockchain BTC \
  --description "Order #12345"
```

## Supported Blockchains

| Blockchain | Code | Description |
|------------|------|-------------|
| Bitcoin | `BTC` | Native Bitcoin |
| Bitcoin Cash | `BCH` | Bitcoin Cash |
| Ethereum | `ETH` | Native Ether |
| Polygon | `MATIC` | Native MATIC |
| Solana | `SOL` | Native SOL |
| USDC (Ethereum) | `USDC_ETH` | USDC on Ethereum |
| USDC (Polygon) | `USDC_MATIC` | USDC on Polygon |
| USDC (Solana) | `USDC_SOL` | USDC on Solana |

## SDK API Reference

### CoinPayClient

```javascript
import { CoinPayClient } from '@profullstack/coinpay';

const client = new CoinPayClient({
  apiKey: 'cp_live_xxxxx',           // Required: Your API key
  baseUrl: 'https://coinpayportal.com/api', // Optional: API URL
  timeout: 30000,                     // Optional: Request timeout (ms)
});
```

### Creating Payments

```javascript
// Create a payment
const payment = await client.createPayment({
  businessId: 'biz_123',      // Required: Your business ID
  amount: 100,                // Required: Amount in fiat
  currency: 'USD',            // Optional: Fiat currency (default: USD)
  blockchain: 'ETH',          // Required: Blockchain to use
  description: 'Order #123',  // Optional: Description for customer
  metadata: { ... },          // Optional: Your custom data
});

// Response structure
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
    created_at: '2024-01-01T00:00:00.000Z'
  },
  usage: {
    current: 45,
    limit: 100,
    remaining: 55
  }
}
```

### Checking Payment Status

There are two ways to know when a payment is complete:

#### Option 1: Polling (Simple)

Use `getPayment()` to check status, or `waitForPayment()` to poll until complete:

```javascript
// Check status once
const result = await client.getPayment('pay_abc123');
console.log(result.payment.status);

// Or wait for payment to complete (polls automatically)
const payment = await client.waitForPayment('pay_abc123', {
  interval: 5000,      // Check every 5 seconds
  timeout: 600000,     // Give up after 10 minutes
  onStatusChange: (status, payment) => {
    console.log(`Status changed to: ${status}`);
  }
});

if (payment.payment.status === 'confirmed' || payment.payment.status === 'forwarded') {
  console.log('Payment successful!');
} else {
  console.log('Payment failed or expired');
}
```

#### Option 2: Webhooks (Recommended for Production)

Configure a webhook URL in your business settings to receive real-time notifications:

```javascript
// Your webhook endpoint receives POST requests like:
{
  "event": "payment.confirmed",
  "data": {
    "payment": {
      "id": "pay_abc123",
      "status": "confirmed",
      "metadata": { "orderId": "12345" }
    }
  }
}
```

See [Webhook Integration](#webhook-integration) for full details.

**Payment Statuses:**
- `pending` - Waiting for payment
- `detected` - Payment detected, waiting for confirmations
- `confirmed` - Payment confirmed on blockchain
- `forwarding` - Forwarding to your wallet
- `forwarded` - Successfully sent to your wallet
- `expired` - Payment request expired
- `failed` - Payment failed

### Getting QR Code

The QR code endpoint returns binary PNG image data.

```javascript
// Get QR code URL for use in HTML <img> tags
const qrUrl = client.getPaymentQRUrl('pay_abc123');
// Returns: "https://coinpayportal.com/api/payments/pay_abc123/qr"

// Use directly in HTML
// <img src={qrUrl} alt="Payment QR Code" />

// Get QR code as binary data (for server-side processing)
const imageData = await client.getPaymentQR('pay_abc123');

// Save to file (Node.js)
import fs from 'fs';
fs.writeFileSync('payment-qr.png', Buffer.from(imageData));
```

### Listing Payments

```javascript
const payments = await client.listPayments({
  businessId: 'biz_123',
  status: 'completed',  // Optional filter
  limit: 20,            // Optional (default: 20)
  offset: 0,            // Optional pagination
});
```

### Exchange Rates

```javascript
// Get single rate
const rate = await client.getExchangeRate('BTC', 'USD');
// { from: 'BTC', to: 'USD', rate: 43250.00 }

// Get multiple rates
const rates = await client.getExchangeRates(['BTC', 'ETH', 'SOL'], 'USD');
```

## Direct API Usage (fetch/curl)

### Create Payment

```javascript
// Using fetch
const response = await fetch('https://coinpayportal.com/api/payments/create', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer cp_live_your_api_key',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    business_id: 'your-business-id',
    amount: 50.00,
    currency: 'USD',
    blockchain: 'ETH',
    description: 'Premium subscription',
    metadata: {
      userId: 'user_123',
      plan: 'premium'
    }
  }),
});

const data = await response.json();
console.log(data.payment.payment_address);
```

```bash
# Using cURL
curl -X POST https://coinpayportal.com/api/payments/create \
  -H "Authorization: Bearer cp_live_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "business_id": "your-business-id",
    "amount": 50.00,
    "currency": "USD",
    "blockchain": "ETH",
    "description": "Premium subscription"
  }'
```

### Get Payment Status

```javascript
const response = await fetch('https://coinpayportal.com/api/payments/pay_abc123', {
  headers: {
    'Authorization': 'Bearer cp_live_your_api_key',
  },
});
const data = await response.json();
```

```bash
curl https://coinpayportal.com/api/payments/pay_abc123 \
  -H "Authorization: Bearer cp_live_your_api_key"
```

## Webhook Integration

When payment status changes, CoinPay sends a POST request to your configured webhook URL:

```javascript
// Webhook payload
{
  "event": "payment.confirmed",
  "timestamp": "2024-01-01T00:15:00.000Z",
  "data": {
    "payment": {
      "id": "pay_abc123",
      "business_id": "biz_123",
      "amount": 100.00,
      "currency": "USD",
      "crypto_amount": "0.0456",
      "blockchain": "ETH",
      "status": "confirmed",
      "tx_hash": "0xabc...def",
      "metadata": {
        "orderId": "12345"
      }
    }
  },
  "signature": "sha256_hmac_signature"
}
```

### Verifying Webhooks

```javascript
import { verifyWebhookSignature, createWebhookHandler } from '@profullstack/coinpay';

// Manual verification
const isValid = verifyWebhookSignature({
  payload: rawBody,
  signature: req.headers['x-coinpay-signature'],
  secret: 'your-webhook-secret',
});

// Express middleware
app.post('/webhook', createWebhookHandler({
  secret: 'your-webhook-secret',
  onEvent: async (event) => {
    switch (event.type) {
      case 'payment.confirmed':
        // Mark order as paid
        await markOrderPaid(event.data.payment.metadata.orderId);
        break;
      case 'payment.forwarded':
        // Funds received in your wallet
        break;
      case 'payment.expired':
        // Handle expired payment
        break;
    }
  },
}));
```

### Webhook Events

| Event | Description |
|-------|-------------|
| `payment.created` | Payment request created |
| `payment.detected` | Payment detected on blockchain |
| `payment.confirmed` | Payment confirmed (safe to fulfill order) |
| `payment.forwarding` | Forwarding funds to your wallet |
| `payment.forwarded` | Funds sent to your wallet |
| `payment.expired` | Payment request expired |
| `payment.failed` | Payment failed |

## CLI Reference

### Configuration

```bash
# Set your API key
coinpay config set-key cp_live_xxxxx

# Set custom API URL (for development)
coinpay config set-url http://localhost:3000/api

# Show current configuration
coinpay config show
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

# Get QR code (saves as PNG file)
coinpay payment qr pay_abc123 --output payment-qr.png
```

### Businesses

```bash
# List your businesses
coinpay business list

# Get business details
coinpay business get biz_123

# Create a business
coinpay business create --name "My Store" --webhook-url https://mysite.com/webhook
```

### Exchange Rates

```bash
# Get rate for a cryptocurrency
coinpay rates get BTC

# Get all rates
coinpay rates list
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `COINPAY_API_KEY` | API key (overrides config file) |
| `COINPAY_BASE_URL` | Custom API URL (for development) |

## Error Handling

```javascript
try {
  const payment = await client.createPayment({ ... });
} catch (error) {
  if (error.status === 401) {
    console.error('Invalid API key');
  } else if (error.status === 400) {
    console.error('Invalid request:', error.response?.error);
  } else if (error.status === 429) {
    console.error('Rate limit exceeded or transaction limit reached');
    console.error('Usage:', error.response?.usage);
  } else {
    console.error('Error:', error.message);
  }
}
```

## Common Integration Patterns

### E-commerce Checkout

```javascript
// In your checkout handler
app.post('/checkout', async (req, res) => {
  const { orderId, amount, cryptocurrency } = req.body;
  
  const payment = await coinpay.createPayment({
    businessId: process.env.COINPAY_BUSINESS_ID,
    amount,
    blockchain: cryptocurrency,
    description: `Order #${orderId}`,
    metadata: { orderId }
  });
  
  // Save payment ID to your order
  await db.orders.update(orderId, { 
    paymentId: payment.payment.id,
    paymentAddress: payment.payment.payment_address
  });
  
  res.json({
    paymentAddress: payment.payment.payment_address,
    amount: payment.payment.crypto_amount,
    qrCode: payment.payment.qr_code,
    expiresAt: payment.payment.expires_at
  });
});

// Webhook handler
app.post('/webhook/coinpay', createWebhookHandler({
  secret: process.env.COINPAY_WEBHOOK_SECRET,
  onEvent: async (event) => {
    if (event.type === 'payment.confirmed') {
      const { orderId } = event.data.payment.metadata;
      await db.orders.update(orderId, { status: 'paid' });
      await sendOrderConfirmationEmail(orderId);
    }
  }
}));
```

### Subscription Payments

```javascript
// Create subscription payment
const payment = await coinpay.createPayment({
  businessId: process.env.COINPAY_BUSINESS_ID,
  amount: 9.99,
  blockchain: 'USDC_MATIC',  // Stablecoin for predictable pricing
  description: 'Monthly subscription',
  metadata: {
    userId: user.id,
    subscriptionId: subscription.id,
    period: '2024-01'
  }
});
```

## Testing

For development and testing, you can:

1. Use the dashboard's "Create Test Payment" feature
2. Set a custom `baseUrl` pointing to your local development server
3. Use testnet addresses (when supported)

## Support

- Documentation: [docs.coinpayportal.com](https://docs.coinpayportal.com)
- Email: support@coinpayportal.com
- Status: [status.coinpayportal.com](https://status.coinpayportal.com)

## License

MIT