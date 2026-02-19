# x402 Payment Protocol Integration

## What is x402?

x402 is Coinbase's open HTTP-native payment protocol that uses the HTTP 402 "Payment Required" status code to enable machine-to-machine and human-to-machine payments. When a client requests a paid resource, the server responds with HTTP 402 containing payment instructions. The client signs a USDC transaction on-chain, then retries the request with a payment proof in the `X-PAYMENT` header.

**Why it matters for CoinPayPortal:**
- Enables pay-per-request APIs, paywalled content, and metered services
- No redirect flows, no checkout pages — payments happen inline with HTTP requests
- USDC stablecoin removes crypto volatility concerns
- Non-custodial: merchants receive payments directly to their wallets
- Programmable: AI agents and scripts can pay autonomously

## Architecture: CoinPayPortal as x402 Facilitator

In the x402 protocol, a **facilitator** is the trusted middleman that:
1. Defines payment instructions (amount, recipient, network)
2. Verifies payment proofs (signature validation)
3. Settles payments on-chain (claims USDC to merchant wallet)

CoinPayPortal acts as a **multi-chain x402 facilitator**, extending x402 beyond Base to support USDC on:
- **Ethereum** (ERC-20 USDC)
- **Polygon** (PoS USDC)
- **Solana** (SPL USDC)
- **Base** (native x402 chain)

```
┌─────────┐     1. GET /api/resource      ┌──────────────┐
│  Client  │ ───────────────────────────→  │  Merchant    │
│ (browser │     2. HTTP 402 + payment     │  Server      │
│  or bot) │ ←─────────────────────────── │  (with x402  │
│          │     3. Sign USDC tx           │   middleware) │
│          │     4. GET + X-PAYMENT header │              │
│          │ ───────────────────────────→  │              │
│          │                               │              │
└─────────┘                               └──────┬───────┘
                                                  │
                                           5. Verify & Settle
                                                  │
                                           ┌──────▼───────┐
                                           │ CoinPayPortal │
                                           │  Facilitator  │
                                           │               │
                                           │ - Verify sig  │
                                           │ - Settle USDC │
                                           │ - Multi-chain │
                                           └───────────────┘
```

### Flow

1. Client requests a paid resource from the merchant's server
2. Merchant's x402 middleware (from CoinPayPortal SDK) returns HTTP 402 with payment details:
   ```json
   {
     "x402Version": 1,
     "accepts": [{
       "scheme": "exact",
       "network": "base",
       "maxAmountRequired": "1000000",
       "resource": "https://api.merchant.com/premium",
       "description": "API call",
       "mimeType": "application/json",
       "payTo": "0xMerchantAddress",
       "maxTimeoutSeconds": 300,
       "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
       "extra": {
         "facilitator": "https://coinpayportal.com/api/x402"
       }
     }]
   }
   ```
3. Client signs a USDC payment authorization
4. Client retries the request with `X-PAYMENT` header containing the signed proof
5. Merchant middleware calls CoinPayPortal facilitator to verify and settle
6. On success, the merchant serves the resource

## Integration Guide

### Quick Start (Express/Next.js)

```bash
npm install @profullstack/coinpay
```

```javascript
import { createX402Middleware } from '@profullstack/coinpay';

// Express
const x402 = createX402Middleware({
  apiKey: 'cp_live_xxxxx',
  payTo: '0xYourWalletAddress',
  network: 'base',           // or 'ethereum', 'polygon', 'solana'
  description: 'API access',
});

app.get('/api/premium', x402({ amount: '1000000' }), (req, res) => {
  res.json({ data: 'premium content' });
});
```

```javascript
// Next.js App Router (in route.ts)
import { createX402Middleware, verifyX402Payment } from '@profullstack/coinpay';

export async function GET(request) {
  const paymentHeader = request.headers.get('x-payment');

  if (!paymentHeader) {
    return Response.json({
      x402Version: 1,
      accepts: [{
        scheme: 'exact',
        network: 'base',
        maxAmountRequired: '1000000',
        payTo: '0xYourWallet',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        maxTimeoutSeconds: 300,
        extra: { facilitator: 'https://coinpayportal.com/api/x402' }
      }]
    }, { status: 402 });
  }

  const result = await verifyX402Payment(paymentHeader, { apiKey: 'cp_live_xxxxx' });
  if (!result.valid) {
    return Response.json({ error: 'Invalid payment' }, { status: 402 });
  }

  return Response.json({ data: 'premium content' });
}
```

### CLI Testing

```bash
# Check facilitator status
coinpay x402 status

# Test the x402 flow against a local endpoint
coinpay x402 test --url http://localhost:3000/api/premium
```

### Dashboard

Log into CoinPayPortal and navigate to the **x402** section to:
- View setup instructions and code snippets
- Monitor active x402-protected endpoints
- See payment history for x402 transactions
- Configure multi-chain settlement preferences

## Comparison: x402 vs Traditional Checkout

| Feature | Traditional Checkout | x402 Protocol |
|---------|---------------------|---------------|
| User experience | Redirect to payment page | Inline with HTTP request |
| Machine payments | Not supported | Native (AI agents, scripts) |
| Integration complexity | Webhook handlers, status polling | Single middleware + header |
| Settlement | Via CoinPayPortal dashboard | Automatic on-chain |
| Supported currencies | BTC, ETH, SOL, POL, BCH, USDC | USDC (stablecoin) |
| Volatility risk | Yes (crypto) | No (stablecoin) |
| Checkout abandonment | Common | N/A (no checkout page) |

## Supported Networks

| Network | USDC Contract | Chain ID |
|---------|--------------|----------|
| Base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 8453 |
| Ethereum | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | 1 |
| Polygon | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | 137 |
| Solana | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | — |

## Security Considerations

- Payment proofs are cryptographically signed — cannot be forged
- CoinPayPortal verifies signatures server-side before settlement
- Replay protection: each payment proof includes a nonce and expiry
- Non-custodial: USDC settles directly to the merchant's wallet
- API key required for facilitator access (rate-limited)

## Resources

- [x402 Protocol Specification](https://docs.x402.org)
- [CoinPayPortal Documentation](https://docs.coinpayportal.com)
- [USDC Developer Docs](https://developers.circle.com/stablecoins/docs)
