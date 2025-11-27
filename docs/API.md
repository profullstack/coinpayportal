# CoinPay API Documentation

## Base URL

```
Production: https://coinpayportal.com/api
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
- `MATIC` - Polygon
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

When a webhook event occurs, CoinPay sends a POST request to your configured URL:

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

## SDK Examples

### JavaScript/TypeScript

```typescript
import { CoinPay } from '@coinpayportal/sdk';

const client = new CoinPay({
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