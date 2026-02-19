# x402 Payment Protocol Integration

## What is x402?

x402 is Coinbase's open HTTP-native payment protocol that uses the HTTP 402 "Payment Required" status code to enable machine-to-machine and human-to-machine payments. When a client requests a paid resource, the server responds with HTTP 402 containing payment instructions. The client signs a payment, then retries the request with proof in the `X-PAYMENT` header.

## Why CoinPayPortal + x402?

Everyone else's x402 implementation is USDC-on-Base only. **CoinPayPortal is the first multi-chain, multi-asset x402 facilitator.**

The 402 response's `accepts` array includes every payment method CoinPayPortal supports — the buyer picks their preferred chain and asset:

| Category | Methods |
|----------|---------|
| **Native Crypto** | BTC, ETH, SOL, POL, BCH |
| **Stablecoins** | USDC on Ethereum, Polygon, Solana, Base |
| **Lightning** | BOLT12 (instant, near-zero fees) |
| **Fiat** | Stripe (card payments) |

Plus all existing CoinPayPortal features work alongside x402: **escrow**, **swaps**, **subscriptions**, and **payouts**.

## Architecture

```
┌─────────┐     1. GET /api/resource      ┌──────────────┐
│  Client  │ ───────────────────────────→  │  Merchant    │
│ (browser │     2. HTTP 402 + accepts[]   │  Server      │
│  AI agent│ ←─────────────────────────── │  (with x402  │
│  or bot) │                               │   middleware) │
│          │  3. Pick method (e.g. BTC)    │              │
│          │  4. Sign/send payment         │              │
│          │  5. GET + X-PAYMENT header    │              │
│          │ ───────────────────────────→  │              │
└─────────┘                               └──────┬───────┘
                                                  │
                                           6. Verify & Settle
                                                  │
                                           ┌──────▼───────┐
                                           │ CoinPayPortal │
                                           │  Facilitator  │
                                           │               │
                                           │ Multi-chain:  │
                                           │ BTC·ETH·SOL   │
                                           │ POL·BCH·USDC  │
                                           │ Lightning·Fiat│
                                           └───────────────┘
```

### How the `accepts` Array Works

When a client hits a 402-protected endpoint, they receive ALL available payment options:

```json
{
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "exact",
      "network": "bitcoin",
      "asset": "BTC",
      "maxAmountRequired": "769",
      "payTo": "bc1qMerchant...",
      "extra": { "label": "Bitcoin", "facilitator": "https://coinpayportal.com/api/x402" }
    },
    {
      "scheme": "exact",
      "network": "ethereum",
      "asset": "ETH",
      "maxAmountRequired": "1428571428571429",
      "payTo": "0xMerchant...",
      "extra": { "label": "Ethereum", "chainId": 1 }
    },
    {
      "scheme": "exact",
      "network": "ethereum",
      "asset": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "maxAmountRequired": "5000000",
      "payTo": "0xMerchant...",
      "extra": { "label": "USDC on Ethereum", "assetSymbol": "USDC", "chainId": 1 }
    },
    {
      "scheme": "exact",
      "network": "solana",
      "asset": "SOL",
      "maxAmountRequired": "33333333",
      "payTo": "SoMerchant...",
      "extra": { "label": "Solana" }
    },
    {
      "scheme": "bolt12",
      "network": "lightning",
      "asset": "BTC",
      "maxAmountRequired": "76900",
      "payTo": "lno1Merchant...",
      "extra": { "label": "Lightning (BOLT12)" }
    },
    {
      "scheme": "stripe-checkout",
      "network": "stripe",
      "asset": "USD",
      "maxAmountRequired": "500",
      "payTo": "acct_xxx",
      "extra": { "label": "Card (Stripe)" }
    }
  ]
}
```

The client (browser, AI agent, or bot) picks the option it can pay with and sends the appropriate proof.

### How Clients Create Payment Proofs

Each payment method requires a different type of proof:

| Method | Proof Type | Details |
|--------|-----------|---------|
| **USDC (EVM)** | EIP-712 signature | Gasless `transferFrom` authorization — no on-chain tx until settlement |
| **Bitcoin / BCH** | Transaction ID | Broadcast tx to `payTo` address, include txid |
| **Lightning** | Preimage | Pay the BOLT12 offer, include the preimage |
| **Solana** | Transaction signature | Sign and broadcast transfer, include the sig |
| **Stripe** | Payment Intent ID | Complete card checkout, include the intent ID |

The proof is base64-encoded as JSON and sent in the `X-PAYMENT` header:

```http
GET /api/premium HTTP/1.1
X-PAYMENT: eyJzY2hlbWUiOiJleGFjdCIsIm5ldHdvcmsiOiJiYXNlIi4uLn0=
```

Decoded (USDC on Base example):

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

### Client Library for Automated Payments

For AI agents, bots, and programmatic clients, use `x402fetch()` — it wraps `fetch()` and automatically handles the 402 → pay → retry loop:

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

## Fees

CoinPayPortal takes a commission on each x402 payment, deducted before forwarding to the merchant:

| Plan | Commission | Merchant Receives | Price |
|------|-----------|-------------------|-------|
| **Starter** (Free) | 1.0% | 99.0% | $0/mo |
| **Professional** | 0.5% | 99.5% | $49/mo |

Network fees (gas, miner fees) are separate and vary by chain. Lightning payments have near-zero network fees. No hidden fees — what you see is what you pay.

## Integration Guide

### Quick Start

```bash
npm install @profullstack/coinpay
```

#### Express — Multi-Asset (Recommended)

```javascript
import { createX402Middleware } from '@profullstack/coinpay';

const x402 = createX402Middleware({
  apiKey: 'cp_live_xxxxx',
  payTo: {
    bitcoin: 'bc1qYourBtcAddress',
    ethereum: '0xYourEvmAddress',    // also used for USDC on ETH
    polygon: '0xYourEvmAddress',     // also used for USDC on POL
    base: '0xYourEvmAddress',        // also used for USDC on Base
    solana: 'YourSolanaAddress',     // also used for USDC on SOL
    lightning: 'lno1YourBolt12Offer',
    stripe: 'acct_YourStripeId',
    'bitcoin-cash': 'bitcoincash:qYourBchAddress',
  },
  rates: { BTC: 65000, ETH: 3500, SOL: 150, POL: 0.50, BCH: 350 },
  // Or fetch live rates automatically:
  // ratesEndpoint: 'https://coinpayportal.com/api/rates',
});

// Charge $5 — buyer picks their chain
app.get('/api/premium', x402({ amountUsd: 5.00 }), (req, res) => {
  res.json({ data: 'premium content', paidWith: req.x402Payment });
});
```

#### Express — Single Asset (Simple)

```javascript
const x402 = createX402Middleware({
  apiKey: 'cp_live_xxxxx',
  payTo: 'bc1qYourBtcAddress',
});

// Accept only BTC, raw satoshi amount
app.get('/api/data', x402({ amount: '1000', network: 'bitcoin' }), handler);
```

#### Next.js App Router

```javascript
import { buildPaymentRequired, verifyX402Payment } from '@profullstack/coinpay';

export async function GET(request) {
  const paymentHeader = request.headers.get('x-payment');

  if (!paymentHeader) {
    const body = buildPaymentRequired({
      payTo: {
        bitcoin: 'bc1q...',
        ethereum: '0x...',
        solana: 'So1...',
        lightning: 'lno1...',
      },
      amountUsd: 5.00,
      rates: { BTC: 65000, ETH: 3500, SOL: 150 },
    });
    return Response.json(body, { status: 402 });
  }

  const result = await verifyX402Payment(paymentHeader, { apiKey: 'cp_live_xxxxx' });
  if (!result.valid) {
    return Response.json({ error: result.reason }, { status: 402 });
  }

  return Response.json({ data: 'premium content' });
}
```

#### Only USDC + Lightning (Limit Methods)

```javascript
const x402 = createX402Middleware({
  apiKey: 'cp_live_xxxxx',
  payTo: {
    ethereum: '0x...',
    polygon: '0x...',
    base: '0x...',
    solana: 'So1...',
    lightning: 'lno1...',
  },
  methods: ['usdc_eth', 'usdc_polygon', 'usdc_base', 'usdc_solana', 'lightning'],
});
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
- Configure which payment methods to accept per endpoint

## Verification & Settlement by Payment Type

| Payment Type | Verification | Settlement |
|-------------|-------------|------------|
| **EVM native** (ETH, POL) | EIP-712 signature | Confirm tx on-chain |
| **EVM token** (USDC) | EIP-712 signature | `transferFrom` on-chain |
| **Bitcoin** | Transaction proof (txId) | Confirm block inclusion |
| **Bitcoin Cash** | Transaction proof (txId) | Confirm block inclusion |
| **Solana** (SOL, USDC) | Transaction signature | Confirm finality via RPC |
| **Lightning** | SHA256(preimage) === paymentHash | Instant (preimage = proof) |
| **Stripe** | Payment intent status check | Capture payment intent |

## Comparison: x402 vs Traditional Checkout

| Feature | Traditional Checkout | x402 Protocol |
|---------|---------------------|---------------|
| User experience | Redirect to payment page | Inline with HTTP request |
| Machine payments | Not supported | Native (AI agents, scripts) |
| Payment options | Depends on provider | BTC, ETH, SOL, POL, BCH, USDC, Lightning, Stripe |
| Integration | Webhook handlers, status polling | Single middleware + header |
| Settlement | Via dashboard | Automatic per-chain |
| Buyer choice | Limited | Full — buyer picks chain/asset |

## Supported Payment Methods Reference

| Key | Network | Asset | Decimals | Notes |
|-----|---------|-------|----------|-------|
| `btc` | bitcoin | BTC | 8 | On-chain Bitcoin |
| `bch` | bitcoin-cash | BCH | 8 | On-chain Bitcoin Cash |
| `eth` | ethereum | ETH | 18 | Native Ether |
| `pol` | polygon | POL | 18 | Native Polygon |
| `sol` | solana | SOL | 9 | Native Solana |
| `usdc_eth` | ethereum | USDC | 6 | `0xA0b8...eB48` |
| `usdc_polygon` | polygon | USDC | 6 | `0x3c49...3359` |
| `usdc_solana` | solana | USDC | 6 | `EPjF...Dt1v` |
| `usdc_base` | base | USDC | 6 | `0x8335...2913` |
| `lightning` | lightning | BTC | 0 (sats) | BOLT12 offers |
| `stripe` | stripe | USD | 2 (cents) | Card via Stripe |

## Security Considerations

- EVM payments use EIP-712 typed data signatures — cannot be forged
- Bitcoin/BCH payments verified via block explorer / full node
- Solana payments verified via RPC transaction lookup
- Lightning payments use cryptographic preimage verification
- Stripe payments verified via Stripe API
- Replay protection via unique keys (nonce, txId, txSignature, preimage)
- Non-custodial: funds settle directly to the merchant's wallet(s)
- API key required for facilitator access (rate-limited)

## Resources

- [x402 Protocol Specification](https://docs.x402.org)
- [CoinPayPortal Documentation](https://docs.coinpayportal.com)
- [USDC Developer Docs](https://developers.circle.com/stablecoins/docs)
- [BOLT12 Specification](https://bolt12.org)
