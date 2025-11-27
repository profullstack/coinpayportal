# @profullstack/coinpay

CoinPay SDK & CLI - Cryptocurrency payment integration for Node.js

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

### SDK Usage

```javascript
import { CoinPayClient } from '@profullstack/coinpay';

// Initialize the client
const coinpay = new CoinPayClient({
  apiKey: 'your-api-key',
});

// Create a payment
const payment = await coinpay.createPayment({
  businessId: 'biz_123',
  amount: 100,
  currency: 'USD',
  cryptocurrency: 'BTC',
  description: 'Order #12345',
});

console.log(`Payment address: ${payment.address}`);
console.log(`Amount: ${payment.cryptoAmount} ${payment.cryptocurrency}`);
```

### CLI Usage

```bash
# Configure your API key
coinpay config set-key sk_live_xxxxx

# Create a payment
coinpay payment create --business-id biz_123 --amount 100 --currency USD --crypto BTC

# Get payment details
coinpay payment get pay_abc123

# List payments
coinpay payment list --business-id biz_123

# Get exchange rates
coinpay rates get BTC
```

## SDK API Reference

### CoinPayClient

```javascript
import { CoinPayClient } from '@profullstack/coinpay';

const client = new CoinPayClient({
  apiKey: 'your-api-key',
  baseUrl: 'https://coinpay.dev/api', // optional
  timeout: 30000, // optional, in milliseconds
});
```

### Payments

```javascript
// Create a payment
const payment = await client.createPayment({
  businessId: 'biz_123',
  amount: 100,
  currency: 'USD',
  cryptocurrency: 'BTC',
  description: 'Order #12345',
  metadata: JSON.stringify({ orderId: '12345' }),
  callbackUrl: 'https://your-site.com/webhook',
});

// Get payment by ID
const payment = await client.getPayment('pay_abc123');

// List payments
const payments = await client.listPayments({
  businessId: 'biz_123',
  status: 'completed', // optional
  limit: 20, // optional
  offset: 0, // optional
});

// Get payment QR code
const qr = await client.getPaymentQR('pay_abc123', 'png');
```

### Exchange Rates

```javascript
// Get single rate
const rate = await client.getExchangeRate('BTC', 'USD');

// Get multiple rates
const rates = await client.getExchangeRates(['BTC', 'ETH', 'SOL'], 'USD');
```

### Businesses

```javascript
// Create a business
const business = await client.createBusiness({
  name: 'My Store',
  webhookUrl: 'https://your-site.com/webhook',
  walletAddresses: {
    BTC: 'bc1q...',
    ETH: '0x...',
  },
});

// Get business
const business = await client.getBusiness('biz_123');

// List businesses
const businesses = await client.listBusinesses();

// Update business
const updated = await client.updateBusiness('biz_123', {
  name: 'Updated Name',
});
```

### Webhooks

```javascript
// Get webhook logs
const logs = await client.getWebhookLogs('biz_123', 50);

// Test webhook
const result = await client.testWebhook('biz_123', 'payment.completed');
```

## Webhook Verification

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
    console.log('Received event:', event.type);
    
    switch (event.type) {
      case 'payment.completed':
        // Handle completed payment
        break;
      case 'payment.expired':
        // Handle expired payment
        break;
    }
  },
  onError: (error) => {
    console.error('Webhook error:', error);
  },
}));
```

## Webhook Events

| Event | Description |
|-------|-------------|
| `payment.created` | Payment was created |
| `payment.pending` | Payment is pending confirmation |
| `payment.confirming` | Payment is being confirmed |
| `payment.completed` | Payment completed successfully |
| `payment.expired` | Payment expired |
| `payment.failed` | Payment failed |
| `payment.refunded` | Payment was refunded |

## CLI Commands

### Configuration

```bash
coinpay config set-key <api-key>    # Set API key
coinpay config set-url <base-url>   # Set custom API URL
coinpay config show                  # Show current config
```

### Payments

```bash
coinpay payment create [options]
  --business-id <id>    Business ID (required)
  --amount <amount>     Amount in fiat (required)
  --currency <code>     Fiat currency (required)
  --crypto <code>       Cryptocurrency (required)
  --description <text>  Description (optional)

coinpay payment get <payment-id>
coinpay payment list --business-id <id> [--status <status>] [--limit <n>]
coinpay payment qr <payment-id> [--format png|svg]
```

### Businesses

```bash
coinpay business create --name <name> [--webhook-url <url>]
coinpay business get <business-id>
coinpay business list
coinpay business update <business-id> [--name <name>] [--webhook-url <url>]
```

### Exchange Rates

```bash
coinpay rates get <crypto> [--fiat <currency>]
coinpay rates list [--fiat <currency>]
```

### Webhooks

```bash
coinpay webhook logs <business-id> [--limit <n>]
coinpay webhook test <business-id> [--event <type>]
```

## Supported Cryptocurrencies

- **BTC** - Bitcoin
- **BCH** - Bitcoin Cash
- **ETH** - Ethereum
- **MATIC** - Polygon
- **SOL** - Solana

## Supported Fiat Currencies

- USD, EUR, GBP, CAD, AUD, and more

## Environment Variables

| Variable | Description |
|----------|-------------|
| `COINPAY_API_KEY` | API key (overrides config file) |
| `COINPAY_BASE_URL` | Custom API URL |

## Error Handling

```javascript
try {
  const payment = await client.createPayment({ ... });
} catch (error) {
  if (error.status === 401) {
    console.error('Invalid API key');
  } else if (error.status === 400) {
    console.error('Invalid request:', error.response);
  } else {
    console.error('Error:', error.message);
  }
}
```

## License

MIT