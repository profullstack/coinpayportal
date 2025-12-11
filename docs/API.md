# CoinPay API Documentation

## Overview

CoinPay is a cryptocurrency payment gateway that allows merchants to accept crypto payments from their customers. The typical flow is:

1. **Merchant** creates a payment request via API when customer checks out
2. **CoinPay** generates a unique payment address and QR code
3. **Customer** sends cryptocurrency to the payment address
4. **CoinPay** monitors the blockchain and sends webhook notifications
5. **Funds** are automatically forwarded to the merchant's wallet (minus fees)

## Base URL

```
Production: https://coinpayportal.com/api
Development: http://localhost:3000/api
```

## Authentication

CoinPay supports two authentication methods:

### API Key Authentication (Recommended for Merchants)

Use your business API key for server-to-server API calls. Get your API key from the business settings in your dashboard.

```
Authorization: Bearer cp_live_xxxxxxxxxxxxxxxxxxxxx
```

API keys start with `cp_live_` and are tied to a specific business. Use this method when:
- Creating payments from your backend
- Checking payment status
- Managing webhooks programmatically

### JWT Token Authentication (Dashboard Access)

JWT tokens are used for dashboard/UI access after logging in. Obtain tokens via the login endpoint.

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

Use this method when:
- Building custom dashboard interfaces
- Managing multiple businesses
- Accessing merchant-level settings

## Rate Limiting

- 100 requests per minute per IP address
- 1000 requests per hour per authenticated user
- Rate limit headers included in responses:
  - `X-RateLimit-Limit`
  - `X-RateLimit-Remaining`
  - `X-RateLimit-Reset`

## Response Format

All responses follow this structure:

```json
{
  "success": true,
  "data": { ... },
  "error": null,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

Error responses:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": { ... }
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Authentication Endpoints

### Register Merchant

Create a new merchant account.

**Endpoint:** `POST /api/auth/register`

**Request Body:**
```json
{
  "email": "merchant@example.com",
  "password": "SecurePassword123!",
  "name": "John Doe"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "merchant": {
      "id": "uuid",
      "email": "merchant@example.com",
      "created_at": "2024-01-01T00:00:00.000Z"
    },
    "token": "jwt_token_here"
  }
}
```

### Login

Authenticate and receive JWT token.

**Endpoint:** `POST /api/auth/login`

**Request Body:**
```json
{
  "email": "merchant@example.com",
  "password": "SecurePassword123!"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "jwt_token_here",
    "merchant": {
      "id": "uuid",
      "email": "merchant@example.com"
    }
  }
}
```

### Logout

Invalidate current session.

**Endpoint:** `POST /api/auth/logout`

**Headers:** `Authorization: Bearer TOKEN`

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Logged out successfully"
  }
}
```

## Business Management Endpoints

### List Businesses

Get all businesses for authenticated merchant.

**Endpoint:** `GET /api/businesses`

**Headers:** `Authorization: Bearer TOKEN`

**Response:**
```json
{
  "success": true,
  "data": {
    "businesses": [
      {
        "id": "uuid",
        "merchant_id": "uuid",
        "name": "My Online Store",
        "description": "E-commerce store",
        "webhook_url": "https://mystore.com/webhook",
        "created_at": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

### Create Business

Create a new business under merchant account.

**Endpoint:** `POST /api/businesses`

**Headers:** `Authorization: Bearer TOKEN`

**Request Body:**
```json
{
  "name": "My Online Store",
  "description": "E-commerce store selling widgets",
  "webhook_url": "https://mystore.com/webhook",
  "webhook_secret": "optional_secret_for_signing"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "business": {
      "id": "uuid",
      "merchant_id": "uuid",
      "name": "My Online Store",
      "description": "E-commerce store selling widgets",
      "webhook_url": "https://mystore.com/webhook",
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

### Get Business

Get details of a specific business.

**Endpoint:** `GET /api/businesses/:id`

**Headers:** `Authorization: Bearer TOKEN`

**Response:**
```json
{
  "success": true,
  "data": {
    "business": {
      "id": "uuid",
      "name": "My Online Store",
      "description": "E-commerce store",
      "webhook_url": "https://mystore.com/webhook",
      "stats": {
        "total_payments": 150,
        "total_volume": "15000.00",
        "pending_payments": 3
      }
    }
  }
}
```

### Update Business

Update business details.

**Endpoint:** `PATCH /api/businesses/:id`

**Headers:** `Authorization: Bearer TOKEN`

**Request Body:**
```json
{
  "name": "Updated Store Name",
  "webhook_url": "https://newurl.com/webhook"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "business": {
      "id": "uuid",
      "name": "Updated Store Name",
      "webhook_url": "https://newurl.com/webhook",
      "updated_at": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

### Delete Business

Delete a business (soft delete).

**Endpoint:** `DELETE /api/businesses/:id`

**Headers:** `Authorization: Bearer TOKEN`

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Business deleted successfully"
  }
}
```

## Payment Endpoints

### Create Payment

Generate a new payment request. This is the primary endpoint merchants use to accept crypto payments.

**Endpoint:** `POST /api/payments/create`

**Headers:** `Authorization: Bearer cp_live_your_api_key`

**Request Body:**
```json
{
  "business_id": "your-business-uuid",
  "amount": 100.00,
  "currency": "USD",
  "blockchain": "ETH",
  "description": "Order #12345",
  "metadata": {
    "order_id": "ORDER-123",
    "customer_email": "customer@example.com",
    "custom_field": "any value"
  }
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `business_id` | string | Yes | Your business UUID from the dashboard |
| `amount` | number | Yes | Amount in fiat currency (e.g., 100.00) |
| `currency` | string | No | Fiat currency code (default: "USD") |
| `blockchain` | string | Yes | Blockchain/cryptocurrency to accept |
| `description` | string | No | Description shown to customer |
| `metadata` | object | No | Custom data for your records |

**Supported Blockchains:**

| Code | Name | Description |
|------|------|-------------|
| `BTC` | Bitcoin | Native Bitcoin payments |
| `BCH` | Bitcoin Cash | Bitcoin Cash payments |
| `ETH` | Ethereum | Native Ether payments |
| `POL` | Polygon | Native POL payments |
| `SOL` | Solana | Native SOL payments |
| `USDC_ETH` | USDC (Ethereum) | USDC stablecoin on Ethereum |
| `USDC_POL` | USDC (Polygon) | USDC stablecoin on Polygon |
| `USDC_SOL` | USDC (Solana) | USDC stablecoin on Solana |

**Response:**
```json
{
  "success": true,
  "payment": {
    "id": "pay_abc123",
    "business_id": "biz_xyz789",
    "amount": 100.00,
    "currency": "USD",
    "blockchain": "ETH",
    "crypto_amount": "0.0456",
    "payment_address": "0x1234567890abcdef...",
    "qr_code": "data:image/png;base64,...",
    "status": "pending",
    "expires_at": "2024-01-01T01:00:00.000Z",
    "created_at": "2024-01-01T00:00:00.000Z",
    "metadata": {
      "order_id": "ORDER-123"
    }
  },
  "usage": {
    "current": 45,
    "limit": 100,
    "remaining": 55
  }
}
```

**Example - cURL:**
```bash
curl -X POST https://coinpayportal.com/api/payments/create \
  -H "Authorization: Bearer cp_live_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "business_id": "your-business-id",
    "amount": 50.00,
    "blockchain": "BTC",
    "description": "Premium subscription"
  }'
```

**Example - JavaScript (fetch):**
```javascript
const response = await fetch('https://coinpayportal.com/api/payments/create', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer cp_live_your_api_key',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    business_id: 'your-business-id',
    amount: 50.00,
    blockchain: 'BTC',
    description: 'Premium subscription',
    metadata: { orderId: '12345' }
  }),
});

const data = await response.json();
// Display payment.payment_address and payment.qr_code to customer
```

**Example - Node.js SDK:**
```javascript
import { CoinPayClient } from '@profullstack/coinpay';

const client = new CoinPayClient({ apiKey: 'cp_live_your_api_key' });

const payment = await client.createPayment({
  businessId: 'your-business-id',
  amount: 50.00,
  blockchain: 'BTC',
  description: 'Premium subscription',
  metadata: { orderId: '12345' }
});
```

### Get Payment Status

Check the status of a payment.

**Endpoint:** `GET /api/payments/:id`

**Headers:** `Authorization: Bearer TOKEN`

**Response:**
```json
{
  "success": true,
  "data": {
    "payment": {
      "id": "uuid",
      "status": "confirmed",
      "amount": 100.00,
      "currency": "USD",
      "crypto_amount": "0.0456",
      "crypto_currency": "ETH",
      "payment_address": "0x1234...5678",
      "confirmations": 12,
      "tx_hash": "0xabc...def",
      "customer_paid_amount": "0.0456",
      "merchant_received_amount": "0.0447",
      "fee_amount": "0.0009",
      "forward_tx_hash": "0x123...789",
      "created_at": "2024-01-01T00:00:00.000Z",
      "confirmed_at": "2024-01-01T00:15:00.000Z",
      "forwarded_at": "2024-01-01T00:20:00.000Z"
    }
  }
}
```

**Payment Statuses:**
- `pending` - Waiting for payment
- `detected` - Payment detected, waiting for confirmations
- `confirmed` - Payment confirmed on blockchain
- `forwarding` - Forwarding to merchant wallet
- `forwarded` - Successfully forwarded to merchant
- `failed` - Payment failed
- `expired` - Payment request expired

### List Payments

Get paginated list of payments for a business.

**Endpoint:** `GET /api/payments?business_id=uuid&page=1&limit=20&status=confirmed`

**Headers:** `Authorization: Bearer TOKEN`

**Query Parameters:**
- `business_id` (required) - Business UUID
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Items per page (default: 20, max: 100)
- `status` (optional) - Filter by status
- `blockchain` (optional) - Filter by blockchain
- `from_date` (optional) - ISO date string
- `to_date` (optional) - ISO date string

**Response:**
```json
{
  "success": true,
  "data": {
    "payments": [...],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 150,
      "pages": 8
    }
  }
}
```

### Get Payment QR Code

Get QR code image for a payment. Returns binary PNG image data.

**Endpoint:** `GET /api/payments/:id/qr`

**Headers:** `Authorization: Bearer TOKEN` (optional for public payments)

**Response:** Binary PNG image data

**Content-Type:** `image/png`

**Usage Examples:**

**HTML (direct use as image source):**
```html
<img src="https://coinpayportal.com/api/payments/pay_abc123/qr" alt="Payment QR Code" />
```

**JavaScript (fetch as blob):**
```javascript
const response = await fetch('https://coinpayportal.com/api/payments/pay_abc123/qr', {
  headers: {
    'Authorization': 'Bearer cp_live_your_api_key'
  }
});
const blob = await response.blob();
const imageUrl = URL.createObjectURL(blob);
document.getElementById('qr-image').src = imageUrl;
```

**cURL (save to file):**
```bash
curl -o payment-qr.png \
  -H "Authorization: Bearer cp_live_your_api_key" \
  https://coinpayportal.com/api/payments/pay_abc123/qr
```

**Node.js SDK:**
```javascript
// Get QR code URL for use in HTML
const qrUrl = client.getPaymentQRUrl('pay_abc123');
// Returns: "https://coinpayportal.com/api/payments/pay_abc123/qr"

// Get QR code as binary data
const imageData = await client.getPaymentQR('pay_abc123');
// Save to file
import fs from 'fs';
fs.writeFileSync('qr.png', Buffer.from(imageData));
```

## Exchange Rate Endpoints

### Get Exchange Rates

Get current crypto to fiat exchange rates.

**Endpoint:** `GET /api/rates`

**Query Parameters:**
- `from` (required) - Crypto currency (BTC, ETH, etc.)
- `to` (optional) - Fiat currency (default: USD)

**Response:**
```json
{
  "success": true,
  "data": {
    "from": "ETH",
    "to": "USD",
    "rate": 2193.45,
    "timestamp": "2024-01-01T00:00:00.000Z",
    "source": "tatum"
  }
}
```

### Get Multiple Rates

Get rates for multiple currencies at once.

**Endpoint:** `POST /api/rates/batch`

**Request Body:**
```json
{
  "pairs": [
    { "from": "BTC", "to": "USD" },
    { "from": "ETH", "to": "USD" },
    { "from": "SOL", "to": "USD" }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "rates": [
      { "from": "BTC", "to": "USD", "rate": 43250.00 },
      { "from": "ETH", "to": "USD", "rate": 2193.45 },
      { "from": "SOL", "to": "USD", "rate": 98.75 }
    ],
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

## Business Collection Endpoints

Business Collection payments allow the platform to collect payments from business users (subscription fees, service charges, etc.) with 100% forwarding to platform wallets.

### Create Business Collection Payment

Create a new payment that forwards 100% of funds to the platform's collection wallet.

**Endpoint:** `POST /api/business-collection`

**Headers:** `Authorization: Bearer TOKEN`

**Request Body:**
```json
{
  "business_id": "uuid",
  "amount": 99.99,
  "currency": "USD",
  "blockchain": "ETH",
  "description": "Monthly subscription fee",
  "metadata": {
    "plan": "premium",
    "billing_period": "2024-01"
  }
}
```

**Supported Blockchains:**
- `BTC` - Bitcoin
- `BCH` - Bitcoin Cash
- `ETH` - Ethereum
- `POL` - Polygon
- `SOL` - Solana

**Response:**
```json
{
  "success": true,
  "payment": {
    "id": "uuid",
    "payment_address": "0x1234...5678",
    "amount": 99.99,
    "currency": "USD",
    "blockchain": "ETH",
    "destination_wallet": "0xplatform...wallet",
    "status": "pending",
    "description": "Monthly subscription fee",
    "expires_at": "2024-01-02T00:00:00.000Z",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

### List Business Collection Payments

Get paginated list of business collection payments.

**Endpoint:** `GET /api/business-collection`

**Headers:** `Authorization: Bearer TOKEN`

**Query Parameters:**
- `business_id` (optional) - Filter by business UUID
- `status` (optional) - Filter by status (pending, confirmed, forwarded, etc.)
- `limit` (optional) - Items per page (default: 50)
- `offset` (optional) - Pagination offset (default: 0)

**Response:**
```json
{
  "success": true,
  "payments": [
    {
      "id": "uuid",
      "business_id": "uuid",
      "payment_address": "0x1234...5678",
      "amount": 99.99,
      "currency": "USD",
      "blockchain": "ETH",
      "destination_wallet": "0xplatform...wallet",
      "status": "forwarded",
      "description": "Monthly subscription fee",
      "expires_at": "2024-01-02T00:00:00.000Z",
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  ],
  "total": 25
}
```

### Get Business Collection Payment

Get details of a specific business collection payment.

**Endpoint:** `GET /api/business-collection/:id`

**Headers:** `Authorization: Bearer TOKEN`

**Response:**
```json
{
  "success": true,
  "payment": {
    "id": "uuid",
    "business_id": "uuid",
    "payment_address": "0x1234...5678",
    "amount": 99.99,
    "currency": "USD",
    "blockchain": "ETH",
    "destination_wallet": "0xplatform...wallet",
    "status": "forwarded",
    "description": "Monthly subscription fee",
    "metadata": {
      "plan": "premium",
      "billing_period": "2024-01"
    },
    "expires_at": "2024-01-02T00:00:00.000Z",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

**Business Collection Payment Statuses:**
- `pending` - Waiting for payment
- `detected` - Payment detected on blockchain
- `confirming` - Waiting for required confirmations
- `confirmed` - Payment confirmed
- `forwarding` - Forwarding to platform wallet
- `forwarded` - Successfully forwarded (100% to platform)
- `forwarding_failed` - Forwarding failed (will retry)
- `expired` - Payment request expired
- `cancelled` - Payment cancelled

### Business Collection vs Regular Payments

| Feature | Regular Payments | Business Collection |
|---------|-----------------|---------------------|
| Forward Split | 99.5% merchant / 0.5% platform | 100% platform |
| Destination | Merchant wallet | Platform wallet from .env |
| Use Case | Customer payments | Business fees/subscriptions |
| Webhook Event | `payment.forwarded` | `business_collection.forwarded` |

## Webhook Endpoints

### Configure Webhook

Set or update webhook URL for a business.

**Endpoint:** `POST /api/webhooks`

**Headers:** `Authorization: Bearer TOKEN`

**Request Body:**
```json
{
  "business_id": "uuid",
  "url": "https://mystore.com/webhook",
  "secret": "optional_signing_secret",
  "events": ["payment.confirmed", "payment.forwarded"]
}
```

**Available Events:**
- `payment.created`
- `payment.detected`
- `payment.confirmed`
- `payment.forwarding`
- `payment.forwarded`
- `payment.failed`
- `payment.expired`

**Response:**
```json
{
  "success": true,
  "data": {
    "webhook": {
      "id": "uuid",
      "business_id": "uuid",
      "url": "https://mystore.com/webhook",
      "events": ["payment.confirmed", "payment.forwarded"],
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

### Test Webhook

Send a test webhook to verify configuration.

**Endpoint:** `POST /api/webhooks/test`

**Headers:** `Authorization: Bearer TOKEN`

**Request Body:**
```json
{
  "business_id": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "delivered",
    "response_code": 200,
    "response_time_ms": 145
  }
}
```

### Get Webhook Logs

View webhook delivery logs.

**Endpoint:** `GET /api/webhooks/logs?business_id=uuid&page=1&limit=20`

**Headers:** `Authorization: Bearer TOKEN`

**Response:**
```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "id": "uuid",
        "payment_id": "uuid",
        "url": "https://mystore.com/webhook",
        "event": "payment.confirmed",
        "status_code": 200,
        "attempt": 1,
        "created_at": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 50
    }
  }
}
```

## Webhook Payload Format

When a webhook event occurs, CoinPay sends a POST request to your configured URL with the following structure:

### Headers

```
Content-Type: application/json
X-CoinPay-Signature: t=1702234567,v1=5d41402abc4b2a76b9719d911017c592
User-Agent: CoinPay-Webhook/1.0
```

The `X-CoinPay-Signature` header contains:
- `t` - Unix timestamp when the signature was generated
- `v1` - HMAC-SHA256 signature of `{timestamp}.{payload}`

### Payload Structure

```json
{
  "id": "evt_abc123def456",
  "type": "payment.confirmed",
  "data": {
    "payment_id": "pay_xyz789",
    "amount_crypto": "0.0456",
    "amount_usd": "100.00",
    "currency": "ETH",
    "status": "confirmed",
    "confirmations": 12,
    "tx_hash": "0xabc...def",
    "metadata": {
      "order_id": "ORDER-123"
    }
  },
  "created_at": "2024-01-01T00:00:00.000Z",
  "business_id": "biz_xyz789"
}
```

### Webhook Event Types

| Event | Description |
|-------|-------------|
| `payment.detected` | Payment detected on blockchain (unconfirmed) |
| `payment.confirmed` | Payment confirmed with required confirmations |
| `payment.forwarded` | Funds forwarded to merchant wallet |
| `payment.failed` | Payment failed |
| `payment.expired` | Payment request expired |
| `test.webhook` | Test webhook (sent from dashboard) |

### Verifying Webhook Signatures

The signature is computed as `HMAC-SHA256(timestamp.payload, secret)` where:
- `timestamp` is the Unix timestamp from the `t=` part of the signature header
- `payload` is the raw JSON body as a string
- `secret` is your webhook secret

**JavaScript Example:**
```javascript
import crypto from 'crypto';

function verifyWebhookSignature(payload, signatureHeader, secret, tolerance = 300) {
  // Parse signature header (format: t=timestamp,v1=signature)
  const parts = signatureHeader.split(',');
  const signatureParts = {};
  
  for (const part of parts) {
    const [key, value] = part.split('=');
    signatureParts[key] = value;
  }

  const timestamp = signatureParts.t;
  const expectedSignature = signatureParts.v1;

  if (!timestamp || !expectedSignature) {
    return false;
  }

  // Check timestamp tolerance (prevent replay attacks)
  const timestampAge = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (Math.abs(timestampAge) > tolerance) {
    return false;
  }

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const computedSignature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  // Timing-safe comparison
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const computedBuffer = Buffer.from(computedSignature, 'hex');

  if (expectedBuffer.length !== computedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, computedBuffer);
}

// Usage in Express/Node.js
app.post('/webhooks/coinpay', express.raw({ type: 'application/json' }), (req, res) => {
  const payload = req.body.toString();
  const signature = req.headers['x-coinpay-signature'];
  
  if (!verifyWebhookSignature(payload, signature, process.env.COINPAY_WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  const event = JSON.parse(payload);
  // Handle event...
  
  res.json({ received: true });
});
```

**Using the SDK:**
```javascript
import { verifyWebhookSignature, parseWebhookPayload } from '@profullstack/coinpay';

app.post('/webhooks/coinpay', express.raw({ type: 'application/json' }), (req, res) => {
  const payload = req.body.toString();
  const signature = req.headers['x-coinpay-signature'];
  
  const isValid = verifyWebhookSignature({
    payload,
    signature,
    secret: process.env.COINPAY_WEBHOOK_SECRET
  });
  
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  const event = parseWebhookPayload(payload);
  
  switch (event.type) {
    case 'payment.confirmed':
      // Handle confirmed payment
      console.log('Payment confirmed:', event.data.payment_id);
      break;
    case 'payment.forwarded':
      // Funds received in your wallet
      break;
  }
  
  res.json({ received: true });
});
```

## Subscription & Entitlements Endpoints

### Get Subscription Plans

Get all available subscription plans (public endpoint, no authentication required).

**Endpoint:** `GET /api/subscription-plans`

**Response:**
```json
{
  "success": true,
  "plans": [
    {
      "id": "starter",
      "name": "Starter",
      "description": "Perfect for testing and small projects",
      "pricing": {
        "monthly": 0,
        "yearly": 0
      },
      "limits": {
        "monthly_transactions": 100,
        "is_unlimited": false
      },
      "features": {
        "all_chains_supported": true,
        "basic_api_access": true,
        "advanced_analytics": false,
        "custom_webhooks": false,
        "white_label": false,
        "priority_support": false
      }
    },
    {
      "id": "professional",
      "name": "Professional",
      "description": "For growing businesses",
      "pricing": {
        "monthly": 49,
        "yearly": 490
      },
      "limits": {
        "monthly_transactions": null,
        "is_unlimited": true
      },
      "features": {
        "all_chains_supported": true,
        "basic_api_access": true,
        "advanced_analytics": true,
        "custom_webhooks": true,
        "white_label": true,
        "priority_support": true
      }
    }
  ]
}
```

### Get Current Entitlements

Get the authenticated merchant's current subscription, features, and usage.

**Endpoint:** `GET /api/entitlements`

**Headers:** `Authorization: Bearer TOKEN`

**Response:**
```json
{
  "success": true,
  "entitlements": {
    "plan": {
      "id": "starter",
      "name": "Starter",
      "description": "Perfect for testing and small projects",
      "price_monthly": 0
    },
    "features": {
      "all_chains_supported": true,
      "basic_api_access": true,
      "advanced_analytics": false,
      "custom_webhooks": false,
      "white_label": false,
      "priority_support": false
    },
    "usage": {
      "transactions_this_month": 45,
      "transaction_limit": 100,
      "transactions_remaining": 55,
      "is_unlimited": false
    },
    "status": "active"
  }
}
```

### Subscription Plan Comparison

| Feature | Starter (Free) | Professional ($49/month) |
|---------|----------------|--------------------------|
| Monthly Transactions | Up to 100 | Unlimited |
| All Supported Chains | ✅ | ✅ |
| Basic API Access | ✅ | ✅ |
| Advanced Analytics | ❌ | ✅ |
| Custom Webhooks | ❌ | ✅ |
| White-label Option | ❌ | ✅ |
| Priority Support | ❌ | ✅ |

### Entitlement Error Responses

When a request is blocked due to entitlement limits, the API returns specific error codes:

**Transaction Limit Exceeded (429 Too Many Requests):**
```json
{
  "error": "Monthly transaction limit reached (100/100). Please upgrade to Professional for unlimited transactions.",
  "code": "TRANSACTION_LIMIT_EXCEEDED",
  "details": {
    "currentUsage": 100,
    "limit": 100
  }
}
```

**Feature Not Available (403 Forbidden):**
```json
{
  "error": "Advanced Analytics is not available on your current plan. Please upgrade to Professional to access this feature.",
  "code": "FEATURE_NOT_AVAILABLE",
  "details": {
    "feature": "advanced_analytics",
    "currentPlan": "starter"
  }
}
```

**Subscription Inactive (402 Payment Required):**
```json
{
  "error": "Subscription is past_due. Please update your payment method or reactivate your subscription.",
  "code": "SUBSCRIPTION_INACTIVE",
  "details": {
    "status": "past_due"
  }
}
```

## Error Codes

| Code | Description |
|------|-------------|
| `UNAUTHORIZED` | Invalid or missing authentication token |
| `FORBIDDEN` | Insufficient permissions |
| `NOT_FOUND` | Resource not found |
| `VALIDATION_ERROR` | Invalid request parameters |
| `RATE_LIMIT_EXCEEDED` | Too many requests |
| `TRANSACTION_LIMIT_EXCEEDED` | Monthly transaction limit reached |
| `FEATURE_NOT_AVAILABLE` | Feature not available on current plan |
| `SUBSCRIPTION_INACTIVE` | Subscription is not active |
| `INSUFFICIENT_BALANCE` | Not enough funds for operation |
| `BLOCKCHAIN_ERROR` | Blockchain interaction failed |
| `PAYMENT_EXPIRED` | Payment request has expired |
| `DUPLICATE_PAYMENT` | Payment already exists |
| `WEBHOOK_DELIVERY_FAILED` | Failed to deliver webhook |
| `INTERNAL_ERROR` | Server error |

## Integration Examples

### E-commerce Checkout Flow

Here's a complete example of integrating CoinPay into an e-commerce checkout:

**1. Backend: Create Payment Endpoint**
```javascript
// routes/checkout.js
import { CoinPayClient } from '@profullstack/coinpay';

const coinpay = new CoinPayClient({
  apiKey: process.env.COINPAY_API_KEY,
});

app.post('/api/checkout/crypto', async (req, res) => {
  const { orderId, blockchain } = req.body;
  
  // Get order from your database
  const order = await db.orders.findById(orderId);
  
  // Create CoinPay payment
  const payment = await coinpay.createPayment({
    businessId: process.env.COINPAY_BUSINESS_ID,
    amount: order.total,
    currency: 'USD',
    blockchain,
    description: `Order #${order.id}`,
    metadata: {
      orderId: order.id,
      customerEmail: order.customerEmail
    }
  });
  
  // Save payment reference
  await db.orders.update(orderId, {
    cryptoPaymentId: payment.payment.id,
    cryptoAddress: payment.payment.payment_address
  });
  
  res.json({
    paymentAddress: payment.payment.payment_address,
    cryptoAmount: payment.payment.crypto_amount,
    blockchain: payment.payment.blockchain,
    qrCode: payment.payment.qr_code,
    expiresAt: payment.payment.expires_at
  });
});
```

**2. Frontend: Display Payment**
```javascript
// components/CryptoPayment.jsx
function CryptoPayment({ orderId, blockchain }) {
  const [payment, setPayment] = useState(null);
  
  useEffect(() => {
    fetch('/api/checkout/crypto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, blockchain })
    })
    .then(res => res.json())
    .then(setPayment);
  }, [orderId, blockchain]);
  
  if (!payment) return <div>Loading...</div>;
  
  return (
    <div>
      <h2>Send {payment.cryptoAmount} {payment.blockchain}</h2>
      <img src={payment.qrCode} alt="Payment QR Code" />
      <p>Address: {payment.paymentAddress}</p>
      <p>Expires: {new Date(payment.expiresAt).toLocaleString()}</p>
    </div>
  );
}
```

**3. Webhook Handler**
```javascript
// routes/webhooks.js
import express from 'express';
import { verifyWebhookSignature, parseWebhookPayload } from '@profullstack/coinpay';

// Important: Use express.raw() to get the raw body for signature verification
app.post('/webhooks/coinpay', express.raw({ type: 'application/json' }), async (req, res) => {
  const payload = req.body.toString();
  const signature = req.headers['x-coinpay-signature'];
  
  // Verify signature
  const isValid = verifyWebhookSignature({
    payload,
    signature,
    secret: process.env.COINPAY_WEBHOOK_SECRET
  });
  
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // Parse the webhook payload
  const event = parseWebhookPayload(payload);
  // event = { id, type, data, createdAt, businessId }
  
  switch (event.type) {
    case 'payment.confirmed':
      // Payment confirmed - fulfill order
      const { metadata } = event.data;
      await db.orders.update(metadata.orderId, { status: 'paid' });
      await sendOrderConfirmationEmail(metadata.orderId);
      break;
      
    case 'payment.forwarded':
      // Funds received in your wallet
      await db.orders.update(event.data.metadata.orderId, {
        fundsReceived: true
      });
      break;
      
    case 'payment.expired':
      // Payment expired - notify customer
      await sendPaymentExpiredEmail(event.data.metadata.orderId);
      break;
  }
  
  res.json({ received: true });
});
```

### cURL Examples

**Create a Bitcoin payment:**
```bash
curl -X POST https://coinpayportal.com/api/payments/create \
  -H "Authorization: Bearer cp_live_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "business_id": "your-business-id",
    "amount": 99.99,
    "blockchain": "BTC",
    "description": "Order #12345",
    "metadata": {"orderId": "12345"}
  }'
```

**Create a USDC payment on Polygon:**
```bash
curl -X POST https://coinpayportal.com/api/payments/create \
  -H "Authorization: Bearer cp_live_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "business_id": "your-business-id",
    "amount": 50.00,
    "blockchain": "USDC_POL",
    "description": "Monthly subscription"
  }'
```

**Check payment status:**
```bash
curl https://coinpayportal.com/api/payments/pay_abc123 \
  -H "Authorization: Bearer cp_live_your_api_key"
```

### CLI Examples

```bash
# Configure API key (one-time)
coinpay config set-key cp_live_your_api_key

# Create a payment
coinpay payment create \
  --business-id your-business-id \
  --amount 100 \
  --blockchain ETH \
  --description "Test payment"

# Check payment status
coinpay payment get pay_abc123

# List recent payments
coinpay payment list --business-id your-business-id --limit 10
```

## Support

For API support, contact:
- Email: api-support@coinpayportal.com
- Documentation: https://docs.coinpayportal.com
- Status Page: https://status.coinpayportal.com