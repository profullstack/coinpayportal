# Subscription Plans & Entitlements

This document describes the subscription plan system and entitlements enforcement in CoinPay Portal.

## Overview

CoinPay Portal offers two subscription tiers:

| Feature | Starter (Free) | Professional ($49/month) |
|---------|----------------|--------------------------|
| Monthly Transactions | Up to 100 | Unlimited |
| All Supported Chains | ✅ | ✅ |
| Basic API Access | ✅ | ✅ |
| Advanced Analytics | ❌ | ✅ |
| Custom Webhooks | ❌ | ✅ |
| White-label Option | ❌ | ✅ |
| Priority Support | ❌ | ✅ |
| Email Support | ✅ | ✅ |

**Payment Method**: All subscription payments are processed using cryptocurrency through our internal payment gateway. Supported blockchains: BTC, BCH, ETH, POL, SOL.

## Database Schema

### Tables

#### `subscription_plans`
Defines available subscription tiers and their features.

```sql
CREATE TABLE subscription_plans (
    id TEXT PRIMARY KEY,                    -- 'starter' or 'professional'
    name TEXT NOT NULL,
    description TEXT,
    price_monthly NUMERIC(10, 2) NOT NULL,
    price_yearly NUMERIC(10, 2),
    monthly_transaction_limit INTEGER,      -- NULL = unlimited
    all_chains_supported BOOLEAN,
    basic_api_access BOOLEAN,
    advanced_analytics BOOLEAN,
    custom_webhooks BOOLEAN,
    white_label BOOLEAN,
    priority_support BOOLEAN,
    is_active BOOLEAN,
    sort_order INTEGER,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
);
```

#### `monthly_usage`
Tracks transaction counts per merchant per month.

```sql
CREATE TABLE monthly_usage (
    id UUID PRIMARY KEY,
    merchant_id UUID REFERENCES merchants(id),
    year_month TEXT NOT NULL,               -- Format: 'YYYY-MM'
    transaction_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(merchant_id, year_month)
);
```

#### `subscription_history`
Audit log of subscription changes.

```sql
CREATE TABLE subscription_history (
    id UUID PRIMARY KEY,
    merchant_id UUID REFERENCES merchants(id),
    previous_plan_id TEXT,
    new_plan_id TEXT NOT NULL,
    change_type TEXT,                       -- 'upgrade', 'downgrade', 'cancellation', etc.
    stripe_event_id TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE
);
```

### Merchant Subscription Fields

The `merchants` table includes these subscription-related columns:

```sql
ALTER TABLE merchants ADD COLUMN
    subscription_plan_id TEXT DEFAULT 'starter',
    subscription_status TEXT DEFAULT 'active',
    subscription_started_at TIMESTAMP WITH TIME ZONE,
    subscription_ends_at TIMESTAMP WITH TIME ZONE,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT;
```

## API Endpoints

### Get Subscription Plans

```http
GET /api/subscription-plans
```

Returns all available subscription plans (public endpoint).

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

```http
GET /api/entitlements
Authorization: Bearer <token>
```

Returns the authenticated merchant's current entitlements and usage.

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

### Create Subscription Checkout (Crypto Payment)

```http
POST /api/subscriptions/checkout
Authorization: Bearer <token>
Content-Type: application/json

{
  "plan_id": "professional",
  "billing_period": "monthly",
  "blockchain": "ETH"
}
```

Creates a crypto payment for subscription upgrade. Supported blockchains: BTC, BCH, ETH, POL, SOL.

**Response:**
```json
{
  "success": true,
  "payment": {
    "id": "pay_abc123",
    "payment_address": "0x1234...5678",
    "amount": 49,
    "currency": "USD",
    "blockchain": "ETH",
    "expires_at": "2024-01-15T12:00:00Z"
  },
  "plan": {
    "id": "professional",
    "name": "Professional",
    "billing_period": "monthly",
    "price": 49
  },
  "instructions": "Send exactly $49 worth of ETH to the payment address..."
}
```

### Get Subscription Status

```http
GET /api/subscriptions/status
Authorization: Bearer <token>
```

Returns the current subscription status.

**Response:**
```json
{
  "success": true,
  "subscription": {
    "planId": "professional",
    "status": "active",
    "startedAt": "2024-01-01T00:00:00Z",
    "endsAt": "2024-02-01T00:00:00Z",
    "isActive": true,
    "daysRemaining": 15
  }
}
```

### Cancel Subscription

```http
DELETE /api/subscriptions/status
Authorization: Bearer <token>
```

Cancels the subscription. Access continues until the end of the billing period.

**Response:**
```json
{
  "success": true,
  "message": "Subscription cancelled. You will retain access until the end of your billing period.",
  "subscription": {
    "planId": "professional",
    "status": "cancelled",
    "endsAt": "2024-02-01T00:00:00Z",
    "isActive": true,
    "daysRemaining": 15
  }
}
```

## Enforcement

### Transaction Limits

Transaction limits are enforced at the API level when creating payments:

1. **Before Payment Creation**: The system checks if the merchant has remaining transaction capacity
2. **After Payment Creation**: The transaction count is incremented

**Enforcement Points:**
- [`POST /api/payments/create`](../src/app/api/payments/create/route.ts)
- [`POST /api/business-collection`](../src/app/api/business-collection/route.ts)

**Error Response (429 Too Many Requests):**
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

### Feature Access

Features are checked before allowing access to premium functionality:

**Error Response (403 Forbidden):**
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

### Subscription Status

Only active or trialing subscriptions can create transactions:

**Error Response (402 Payment Required):**
```json
{
  "error": "Subscription is past_due. Please update your payment method or reactivate your subscription.",
  "code": "SUBSCRIPTION_INACTIVE",
  "details": {
    "status": "past_due"
  }
}
```

## Service Layer

### Entitlements Service

Located at [`src/lib/entitlements/service.ts`](../src/lib/entitlements/service.ts)

**Key Functions:**

```typescript
// Get merchant's full entitlements
getEntitlements(supabase, merchantId): Promise<EntitlementsResult>

// Check if merchant can create a transaction
checkTransactionLimit(supabase, merchantId): Promise<TransactionLimitResult>

// Check if merchant has a specific feature
hasFeature(supabase, merchantId, feature): Promise<FeatureResult>

// Increment transaction count after successful payment
incrementTransactionCount(supabase, merchantId): Promise<IncrementResult>
```

### Entitlements Middleware

Located at [`src/lib/entitlements/middleware.ts`](../src/lib/entitlements/middleware.ts)

**Key Functions:**

```typescript
// Check transaction limit with detailed result
withTransactionLimit(supabase, merchantId): Promise<TransactionLimitCheckResult>

// Check feature access with detailed result
withFeatureAccess(supabase, merchantId, feature): Promise<FeatureAccessResult>

// Throw error if limit exceeded (for use in route handlers)
enforceTransactionLimit(supabase, merchantId): Promise<void>

// Throw error if feature not available
enforceFeatureAccess(supabase, merchantId, feature): Promise<void>

// Create JSON response for entitlement errors
createEntitlementErrorResponse(error: EntitlementError): Response
```

## Database Functions

The migration includes PostgreSQL functions for efficient entitlement checks:

```sql
-- Get current month's usage
SELECT get_current_month_usage('merchant-uuid');

-- Check if merchant can create a transaction
SELECT can_create_transaction('merchant-uuid');

-- Increment transaction count (returns new count)
SELECT increment_transaction_count('merchant-uuid');

-- Check if merchant has a specific feature
SELECT has_feature('merchant-uuid', 'advanced_analytics');
```

## Usage Examples

### Checking Entitlements in API Routes

```typescript
import { withTransactionLimit, createEntitlementErrorResponse } from '@/lib/entitlements/middleware';
import { incrementTransactionCount } from '@/lib/entitlements/service';

export async function POST(request: NextRequest) {
  // ... authentication ...

  // Check transaction limit
  const limitCheck = await withTransactionLimit(supabase, merchantId);
  if (!limitCheck.allowed) {
    return createEntitlementErrorResponse(limitCheck.error!);
  }

  // ... create payment ...

  // Increment usage after successful creation
  await incrementTransactionCount(supabase, merchantId);

  return NextResponse.json({ success: true, payment });
}
```

### Checking Feature Access

```typescript
import { withFeatureAccess, createEntitlementErrorResponse } from '@/lib/entitlements/middleware';

export async function GET(request: NextRequest) {
  // ... authentication ...

  // Check feature access
  const featureCheck = await withFeatureAccess(supabase, merchantId, 'advanced_analytics');
  if (!featureCheck.allowed) {
    return createEntitlementErrorResponse(featureCheck.error!);
  }

  // ... return analytics data ...
}
```

## Testing

The entitlements system has comprehensive test coverage:

- [`src/lib/entitlements/service.test.ts`](../src/lib/entitlements/service.test.ts) - 23 tests
- [`src/lib/entitlements/middleware.test.ts`](../src/lib/entitlements/middleware.test.ts) - 10 tests

Run tests:
```bash
pnpm test src/lib/entitlements/
```

## Migration

Apply the subscription schema migration:

```bash
supabase db push
# or
supabase migration up
```

The migration file is located at:
[`supabase/migrations/20251127020000_add_subscription_entitlements.sql`](../supabase/migrations/20251127020000_add_subscription_entitlements.sql)

## Subscription Upgrade Flow

### Crypto Payment Process

1. Merchant selects Professional plan on the pricing page (`/pricing`)
2. Merchant chooses a cryptocurrency (BTC, BCH, ETH, POL, or SOL)
3. System creates a business-collection payment with 100% forwarding to platform
4. Merchant sends crypto to the provided payment address
5. Blockchain monitor detects the payment confirmation
6. Subscription is activated automatically
7. Entitlements are updated in real-time

### Payment Confirmation Times

- **Bitcoin/Bitcoin Cash**: 1-3 confirmations (~10-30 minutes)
- **Ethereum/Polygon**: 12-20 confirmations (~3-5 minutes)
- **Solana**: Near-instant confirmation (~1 minute)

### Subscription Service

Located at [`src/lib/subscriptions/service.ts`](../src/lib/subscriptions/service.ts)

**Key Functions:**

```typescript
// Create a crypto payment for subscription upgrade
createSubscriptionPayment(supabase, input): Promise<SubscriptionPaymentResult>

// Handle confirmed subscription payment (called by blockchain monitor)
handleSubscriptionPaymentConfirmed(supabase, paymentId): Promise<Result>

// Get merchant's subscription status
getSubscriptionStatus(supabase, merchantId): Promise<SubscriptionStatusResult>

// Cancel subscription (downgrade at end of billing period)
cancelSubscription(supabase, merchantId): Promise<Result>

// Expire ended subscriptions (cron job)
expireEndedSubscriptions(supabase): Promise<ExpireResult>
```

## Future Enhancements

1. **Usage Alerts**: Email notifications when approaching transaction limits
2. **Grace Period**: Allow a small buffer over the limit before hard enforcement
3. **Custom Plans**: Support for enterprise custom plans with negotiated limits
4. **Renewal Reminders**: Email notifications before subscription expires
5. **Auto-renewal**: Option to automatically renew subscriptions