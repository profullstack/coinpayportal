# Coin Swap Integration (No KYC)

## Overview

Add in-wallet coin swapping using **ChangeNOW** - a no-KYC swap provider that works in the USA! 🇺🇸

## Why ChangeNOW?

- ✅ **Works in USA** - No geo-blocking!
- ✅ **No KYC** - No identity verification for normal amounts
- ✅ **1500+ coins** - Covers all our supported chains + more
- ✅ **Simple API** - Estimate → Exchange → Monitor
- ✅ **Affiliate program** - Earn 0.4%+ of swap volume
- ✅ **Fixed & floating rates** - User choice
- ✅ **Direct to wallet** - Non-custodial, funds go straight to user

## API Flow

```
1. GET /v1/currencies           → List supported coins
2. GET /v1/min-amount/{pair}    → Get minimum amount
3. GET /v1/exchange-amount/...  → Get estimate (floating rate)
4. POST /v1/transactions/{key}  → Create exchange
5. GET /v1/transactions/{id}    → Poll status
```

## Integration Points

### Web Wallet
- New "Swap" tab alongside Send/Receive
- Coin selector (from/to)
- Amount input with live quote
- Review & confirm screen
- Status tracking

### CLI
```bash
coinpay swap --from BTC --to ETH --amount 0.01
coinpay swap:quote --from BTC --to ETH --amount 0.01
coinpay swap:status <shift_id>
```

### SDK
```typescript
const quote = await coinpay.swap.getQuote({
  from: 'BTC',
  to: 'ETH', 
  amount: '0.01'
});

const shift = await coinpay.swap.create({
  quoteId: quote.id,
  settleAddress: '0x...'
});

const status = await coinpay.swap.getStatus(shift.id);
```

## Environment Variables

```env
CHANGENOW_API_KEY=your_api_key
```

Get your API key at: https://changenow.io/api (free to sign up)

## Database Schema

```sql
CREATE TABLE swaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  shift_id TEXT NOT NULL,
  deposit_coin TEXT NOT NULL,
  deposit_network TEXT NOT NULL,
  deposit_amount DECIMAL(20, 10),
  deposit_address TEXT NOT NULL,
  settle_coin TEXT NOT NULL,
  settle_network TEXT NOT NULL,
  settle_amount DECIMAL(20, 10),
  settle_address TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  quote_rate DECIMAL(20, 10),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Implementation Tasks

- [ ] Create `/src/lib/swap/sideshift.ts` - API client
- [ ] Create `/src/lib/swap/types.ts` - Types
- [ ] Create `/src/app/api/swap/quote/route.ts` - Quote endpoint
- [ ] Create `/src/app/api/swap/create/route.ts` - Create shift
- [ ] Create `/src/app/api/swap/[id]/route.ts` - Get status
- [ ] Create `/src/app/wallet/swap/page.tsx` - UI
- [ ] Create `/src/components/swap/*` - Components
- [ ] Add CLI commands
- [ ] Add SDK methods
- [ ] Database migration
- [ ] Tests

## Supported Pairs (our coins)

| From | To | Networks |
|------|-----|----------|
| BTC | ETH, SOL, USDC, POL, BCH | mainnet |
| ETH | BTC, SOL, USDC, POL, BCH | mainnet, arbitrum, optimism |
| SOL | BTC, ETH, USDC, POL, BCH | mainnet |
| USDC | BTC, ETH, SOL, POL, BCH | ethereum, solana, polygon |
| POL | BTC, ETH, SOL, USDC, BCH | polygon |
| BCH | BTC, ETH, SOL, USDC, POL | mainnet |

## Revenue

SideShift affiliate program: **0.1% of swap volume**

At $10k/month swap volume = $10/month passive
At $100k/month = $100/month
