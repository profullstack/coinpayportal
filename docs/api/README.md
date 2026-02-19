# CoinPay API Reference

Complete reference for the CoinPay REST API. All endpoints return JSON. Authenticate with either a **JWT token** (dashboard) or **API key** (server-to-server).

**Base URL:** `https://coinpayportal.com/api`

---

## Table of Contents

- [Authentication](#authentication)
- [Merchant Auth Endpoints](#merchant-auth-endpoints)
- [Business Management](#business-management)
- [Wallet Management](#wallet-management)
- [Payments](#payments)
- [Webhooks](#webhooks)
- [Fees & Rates](#fees--rates)
- [Subscriptions & Entitlements](#subscriptions--entitlements)
- [Dashboard & Settings](#dashboard--settings)
- [Monitoring](#monitoring)
- [Web Wallet API](#web-wallet-api)
- [Error Codes](#error-codes)

---

## Authentication

### JWT Token (Dashboard/UI)

Obtain a JWT via `POST /api/auth/login`. Pass it on every request:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### API Key (Server-to-Server)

Get your API key from the business settings page. Keys start with `cp_live_`:

```
Authorization: Bearer cp_live_xxxxxxxxxxxxxxxxxxxxx
```

API keys are scoped to a single business. Use JWT tokens when managing multiple businesses.

---

## Merchant Auth Endpoints

### POST /api/auth/register

Create a new merchant account.

**Auth required:** No

**Request:**
```json
{
  "email": "merchant@example.com",
  "password": "SecurePassword123!",
  "name": "John Doe"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `email` | string | ✅ | Valid email address |
| `password` | string | ✅ | Minimum 8 characters |
| `name` | string | ❌ | Display name |

**Response (201):**
```json
{
  "success": true,
  "merchant": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "merchant@example.com",
    "name": "John Doe",
    "created_at": "2025-01-15T10:30:00.000Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Errors:**
| Status | Error | When |
|--------|-------|------|
| 400 | Validation error | Invalid email or short password |
| 400 | Email already registered | Duplicate email |

---

### POST /api/auth/login

Authenticate and receive a JWT token.

**Auth required:** No

**Request:**
```json
{
  "email": "merchant@example.com",
  "password": "SecurePassword123!"
}
```

**Response (200):**
```json
{
  "success": true,
  "merchant": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "merchant@example.com"
  },
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Errors:**
| Status | Error | When |
|--------|-------|------|
| 401 | Invalid credentials | Wrong email or password |

---

### POST /api/auth/logout

Logout the current session. Clears auth cookies.

**Auth required:** No (clears cookies regardless)

**Response (200):**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

### GET /api/auth/me

Get the currently authenticated merchant.

**Auth required:** Yes (JWT)

**Response (200):**
```json
{
  "success": true,
  "merchant": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "merchant@example.com",
    "name": "John Doe",
    "created_at": "2025-01-15T10:30:00.000Z"
  }
}
```

---

## Business Management

### GET /api/businesses

List all businesses for the authenticated merchant.

**Auth required:** Yes (JWT)

**Response (200):**
```json
{
  "success": true,
  "businesses": [
    {
      "id": "biz_123",
      "merchant_id": "550e8400...",
      "name": "My Online Store",
      "description": "E-commerce store",
      "webhook_url": "https://mystore.com/webhooks/coinpay",
      "active": true,
      "created_at": "2025-01-15T10:30:00.000Z"
    }
  ]
}
```

---

### POST /api/businesses

Create a new business.

**Auth required:** Yes (JWT)

**Request:**
```json
{
  "name": "My Online Store",
  "description": "E-commerce store accepting crypto",
  "webhook_url": "https://mystore.com/webhooks/coinpay"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | ✅ | Business display name |
| `description` | string | ❌ | Description |
| `webhook_url` | string | ❌ | URL for webhook notifications |

**Response (201):**
```json
{
  "success": true,
  "business": {
    "id": "biz_123",
    "name": "My Online Store",
    "api_key": "cp_live_xxxxxxxxxxxxxxxxxxxxx",
    "webhook_secret": "whsec_xxxxxxxxxxxxxxxxxxxxx",
    "created_at": "2025-01-15T10:30:00.000Z"
  }
}
```

> ⚠️ The `api_key` and `webhook_secret` are only shown once at creation. Store them securely.

---

### GET /api/businesses/:id

Get a specific business.

**Auth required:** Yes (JWT)

**Response (200):**
```json
{
  "success": true,
  "business": {
    "id": "biz_123",
    "merchant_id": "550e8400...",
    "name": "My Online Store",
    "webhook_url": "https://mystore.com/webhooks/coinpay",
    "active": true,
    "created_at": "2025-01-15T10:30:00.000Z"
  }
}
```

---

### PATCH /api/businesses/:id

Update a business.

**Auth required:** Yes (JWT)

**Request:**
```json
{
  "name": "Updated Store Name",
  "webhook_url": "https://newurl.com/webhooks"
}
```

All fields are optional — only include fields you want to change.

---

### DELETE /api/businesses/:id

Delete a business. This is permanent and cascades to all associated payments and wallets.

**Auth required:** Yes (JWT)

**Response (200):**
```json
{
  "success": true,
  "message": "Business deleted"
}
```

---

### POST /api/businesses/:id/api-key

Regenerate the API key for a business. Invalidates the previous key immediately.

**Auth required:** Yes (JWT)

**Response (200):**
```json
{
  "success": true,
  "api_key": "cp_live_new_key_here"
}
```

---

### GET /api/businesses/:id/webhook-secret

Get the webhook secret for a business.

**Auth required:** Yes (JWT)

**Response (200):**
```json
{
  "success": true,
  "webhook_secret": "whsec_xxxxxxxxxxxxxxxxxxxxx"
}
```

---

### POST /api/businesses/:id/webhook-secret

Regenerate the webhook signing secret.

**Auth required:** Yes (JWT)

**Response (200):**
```json
{
  "success": true,
  "webhook_secret": "whsec_new_secret_here"
}
```

---

### POST /api/businesses/:id/webhook-test

Send a test webhook to your configured URL.

**Auth required:** Yes (JWT)

**Request:**
```json
{
  "event_type": "payment.confirmed"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Test webhook sent",
  "response_status": 200
}
```

---

## Wallet Management

### GET /api/businesses/:id/wallets

List all wallet addresses configured for a business.

**Auth required:** Yes (JWT)

**Response (200):**
```json
{
  "success": true,
  "wallets": [
    {
      "cryptocurrency": "BTC",
      "wallet_address": "bc1q...",
      "is_active": true,
      "created_at": "2025-01-15T10:30:00.000Z"
    },
    {
      "cryptocurrency": "ETH",
      "wallet_address": "0x...",
      "is_active": true,
      "created_at": "2025-01-15T10:30:00.000Z"
    }
  ]
}
```

---

### POST /api/businesses/:id/wallets

Add a wallet address to a business. This is the address where customer payments are forwarded.

**Auth required:** Yes (JWT)

**Request:**
```json
{
  "cryptocurrency": "BTC",
  "wallet_address": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"
}
```

| Field | Type | Required | Values |
|-------|------|----------|--------|
| `cryptocurrency` | string | ✅ | `BTC`, `BCH`, `ETH`, `POL`, `SOL`, `DOGE`, `XRP`, `ADA`, `BNB`, `USDT`, `USDC` |
| `wallet_address` | string | ✅ | Valid address for the chain |

**Response (201):**
```json
{
  "success": true,
  "wallet": {
    "cryptocurrency": "BTC",
    "wallet_address": "bc1q...",
    "is_active": true
  }
}
```

---

### GET /api/businesses/:id/wallets/:cryptocurrency

Get a specific wallet by cryptocurrency.

**Auth required:** Yes (JWT)

---

### PATCH /api/businesses/:id/wallets/:cryptocurrency

Update a wallet address.

**Auth required:** Yes (JWT)

**Request:**
```json
{
  "wallet_address": "bc1q_new_address_here",
  "is_active": true
}
```

---

### DELETE /api/businesses/:id/wallets/:cryptocurrency

Remove a wallet from a business. Existing pending payments for this chain will fail.

**Auth required:** Yes (JWT)

---

### POST /api/businesses/:id/wallets/import

Import global merchant wallets into this business. Copies all wallets configured at the merchant level.

**Auth required:** Yes (JWT)

**Request:**
```json
{
  "cryptocurrencies": ["BTC", "ETH"],
  "all": false
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `cryptocurrencies` | string[] | ❌ | Specific chains to import |
| `all` | boolean | ❌ | Import all global wallets |

If neither field is provided, imports all active global wallets.

---

### GET /api/wallets

List global merchant wallets (not tied to a specific business).

**Auth required:** Yes (JWT)

---

### POST /api/wallets

Create a global merchant wallet.

**Auth required:** Yes (JWT)

---

### GET /api/wallets/:cryptocurrency

Get a specific global wallet.

**Auth required:** Yes (JWT)

---

## Payments

### POST /api/payments/create

Create a new payment request. This generates a unique payment address where the customer sends funds.

**Auth required:** Yes (JWT or API Key)

**Request:**
```json
{
  "business_id": "biz_123",
  "amount_usd": 100.00,
  "currency": "BTC",
  "description": "Order #12345",
  "metadata": {
    "order_id": "ORD-12345",
    "customer_email": "customer@example.com"
  },
  "redirect_url": "https://mystore.com/order/12345/complete"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `business_id` | string | ✅ | UUID of the business |
| `amount_usd` / `amount` | number | ✅ | Amount in USD |
| `currency` / `blockchain` | string | ✅ | `btc`, `bch`, `eth`, `pol`, `sol`, `doge`, `xrp`, `ada`, `bnb`, `usdt`, `usdc`, `usdc_eth`, `usdc_pol`, `usdc_sol` |
| `description` | string | ❌ | Description shown to customer |
| `metadata` | object | ❌ | Arbitrary key-value pairs |
| `redirect_url` | string | ❌ | URL to redirect after payment |

**Response (201):**
```json
{
  "success": true,
  "payment": {
    "id": "pay_550e8400-e29b-41d4-a716-446655440000",
    "business_id": "biz_123",
    "amount": 100.00,
    "amount_usd": 100.00,
    "crypto_amount": "0.00153",
    "amount_crypto": "0.00153",
    "blockchain": "BTC",
    "currency": "btc",
    "status": "pending",
    "payment_address": "bc1q_unique_per_payment_address",
    "merchant_wallet_address": "bc1q_your_merchant_wallet",
    "created_at": "2025-01-15T10:30:00.000Z",
    "expires_at": "2025-01-15T11:30:00.000Z"
  },
  "usage": {
    "current": 5,
    "limit": 100,
    "remaining": 95
  }
}
```

> 💡 Use `GET /api/payments/:id/qr` to get a scannable QR code for this payment.

**Errors:**
| Status | Error | When |
|--------|-------|------|
| 400 | Invalid cryptocurrency type | Unsupported chain |
| 400 | No wallet configured | Business missing wallet for this chain |
| 401 | Authentication required | Missing or invalid auth |
| 429 | Monthly transaction limit exceeded | Plan limit reached |

---

### GET /api/payments

List payments for the authenticated merchant's businesses.

**Auth required:** Yes (JWT)

**Query Parameters:**
| Param | Type | Notes |
|-------|------|-------|
| `business_id` | string | Filter by business |
| `status` | string | `pending`, `detected`, `confirmed`, `forwarding`, `forwarded`, `failed`, `expired` |
| `currency` | string | Filter by blockchain (partial match) |
| `date_from` | string | ISO date (e.g. `2025-01-01`) |
| `date_to` | string | ISO date |

**Response (200):**
```json
{
  "success": true,
  "payments": [
    {
      "id": "pay_550e8400...",
      "business_id": "biz_123",
      "business_name": "My Online Store",
      "amount_crypto": "0.00153",
      "amount_usd": "100.00",
      "currency": "BTC",
      "status": "confirmed",
      "payment_address": "bc1q...",
      "tx_hash": "abc123def...",
      "confirmations": 3,
      "created_at": "2025-01-15T10:30:00.000Z",
      "expires_at": "2025-01-15T11:30:00.000Z",
      "fee_amount": "1.00",
      "merchant_amount": "99.00"
    }
  ]
}
```

---

### GET /api/payments/:id

Get a single payment by ID. No authentication required (useful for payment status pages).

**Response (200):**
```json
{
  "success": true,
  "payment": {
    "id": "pay_550e8400...",
    "business_id": "biz_123",
    "amount": 100.00,
    "crypto_amount": "0.00153",
    "blockchain": "BTC",
    "status": "pending",
    "payment_address": "bc1q...",
    "created_at": "2025-01-15T10:30:00.000Z",
    "expires_at": "2025-01-15T11:30:00.000Z"
  }
}
```

---

### POST /api/payments/:id/check-balance

Actively check the blockchain for incoming funds. Called by the frontend during polling for faster detection than the cron-based monitor.

**Auth required:** No

**Response (200) — Payment detected:**
```json
{
  "success": true,
  "status": "confirmed",
  "balance": 0.00153,
  "message": "Payment confirmed! Funds detected."
}
```

**Response (200) — Still waiting:**
```json
{
  "success": true,
  "status": "pending",
  "balance": 0,
  "expected": 0.00153,
  "message": "Waiting for payment..."
}
```

**Response (200) — Partial payment:**
```json
{
  "success": true,
  "status": "pending",
  "balance": 0.001,
  "expected": 0.00153,
  "message": "Partial payment detected: 0.001 / 0.00153"
}
```

> 📝 When a payment is confirmed, this endpoint automatically triggers fund forwarding to the merchant wallet and sends a `payment.confirmed` webhook.

---

### GET /api/payments/:id/qr

Get the payment QR code as a PNG image. Returns binary image data.

**Auth required:** No

**Response:** Binary PNG image data

**Usage:**
```html
<!-- Direct use in HTML -->
<img src="https://coinpayportal.com/api/payments/pay_123/qr" alt="Payment QR" />
```

**Headers:**
```
Content-Type: image/png
Cache-Control: public, max-age=3600
```

---

### POST /api/payments/:id/forward

Trigger payment forwarding manually. Moves confirmed funds from the payment address to the merchant's wallet.

**Auth required:** Yes (Admin JWT or Internal API Key)

**Request:**
```json
{
  "retry": false
}
```

> ⚠️ Private keys are NEVER accepted via this API. Keys are retrieved from encrypted storage server-side.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "merchantTxHash": "0xabc123...",
    "platformTxHash": "0xdef456...",
    "merchantAmount": "0.99847",
    "platformFee": "0.00153"
  }
}
```

---

### GET /api/payments/:id/forward

Get the forwarding status for a payment.

**Auth required:** Yes (JWT)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "status": "completed",
    "merchant_tx_hash": "0xabc...",
    "platform_tx_hash": "0xdef...",
    "forwarded_at": "2025-01-15T10:45:00.000Z"
  }
}
```

---

## Webhooks

### GET /api/webhooks

Get webhook delivery logs for the authenticated merchant's businesses.

**Auth required:** Yes (JWT)

**Response (200):**
```json
{
  "success": true,
  "logs": [
    {
      "id": "whlog_123",
      "business_id": "biz_123",
      "event_type": "payment.confirmed",
      "url": "https://mystore.com/webhooks/coinpay",
      "status_code": 200,
      "response_body": "{\"received\":true}",
      "created_at": "2025-01-15T10:35:00.000Z"
    }
  ]
}
```

### Webhook Events

| Event | Description |
|-------|-------------|
| `payment.created` | Payment request created |
| `payment.confirmed` | Funds detected on-chain |
| `payment.forwarded` | Funds forwarded to merchant wallet |
| `payment.expired` | Payment timed out |
| `payment.failed` | Payment or forwarding failed |

### Webhook Payload Format

```json
{
  "id": "evt_123",
  "type": "payment.confirmed",
  "business_id": "biz_123",
  "data": {
    "payment_id": "pay_123",
    "amount_usd": "100.00",
    "amount_crypto": "0.00153",
    "currency": "BTC",
    "status": "confirmed",
    "received_amount": "0.00153",
    "confirmed_at": "2025-01-15T10:35:00.000Z",
    "payment_address": "bc1q...",
    "tx_hash": "abc123...",
    "metadata": { "order_id": "ORD-12345" }
  },
  "created_at": "2025-01-15T10:35:00.000Z"
}
```

### Webhook Signature Verification

Every webhook includes an `X-CoinPay-Signature` header:

```
X-CoinPay-Signature: t=1705312500,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd
```

Verify it with:

```javascript
import { verifyWebhookSignature } from '@profullstack/coinpay';

const isValid = verifyWebhookSignature({
  payload: rawRequestBody,    // raw string, not parsed JSON
  signature: req.headers['x-coinpay-signature'],
  secret: process.env.WEBHOOK_SECRET,
  tolerance: 300,             // reject if >5 min old
});
```

---

## Fees & Rates

### GET /api/fees

Get real-time network fee estimates.

**Auth required:** No

**Query Parameters:**
| Param | Type | Notes |
|-------|------|-------|
| `blockchain` | string | Single chain (e.g. `ETH`) |
| `blockchains` | string | Comma-separated list (e.g. `BTC,ETH,SOL`) |

If no params, returns fees for all supported blockchains.

**Response (200):**
```json
{
  "success": true,
  "fees": {
    "BTC": {
      "estimated_fee": "0.00002",
      "fee_usd": "1.30",
      "unit": "BTC"
    },
    "ETH": {
      "estimated_fee": "0.001",
      "fee_usd": "3.50",
      "unit": "ETH"
    }
  }
}
```

---

### GET /api/supported-coins

List supported cryptocurrencies and which ones have wallets configured for a business.

**Auth required:** Yes (JWT or API Key)

**Response (200):**
```json
{
  "success": true,
  "coins": [
    { "symbol": "BTC", "name": "Bitcoin", "is_active": true, "has_wallet": true },
    { "symbol": "ETH", "name": "Ethereum", "is_active": true, "has_wallet": true },
    { "symbol": "SOL", "name": "Solana", "is_active": true, "has_wallet": false },
    { "symbol": "POL", "name": "Polygon", "is_active": true, "has_wallet": true }
  ]
}
```

---

## Subscriptions & Entitlements

### GET /api/subscription-plans

List all available subscription plans.

**Auth required:** No

**Response (200):**
```json
{
  "success": true,
  "plans": [
    {
      "id": "starter",
      "name": "Starter",
      "monthly_price": 0,
      "yearly_price": 0,
      "transaction_limit": 100,
      "commission_rate": 0.01,
      "features": ["100 transactions/month", "1% commission", "Email support"]
    },
    {
      "id": "professional",
      "name": "Professional",
      "monthly_price": 49,
      "yearly_price": 470,
      "transaction_limit": null,
      "commission_rate": 0.005,
      "features": ["Unlimited transactions", "0.5% commission", "Priority support", "Webhooks"]
    }
  ]
}
```

---

### GET /api/entitlements

Get current merchant's plan, features, and usage.

**Auth required:** Yes (JWT or API Key)

**Response (200):**
```json
{
  "success": true,
  "plan": "starter",
  "features": {
    "transaction_limit": 100,
    "commission_rate": 0.01,
    "webhooks_enabled": true
  },
  "usage": {
    "transactions_this_month": 42,
    "limit": 100,
    "remaining": 58
  }
}
```

---

### GET /api/subscriptions/status

Get current subscription status.

**Auth required:** Yes (JWT or API Key)

---

### POST /api/subscriptions/checkout

Create a crypto payment to upgrade your subscription.

**Auth required:** Yes (JWT or API Key)

**Request:**
```json
{
  "plan_id": "professional",
  "billing_period": "monthly",
  "blockchain": "ETH"
}
```

| Field | Type | Values |
|-------|------|--------|
| `plan_id` | string | `professional` |
| `billing_period` | string | `monthly`, `yearly` |
| `blockchain` | string | `BTC`, `BCH`, `ETH`, `POL`, `SOL` |

---

## Dashboard & Settings

### GET /api/dashboard/stats

Get dashboard analytics for the authenticated merchant.

**Auth required:** Yes (JWT)

**Query Parameters:**
| Param | Type | Notes |
|-------|------|-------|
| `business_id` | string | Filter by specific business |

**Response (200):**
```json
{
  "success": true,
  "stats": {
    "total_payments": 156,
    "total_volume_usd": 15420.50,
    "pending_payments": 3,
    "confirmed_payments": 142,
    "commission_rate": 0.01,
    "total_fees": 154.20,
    "total_merchant_amount": 15266.30
  }
}
```

---

### GET /api/settings

Get merchant settings.

**Auth required:** Yes (JWT)

---

### PATCH /api/settings

Update merchant settings.

**Auth required:** Yes (JWT)

---

## Monitoring

### GET /api/monitor/status

Check if the background payment monitor is running.

**Auth required:** Yes (Internal API Key)

**Response (200):**
```json
{
  "success": true,
  "isRunning": true,
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

---

### POST /api/monitor/status

Control the payment monitor.

**Auth required:** Yes (Internal API Key)

**Request:**
```json
{
  "action": "start"
}
```

| Action | Description |
|--------|-------------|
| `start` | Start the monitor |
| `stop` | Stop the monitor |
| `run-once` | Run a single monitoring cycle |

---

### GET /api/cron/monitor-payments

Cron endpoint called every minute by Vercel Cron. Scans pending payments and checks blockchains for incoming funds.

**Auth required:** Vercel Cron authorization

---

### GET /api/realtime/payments

Server-Sent Events (SSE) endpoint for real-time payment updates.

**Query Parameters:**
| Param | Type | Required |
|-------|------|----------|
| `businessId` | string | ❌ |
| `token` | string | ✅ (JWT) |

**Usage:**
```javascript
const eventSource = new EventSource(
  `/api/realtime/payments?token=${jwt}&businessId=${bizId}`
);

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Payment update:', data);
};
```

---

## Business Collection

### POST /api/business-collection

Create a collection payment that forwards 100% of funds to the platform wallet.

**Auth required:** Yes (JWT)

---

### GET /api/business-collection

List collection payments.

**Auth required:** Yes (JWT)

---

### GET /api/business-collection/:id

Get a specific collection payment.

**Auth required:** Yes (JWT)

---

## Web Wallet API

The Web Wallet is a non-custodial multi-chain wallet. Authentication uses **signature-based challenges** (not passwords — the user proves key ownership).

See [Web Wallet API Reference](./web-wallet-api.md) for the complete specification.

### Quick Overview

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/web-wallet/create` | POST | No | Register a new wallet |
| `/api/web-wallet/import` | POST | No | Import existing wallet |
| `/api/web-wallet/auth/challenge` | GET | No | Request auth challenge |
| `/api/web-wallet/auth/verify` | POST | No | Verify signed challenge → JWT |
| `/api/web-wallet/:id` | GET | Wallet JWT | Get wallet info |
| `/api/web-wallet/:id/derive` | POST | Wallet JWT | Derive new address |
| `/api/web-wallet/:id/addresses` | GET | Wallet JWT | List addresses |
| `/api/web-wallet/:id/balances` | GET | Wallet JWT | Get balances per chain |
| `/api/web-wallet/:id/balances/total-usd` | GET | Wallet JWT | Total USD balance |
| `/api/web-wallet/:id/prepare-tx` | POST | Wallet JWT | Build unsigned transaction |
| `/api/web-wallet/:id/broadcast` | POST | Wallet JWT | Broadcast signed transaction |
| `/api/web-wallet/:id/estimate-fee` | POST | Wallet JWT | Fee estimates by chain |
| `/api/web-wallet/:id/transactions` | GET | Wallet JWT | Transaction history |
| `/api/web-wallet/:id/settings` | GET/PATCH | Wallet JWT | Security settings |
| `/api/web-wallet/:id/webhooks` | GET/POST | Wallet JWT | Manage webhooks |
| `/api/web-wallet/:id/webhooks/:webhook_id` | GET/DELETE | Wallet JWT | Individual webhook |

---

## x402 Facilitator

CoinPayPortal serves as a multi-chain, multi-asset **x402 facilitator** — enabling HTTP 402 payment-gated APIs across Bitcoin, Ethereum, Polygon, Base, Solana, Lightning, and Stripe.

For a complete integration walkthrough, see [x402 Integration Guide](../X402_INTEGRATION.md).

### Payment Flow Overview

1. **Client requests a paid resource** → server responds with `HTTP 402` and an `accepts` array listing supported payment methods
2. **Client picks a method** (e.g. USDC on Base) and constructs a signed payment proof
3. **Client retries the request** with an `X-Payment` header containing the base64-encoded proof
4. **Server calls `POST /api/x402/verify`** to validate the proof via CoinPayPortal's facilitator
5. **Server delivers the resource** and later calls `POST /api/x402/settle` to claim funds on-chain

---

### How Clients Pay (Detailed)

#### Step 1: Receive the 402 Response

When a client hits an x402-protected endpoint without payment, they receive:

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "exact",
      "network": "bitcoin",
      "asset": "BTC",
      "maxAmountRequired": "769",
      "payTo": "bc1qMerchant...",
      "extra": { "label": "Bitcoin" }
    },
    {
      "scheme": "exact",
      "network": "base",
      "asset": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "maxAmountRequired": "5000000",
      "payTo": "0xMerchant...",
      "extra": { "label": "USDC on Base", "chainId": 8453 }
    },
    {
      "scheme": "exact",
      "network": "lightning",
      "asset": "BTC",
      "maxAmountRequired": "769",
      "payTo": "lno1Merchant...",
      "extra": { "label": "Lightning" }
    }
  ],
  "error": "Payment required"
}
```

The `accepts` array contains one entry per payment method. Amounts are in the asset's smallest unit (satoshis for BTC, 6 decimals for USDC, etc.).

#### Step 2: Pick a Method and Create Payment Proof

The client chooses a method from `accepts` and creates a payment proof:

| Method | How to Pay |
|--------|-----------|
| **USDC (EVM)** | Sign an EIP-712 typed message authorizing `transferFrom` — no on-chain tx yet, just a gasless signature |
| **Bitcoin / BCH** | Broadcast a transaction to the merchant's `payTo` address, use the txid as proof |
| **Lightning** | Pay the BOLT12 offer, use the preimage as proof |
| **Solana** | Sign and broadcast a transfer, use the transaction signature as proof |
| **Stripe** | Complete the card checkout flow, use the payment intent ID as proof |

#### Step 3: Retry with the X-Payment Header

The payment proof goes in the `X-Payment` header as base64-encoded JSON:

```http
GET /api/premium HTTP/1.1
X-Payment: eyJzY2hlbWUiOiJleGFjdCIsIm5ldHdvcmsiOiJiYXNlIi4uLn0=
```

Decoded payload (USDC on Base example):

```json
{
  "scheme": "exact",
  "network": "base",
  "asset": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "payload": {
    "signature": "0xabc123...",
    "authorization": {
      "from": "0xBuyerAddress...",
      "to": "0xMerchantAddress...",
      "value": "5000000",
      "validAfter": 0,
      "validBefore": 1739980800,
      "nonce": "0xUniqueNonce..."
    }
  }
}
```

#### Step 4: Verification and Settlement

The merchant's middleware sends the proof to `POST /api/x402/verify`. If valid, the resource is served. Settlement (`POST /api/x402/settle`) happens asynchronously to claim funds on-chain.

#### Client Library (for AI Agents / Bots)

Use `x402fetch()` to automate the entire 402 → pay → retry loop:

```js
import { x402fetch } from '@profullstack/coinpay';

const response = await x402fetch('https://api.example.com/premium', {
  paymentMethods: {
    base: { signer: wallet },           // EVM wallet (ethers/viem)
    lightning: { macaroon, host },       // LND credentials
    bitcoin: { wif: 'privateKey...' },   // BTC wallet
  },
  preferredMethod: 'usdc_base',          // optional: try this first
});

const data = await response.json();
```

---

### POST /api/x402/verify

Verify an x402 payment proof. Supports EVM signatures (EIP-712), Bitcoin/BCH transaction proofs, Solana transaction signatures, Lightning BOLT12 preimages, and Stripe payment intents.

**Auth required:** Yes (API Key via `X-API-Key` header)

**Request:**
```json
{
  "payment": {
    "scheme": "exact",
    "signature": "0xabc...",
    "payload": {
      "from": "0xBuyerAddress",
      "to": "0xMerchantAddress",
      "amount": "5000000",
      "nonce": "1234",
      "expiresAt": 1740000000,
      "network": "base",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    }
  }
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `payment` | object | ✅ | The full payment proof object |
| `payment.scheme` | string | ✅ | `exact`, `bolt12`, or `stripe-checkout` |
| `payment.signature` | string | ✅* | EVM signature (not required for UTXO/Lightning/Stripe) |
| `payment.payload` | object | ✅ | Payment details |
| `payment.payload.network` | string | ✅ | `ethereum`, `polygon`, `base`, `bitcoin`, `bitcoin-cash`, `solana`, `lightning`, `stripe` |
| `payment.payload.from` | string | ✅ | Payer address |
| `payment.payload.to` | string | ✅ | Merchant address |
| `payment.payload.amount` | string | ✅ | Amount in smallest unit |
| `payment.payload.nonce` | string | ✅* | Unique nonce (EVM) |
| `payment.payload.expiresAt` | number | ❌ | Unix timestamp |
| `payment.payload.txId` | string | ✅* | Transaction ID (UTXO networks) |
| `payment.payload.txSignature` | string | ✅* | Transaction signature (Solana) |
| `payment.payload.preimage` | string | ✅* | Payment preimage (Lightning) |
| `payment.payload.paymentHash` | string | ✅* | Payment hash (Lightning) |
| `payment.payload.paymentIntentId` | string | ✅* | Stripe payment intent ID |

\* Required for the respective payment scheme/network.

**Response (200) — Valid:**
```json
{
  "valid": true,
  "payment": {
    "from": "0xBuyerAddress",
    "to": "0xMerchantAddress",
    "amount": "5000000",
    "network": "base",
    "asset": "USDC",
    "method": "usdc_base",
    "pendingConfirmation": false
  }
}
```

**Errors:**
| Status | Error | When |
|--------|-------|------|
| 400 | Invalid payment proof: missing payload | Malformed request |
| 400 | Invalid payment signature | EVM signature doesn't match `from` |
| 400 | Payment proof has expired | `expiresAt` is in the past |
| 400 | Payment proof already used (replay detected) | Nonce/txId already seen |
| 400 | Unsupported network/scheme | Unknown network or scheme |
| 401 | API key required | Missing `X-API-Key` header |
| 401 | Invalid or inactive API key | Bad API key |
| 500 | Internal server error | Unexpected failure |

---

### POST /api/x402/settle

Settle (claim) a verified x402 payment on-chain. For EVM chains, this executes a `transferFrom` on the USDC contract. Must be called after a successful verify.

**Auth required:** Yes (API Key via `X-API-Key` header)

**Request:**
```json
{
  "payment": {
    "payload": {
      "from": "0xBuyerAddress",
      "to": "0xMerchantAddress",
      "amount": "5000000",
      "nonce": "1234",
      "network": "base"
    }
  }
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `payment` | object | ✅ | The payment proof (same as verify) |
| `payment.payload.from` | string | ✅ | Payer address |
| `payment.payload.to` | string | ✅ | Merchant address |
| `payment.payload.amount` | string | ✅ | Amount in smallest unit |
| `payment.payload.nonce` | string | ✅ | Payment nonce |
| `payment.payload.network` | string | ✅ | Network name |

**Response (200) — Settled:**
```json
{
  "settled": true,
  "txHash": "0xabc123def456...",
  "network": "base",
  "from": "0xBuyerAddress",
  "to": "0xMerchantAddress",
  "amount": "5000000"
}
```

**Response (200) — Pending settlement:**
```json
{
  "settled": false,
  "status": "pending_settlement",
  "message": "Settlement queued — facilitator key not configured for automatic settlement"
}
```

**Errors:**
| Status | Error | When |
|--------|-------|------|
| 400 | Invalid payment data | Malformed request |
| 400 | Payment not found or not verified | Must verify first |
| 400 | Cannot settle payment in status: X | Wrong status |
| 400 | Insufficient USDC allowance | Buyer didn't approve enough |
| 401 | API key required | Missing `X-API-Key` header |
| 409 | Payment already settled | Duplicate settle attempt (returns `txHash`) |
| 500 | On-chain settlement failed | Transaction reverted |
| 501 | Solana x402 settlement coming soon | Not yet implemented |

---

## Error Codes

All error responses follow this shape:

```json
{
  "success": false,
  "error": "Human-readable error message"
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad request (validation, missing fields) |
| 401 | Unauthorized (missing/invalid auth) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not found |
| 429 | Rate limited or plan limit exceeded |
| 500 | Internal server error |

### Common Error Patterns

```json
// Validation error
{ "success": false, "error": "Invalid email" }

// Auth error
{ "success": false, "error": "Missing or invalid authorization header" }

// Plan limit
{
  "success": false,
  "error": "Monthly transaction limit exceeded",
  "usage": { "current": 100, "limit": 100, "remaining": 0 }
}

// Missing wallet
{
  "success": false,
  "error": "No BTC wallet configured for this business. Please add a wallet address in the business settings."
}
```
