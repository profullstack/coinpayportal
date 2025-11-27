# Payment Monitoring System

## Overview

CoinPay uses a Supabase Edge Function-based payment monitoring system that continuously checks for incoming payments and automatically handles payment expiration after 15 minutes.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Payment Monitoring Flow                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Customer                                                        │
│     │                                                            │
│     ▼                                                            │
│  ┌──────────────────┐                                           │
│  │ Payment Created  │ ◄── 15-minute expiration timer starts     │
│  │ Status: pending  │                                           │
│  └────────┬─────────┘                                           │
│           │                                                      │
│           ▼                                                      │
│  ┌──────────────────┐     ┌─────────────────────┐              │
│  │ Monitor Function │────►│ Check Blockchain    │              │
│  │ (runs every min) │     │ Balance via RPC     │              │
│  └────────┬─────────┘     └─────────────────────┘              │
│           │                                                      │
│     ┌─────┴─────┐                                               │
│     │           │                                                │
│     ▼           ▼                                                │
│  ┌──────┐   ┌──────────┐                                        │
│  │ No   │   │ Balance  │                                        │
│  │ Funds│   │ Detected │                                        │
│  └──┬───┘   └────┬─────┘                                        │
│     │            │                                               │
│     ▼            ▼                                               │
│  ┌──────────┐  ┌───────────────┐                                │
│  │ Check    │  │ Update Status │                                │
│  │ Expiry   │  │ to 'confirmed'│                                │
│  └────┬─────┘  └───────┬───────┘                                │
│       │                │                                         │
│  ┌────┴────┐           ▼                                        │
│  │         │    ┌───────────────┐                               │
│  ▼         ▼    │ Trigger       │                               │
│ Still   Expired │ Forwarding    │                               │
│ Valid           └───────┬───────┘                               │
│  │                      │                                        │
│  │                      ▼                                        │
│  │              ┌───────────────┐                               │
│  │              │ Split Payment │                               │
│  │              │ 99.5% Merchant│                               │
│  │              │ 0.5% Platform │                               │
│  │              └───────┬───────┘                               │
│  │                      │                                        │
│  ▼                      ▼                                        │
│ Continue         ┌───────────────┐                              │
│ Monitoring       │ Status:       │                              │
│                  │ 'forwarded'   │                              │
│                  └───────────────┘                              │
│                                                                  │
│  ┌──────────────────┐                                           │
│  │ Expired Payment  │                                           │
│  │ Status: expired  │ ◄── After 15 minutes with no payment      │
│  └──────────────────┘                                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Payment Lifecycle

### Status Flow

```
pending ──► confirmed ──► forwarding ──► forwarded
   │                          │
   │                          ▼
   │                    forwarding_failed
   │                          │
   │                          ▼
   │                    (retry) ──► forwarded
   │
   ▼
expired
```

### Status Definitions

| Status | Description |
|--------|-------------|
| `pending` | Payment created, waiting for customer to send funds (15 min window) |
| `confirmed` | Funds detected on blockchain, waiting for forwarding |
| `forwarding` | Funds are being split and sent to merchant/platform |
| `forwarded` | Payment complete - funds delivered |
| `forwarding_failed` | Transaction failed, will retry |
| `expired` | No payment received within 15-minute window |

## 15-Minute Payment Window

### Why 15 Minutes?

1. **Cryptocurrency volatility**: Limits exposure to price fluctuations
2. **User experience**: Creates urgency without being too restrictive
3. **Resource efficiency**: Prevents indefinite address monitoring
4. **Security**: Reduces window for potential attacks

### User Communication

The payment UI clearly communicates the time limit:

```tsx
// PaymentStatusCard shows countdown timer
{timeLeft !== null && status === 'pending' && (
  <div className="flex items-center gap-2">
    <ClockIcon />
    <span className={timeLeft < 60 ? 'text-red-400 animate-pulse' : 'text-gray-300'}>
      {formatTime(timeLeft)}
    </span>
  </div>
)}

// Warning banner when time is running low
{timeLeft < 180 && timeLeft > 0 && (
  <div className="bg-orange-500/20 text-orange-300">
    ⏰ Only {Math.ceil(timeLeft / 60)} minutes left to complete payment
  </div>
)}
```

## Supabase Edge Function

### Location

```
supabase/functions/monitor-payments/index.ts
```

### Functionality

1. **Fetch pending payments** from database
2. **Check expiration** - mark as expired if > 15 minutes
3. **Check blockchain balance** via RPC for each payment address
4. **Update status** when funds detected
5. **Trigger forwarding** for confirmed payments
6. **Send webhooks** for status changes

### Deployment

```bash
# Deploy the edge function
supabase functions deploy monitor-payments

# Set environment variables
supabase secrets set BITCOIN_RPC_URL=https://...
supabase secrets set ETHEREUM_RPC_URL=https://...
supabase secrets set POLYGON_RPC_URL=https://...
supabase secrets set SOLANA_RPC_URL=https://...
supabase secrets set APP_URL=https://your-app.com
supabase secrets set INTERNAL_API_KEY=your-internal-key
```

### Scheduling

The function should be scheduled to run every minute. Configure in Supabase Dashboard:

1. Go to **Edge Functions** → **monitor-payments**
2. Click **Schedules**
3. Add schedule: `* * * * *` (every minute)

Or use pg_cron (requires database setup):

```sql
-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule every minute
SELECT cron.schedule(
  'monitor-payments',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT.supabase.co/functions/v1/monitor-payments',
    headers := '{"Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb
  );
  $$
);
```

## Database Schema

### Payments Table Updates

```sql
-- Ensure expires_at column exists
ALTER TABLE payments 
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ 
DEFAULT (NOW() + INTERVAL '15 minutes');

-- Add index for efficient monitoring queries
CREATE INDEX IF NOT EXISTS idx_payments_status_expires 
ON payments (status, expires_at) 
WHERE status = 'pending';
```

### Helper Functions

```sql
-- Expire pending payments automatically
CREATE OR REPLACE FUNCTION expire_pending_payments()
RETURNS TABLE (expired_count INTEGER, payment_ids UUID[])
AS $$
BEGIN
  UPDATE payments
  SET status = 'expired', updated_at = NOW()
  WHERE status = 'pending' AND expires_at < NOW();
  
  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN;
END;
$$ LANGUAGE plpgsql;

-- Get payments for monitoring
CREATE OR REPLACE FUNCTION get_pending_payments_for_monitoring(p_limit INTEGER DEFAULT 100)
RETURNS TABLE (
  id UUID,
  blockchain TEXT,
  crypto_amount NUMERIC,
  payment_address TEXT,
  expires_at TIMESTAMPTZ,
  time_remaining INTERVAL
)
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id, p.blockchain, p.crypto_amount, p.payment_address, p.expires_at,
    (p.expires_at - NOW()) AS time_remaining
  FROM payments p
  WHERE p.status = 'pending'
  AND p.expires_at > NOW()
  AND p.payment_address IS NOT NULL
  ORDER BY p.created_at ASC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
```

## Webhook Events

### payment.expired

Sent when a payment expires without receiving funds:

```json
{
  "event": "payment.expired",
  "payment_id": "pay_123",
  "status": "expired",
  "blockchain": "ETH",
  "amount": 0.1,
  "payment_address": "0x...",
  "timestamp": "2024-01-01T00:15:00Z",
  "reason": "Payment window expired (15 minutes)"
}
```

### payment.confirmed

Sent when funds are detected:

```json
{
  "event": "payment.confirmed",
  "payment_id": "pay_123",
  "status": "confirmed",
  "blockchain": "ETH",
  "amount": 0.1,
  "payment_address": "0x...",
  "timestamp": "2024-01-01T00:05:00Z",
  "received_amount": 0.1,
  "confirmed_at": "2024-01-01T00:05:00Z"
}
```

## Frontend Integration

### PaymentStatusCard Component

The `PaymentStatusCard` component handles:

1. **Countdown timer** - Shows remaining time
2. **Visual warnings** - Color changes as time runs low
3. **Expiration handling** - Calls `onExpired` callback
4. **Status updates** - Polls API for status changes

```tsx
import { PaymentStatusCard } from '@/components/payments';

<PaymentStatusCard
  paymentId="pay_123"
  onComplete={(data) => console.log('Payment complete!', data)}
  onExpired={() => console.log('Payment expired')}
  showQR={true}
/>
```

### usePaymentStatus Hook

```tsx
import { usePaymentStatus } from '@/lib/payments/usePaymentStatus';

const { data, status, isLoading, error } = usePaymentStatus({
  paymentId: 'pay_123',
  pollingInterval: 5000,
  onStatusChange: (status, data) => {
    if (status === 'expired') {
      // Handle expiration
    }
  },
});
```

## Testing

### Unit Tests

```bash
# Run payment service tests
pnpm test src/lib/payments/service.expiration.test.ts

# Run edge function tests (requires Deno)
deno test --allow-env supabase/functions/monitor-payments/monitor.test.ts
```

### Manual Testing

1. Create a payment via API
2. Watch the countdown in the UI
3. Wait 15 minutes (or modify `expires_at` in database)
4. Verify status changes to `expired`
5. Verify webhook is sent

## Monitoring & Debugging

### View Monitoring Stats

```sql
SELECT * FROM payment_monitoring_stats;
```

Returns:
- `active_pending` - Payments waiting for funds
- `expired_pending` - Payments that should be expired
- `awaiting_forward` - Confirmed payments waiting to forward
- `recently_forwarded` - Payments forwarded in last hour
- `recently_expired` - Payments expired in last hour

### Edge Function Logs

View in Supabase Dashboard:
1. Go to **Edge Functions** → **monitor-payments**
2. Click **Logs**

Or via CLI:
```bash
supabase functions logs monitor-payments
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `BITCOIN_RPC_URL` | Bitcoin RPC endpoint | blockstream.info |
| `ETHEREUM_RPC_URL` | Ethereum RPC endpoint | eth.llamarpc.com |
| `POLYGON_RPC_URL` | Polygon RPC endpoint | polygon-rpc.com |
| `SOLANA_RPC_URL` | Solana RPC endpoint | mainnet-beta.solana.com |
| `APP_URL` | Application URL for forwarding trigger | - |
| `INTERNAL_API_KEY` | API key for internal calls | - |

### Constants

```typescript
// Payment expiration time (in service.ts)
export const PAYMENT_EXPIRATION_MINUTES = 15;

// Balance tolerance for confirmation (1%)
const BALANCE_TOLERANCE_PERCENT = 1;

// Polling interval for frontend (5 seconds)
const POLLING_INTERVAL = 5000;
```

## Security Considerations

1. **Edge function authentication** - Uses Supabase service role key
2. **Webhook signatures** - HMAC-SHA256 signed payloads
3. **Rate limiting** - Process max 100 payments per run
4. **Private key security** - Keys never exposed, decrypted only for signing

## Troubleshooting

### Payments Not Being Monitored

1. Check edge function is deployed: `supabase functions list`
2. Verify schedule is configured in dashboard
3. Check function logs for errors
4. Verify RPC endpoints are accessible

### Payments Not Expiring

1. Check `expires_at` column has correct values
2. Verify edge function is running
3. Run manual expiration: `SELECT expire_pending_payments();`

### Balance Not Detected

1. Verify RPC endpoint is working
2. Check payment address is correct
3. Verify blockchain network matches (mainnet vs testnet)
4. Check for sufficient confirmations