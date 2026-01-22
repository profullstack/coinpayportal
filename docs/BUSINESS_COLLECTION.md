# Business Collection Payments

This document describes the Business Collection Payment system, which allows the platform to collect payments from business users (e.g., subscription fees, service charges) with 100% forwarding to platform wallets.

## Overview

Unlike regular merchant payments (which split based on subscription tier: 99% merchant / 1% platform for Starter tier, or 99.5% merchant / 0.5% platform for Professional tier), Business Collection Payments forward **100% of received funds** to platform wallet addresses configured in environment variables.

## Use Cases

- **Subscription Fees**: Collect monthly/annual subscription payments from business users
- **Service Charges**: Collect one-time service fees
- **Platform Fees**: Collect platform usage fees
- **Upgrades**: Collect payments for plan upgrades

## Configuration

### Environment Variables

Configure platform collection wallet addresses in your `.env` file:

```bash
# Platform Collection Wallets (100% forwarding destinations)
PLATFORM_FEE_WALLET_BTC=your-bitcoin-address
PLATFORM_FEE_WALLET_ETH=your-ethereum-address
PLATFORM_FEE_WALLET_POL=your-polygon-address
PLATFORM_FEE_WALLET_SOL=your-solana-address
```

**Important**: These are the same wallet addresses used for platform fees in regular merchant payments. For business collection, 100% of funds go to these wallets instead of the tiered fee split (0.5%-1% depending on subscription tier).

## Supported Blockchains

- **BTC** - Bitcoin
- **BCH** - Bitcoin Cash
- **ETH** - Ethereum
- **POL** - Polygon
- **SOL** - Solana

## API Endpoints

### Create Business Collection Payment

```http
POST /api/business-collection
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "business_id": "uuid",
  "amount": 100.00,
  "currency": "USD",
  "blockchain": "ETH",
  "description": "Monthly subscription fee",
  "metadata": {
    "plan": "premium",
    "period": "2024-01"
  }
}
```

**Response:**

```json
{
  "success": true,
  "payment": {
    "id": "uuid",
    "payment_address": "0x...",
    "amount": 100.00,
    "currency": "USD",
    "blockchain": "ETH",
    "destination_wallet": "0x...",
    "status": "pending",
    "description": "Monthly subscription fee",
    "expires_at": "2024-01-02T00:00:00Z",
    "created_at": "2024-01-01T00:00:00Z"
  }
}
```

### Get Business Collection Payment

```http
GET /api/business-collection/{id}
Authorization: Bearer <jwt_token>
```

**Response:**

```json
{
  "success": true,
  "payment": {
    "id": "uuid",
    "business_id": "uuid",
    "payment_address": "0x...",
    "amount": 100.00,
    "currency": "USD",
    "blockchain": "ETH",
    "destination_wallet": "0x...",
    "status": "confirmed",
    "description": "Monthly subscription fee",
    "metadata": { "plan": "premium" },
    "expires_at": "2024-01-02T00:00:00Z",
    "created_at": "2024-01-01T00:00:00Z"
  }
}
```

### List Business Collection Payments

```http
GET /api/business-collection?business_id=uuid&status=pending&limit=50&offset=0
Authorization: Bearer <jwt_token>
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `business_id` | string | Filter by business ID |
| `status` | string | Filter by status (pending, confirmed, forwarded, etc.) |
| `limit` | number | Maximum results (default: 50) |
| `offset` | number | Pagination offset (default: 0) |

**Response:**

```json
{
  "success": true,
  "payments": [...],
  "total": 100
}
```

## Payment Flow

```
1. Create Payment
   └── Generate unique payment address
   └── Store encrypted private key
   └── Set destination to platform wallet from .env
   └── Set forward_percentage to 100%

2. Monitor Blockchain
   └── Detect incoming transaction
   └── Update status to "detected"
   └── Wait for confirmations

3. Confirm Payment
   └── Required confirmations reached
   └── Update status to "confirmed"

4. Forward Payment
   └── Send 100% of funds to platform wallet
   └── Update status to "forwarded"
   └── Send webhook notification
```

## Payment Statuses

| Status | Description |
|--------|-------------|
| `pending` | Payment created, waiting for funds |
| `detected` | Transaction detected on blockchain |
| `confirming` | Waiting for required confirmations |
| `confirmed` | Required confirmations reached |
| `forwarding` | Forwarding funds to platform wallet |
| `forwarded` | Funds successfully forwarded |
| `forwarding_failed` | Forwarding failed (will retry) |
| `expired` | Payment expired (no funds received) |
| `cancelled` | Payment cancelled |

## Webhook Events

Business collection payments trigger the following webhook events:

### `business_collection.forwarded`

Sent when funds are successfully forwarded to the platform wallet.

```json
{
  "event": "business_collection.forwarded",
  "payment_id": "uuid",
  "business_id": "uuid",
  "type": "business_collection",
  "amount": 100.00,
  "currency": "USD",
  "crypto_amount": 0.05,
  "blockchain": "ETH",
  "tx_hash": "0x...",
  "destination_wallet": "0x...",
  "timestamp": "2024-01-01T12:00:00Z"
}
```

## Database Schema

The `business_collection_payments` table stores all collection payment records:

```sql
CREATE TABLE business_collection_payments (
    id UUID PRIMARY KEY,
    business_id UUID NOT NULL,
    merchant_id UUID NOT NULL,
    amount DECIMAL(20, 8) NOT NULL,
    currency TEXT NOT NULL,
    blockchain TEXT NOT NULL,
    crypto_amount DECIMAL(20, 8),
    payment_address TEXT,
    destination_wallet TEXT NOT NULL,
    forward_percentage INTEGER DEFAULT 100,
    status TEXT NOT NULL,
    tx_hash TEXT,
    forward_tx_hash TEXT,
    confirmations INTEGER DEFAULT 0,
    private_key_encrypted TEXT,
    description TEXT,
    metadata JSONB,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    forwarded_at TIMESTAMP WITH TIME ZONE
);
```

## Security Considerations

1. **Private Key Encryption**: Payment address private keys are encrypted before storage
2. **Environment Variables**: Platform wallet addresses are stored in environment variables, not in the database
3. **JWT Authentication**: All API endpoints require valid JWT authentication
4. **Merchant Verification**: Payments can only be created for businesses owned by the authenticated merchant
5. **Row Level Security**: Database RLS policies ensure merchants can only access their own payments

## Differences from Regular Payments

| Feature | Regular Payments | Business Collection |
|---------|-----------------|---------------------|
| Forward Split | 99-99.5% merchant / 0.5-1% platform* | 100% platform |
| Destination | Merchant wallet | Platform wallet from .env |
| Use Case | Customer payments | Business fees |
| Webhook Event | `payment.forwarded` | `business_collection.forwarded` |

*Platform fee varies by subscription tier: Starter (Free) = 1%, Professional (Paid) = 0.5%

## Example Usage

### JavaScript/TypeScript

```typescript
// Create a business collection payment
const response = await fetch('/api/business-collection', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    business_id: 'your-business-id',
    amount: 99.99,
    currency: 'USD',
    blockchain: 'ETH',
    description: 'Premium Plan - January 2024',
    metadata: {
      plan: 'premium',
      billing_period: '2024-01',
    },
  }),
});

const { payment } = await response.json();

// Display payment address to user
console.log(`Send ${payment.amount} ${payment.currency} to: ${payment.payment_address}`);
```

### cURL

```bash
# Create payment
curl -X POST https://api.example.com/api/business-collection \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "business_id": "uuid",
    "amount": 100,
    "currency": "USD",
    "blockchain": "ETH",
    "description": "Subscription fee"
  }'

# Get payment status
curl https://api.example.com/api/business-collection/payment-id \
  -H "Authorization: Bearer $TOKEN"

# List payments
curl "https://api.example.com/api/business-collection?status=pending&limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

## Migration

To enable business collection payments, run the database migration:

```bash
# Using Supabase CLI
supabase db push

# Or apply migration directly
psql -f supabase/migrations/20251127010000_add_business_collection_payments.sql
```

## Troubleshooting

### Payment Not Forwarding

1. Check that the platform wallet address is configured in `.env`
2. Verify the payment status is "confirmed"
3. Check for errors in the `error_message` field
4. Review webhook logs for delivery issues

### Invalid Blockchain Error

Ensure you're using one of the supported blockchains: BTC, BCH, ETH, POL, SOL

### Authentication Errors

1. Verify JWT token is valid and not expired
2. Ensure the merchant owns the specified business
3. Check that JWT_SECRET is configured correctly