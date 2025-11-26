# CoinPayPortal API Documentation

## Base URL

```
Production: https://api.coinpayportal.com
Development: http://localhost:3000/api
```

## Authentication

All API requests require authentication using JWT tokens in the Authorization header:

```
Authorization: Bearer YOUR_JWT_TOKEN
```

Obtain tokens via the authentication endpoints.

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

Generate a new payment request.

**Endpoint:** `POST /api/payments/create`

**Headers:** `Authorization: Bearer TOKEN`

**Request Body:**
```json
{
  "business_id": "uuid",
  "amount": 100.00,
  "currency": "USD",
  "blockchain": "eth",
  "merchant_wallet_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "metadata": {
    "order_id": "ORDER-123",
    "customer_email": "customer@example.com",
    "custom_field": "any value"
  }
}
```

**Supported Blockchains:**
- `btc` - Bitcoin
- `bch` - Bitcoin Cash
- `eth` - Ethereum
- `matic` - Polygon
- `sol` - Solana
- `usdc_eth` - USDC on Ethereum
- `usdc_matic` - USDC on Polygon
- `usdc_sol` - USDC on Solana

**Response:**
```json
{
  "success": true,
  "data": {
    "payment": {
      "id": "uuid",
      "business_id": "uuid",
      "amount": 100.00,
      "currency": "USD",
      "blockchain": "eth",
      "crypto_amount": "0.0456",
      "crypto_currency": "ETH",
      "payment_address": "0x1234...5678",
      "qr_code": "data:image/png;base64,...",
      "status": "pending",
      "expires_at": "2024-01-01T01:00:00.000Z",
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  }
}
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

Get QR code for a payment.

**Endpoint:** `GET /api/payments/:id/qr`

**Headers:** `Authorization: Bearer TOKEN`

**Query Parameters:**
- `size` (optional) - QR code size in pixels (default: 300)
- `format` (optional) - `png` or `svg` (default: png)

**Response:**
```json
{
  "success": true,
  "data": {
    "qr_code": "data:image/png;base64,...",
    "payment_address": "0x1234...5678",
    "amount": "0.0456",
    "currency": "ETH"
  }
}
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

When a webhook event occurs, CoinPayPortal sends a POST request to your configured URL:

```json
{
  "event": "payment.confirmed",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "data": {
    "payment": {
      "id": "uuid",
      "business_id": "uuid",
      "amount": 100.00,
      "currency": "USD",
      "crypto_amount": "0.0456",
      "crypto_currency": "ETH",
      "status": "confirmed",
      "tx_hash": "0xabc...def",
      "confirmations": 12,
      "metadata": {
        "order_id": "ORDER-123"
      }
    }
  },
  "signature": "sha256_hmac_signature"
}
```

### Verifying Webhook Signatures

```javascript
const crypto = require('crypto');

function verifyWebhook(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  const digest = hmac.update(JSON.stringify(payload)).digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  );
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
| `INSUFFICIENT_BALANCE` | Not enough funds for operation |
| `BLOCKCHAIN_ERROR` | Blockchain interaction failed |
| `PAYMENT_EXPIRED` | Payment request has expired |
| `DUPLICATE_PAYMENT` | Payment already exists |
| `WEBHOOK_DELIVERY_FAILED` | Failed to deliver webhook |
| `INTERNAL_ERROR` | Server error |

## SDK Examples

### JavaScript/TypeScript

```typescript
import { CoinPayPortal } from '@coinpayportal/sdk';

const client = new CoinPayPortal({
  apiKey: 'your-api-key',
  environment: 'production'
});

// Create payment
const payment = await client.payments.create({
  businessId: 'uuid',
  amount: 100,
  currency: 'USD',
  blockchain: 'eth',
  merchantWalletAddress: '0x...'
});

// Listen for events
client.payments.on('confirmed', (payment) => {
  console.log('Payment confirmed:', payment.id);
});
```

### cURL

```bash
curl -X POST https://api.coinpayportal.com/api/payments/create \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "business_id": "uuid",
    "amount": 100.00,
    "currency": "USD",
    "blockchain": "eth",
    "merchant_wallet_address": "0x..."
  }'
```

## Support

For API support, contact:
- Email: api-support@coinpayportal.com
- Documentation: https://docs.coinpayportal.com
- Status Page: https://status.coinpayportal.com