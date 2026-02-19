# CoinPay ⚡

The multi-chain payment infrastructure for humans and AI agents. Non-custodial crypto payments, escrow, web wallet, Lightning, x402 protocol, and Stripe — all in one platform.

**[coinpayportal.com](https://coinpayportal.com)** · [Docs](https://coinpayportal.com/docs) · [SDK](https://coinpayportal.com/docs/sdk) · [Discord](https://discord.gg/U7dEXfBA3s)

---

## What is CoinPay?

CoinPay is a non-custodial payment gateway that lets merchants accept crypto, Lightning, and card payments. It's designed for both traditional e-commerce and the agent economy — AI agents can create wallets, send payments, manage escrows, and pay for APIs autonomously.

## 🌟 Features

### 💰 Multi-Chain Payments
- **7 blockchains**: Bitcoin, Bitcoin Cash, Ethereum, Polygon, Solana, USDC (ETH/POL/SOL/Base)
- **Non-custodial**: Funds go directly to merchant wallets — no intermediaries
- **Real-time processing**: Instant payment detection and forwarding
- **0.5% platform fee**: Automatically deducted during forwarding
- **QR codes**: BIP21/EIP-681/Solana Pay URIs for one-tap wallet opens
- **Webhook notifications**: Real-time payment callbacks

### ⚡ Lightning Network (BOLT12)
- **Instant payments**: Sub-second settlement via Lightning
- **BOLT12 offers**: Static payment endpoints — no invoice management
- **Greenlight nodes**: Managed CLN nodes for merchants
- **Near-zero fees**: Fractions of a cent per payment

### 🔐 Escrow Service
- **Trustless escrow**: Hold funds until both parties are satisfied
- **Multi-chain**: BTC, ETH, POL, SOL escrow support
- **Token-based auth**: No accounts needed — unique tokens for each party
- **Recurring escrow**: Automated periodic escrow creation (subscriptions, rent, etc.)
- **Auto-refund**: Expired funded escrows automatically refunded on-chain
- **Dispute resolution**: Built-in dispute flow with evidence submission
- **Shareable links**: `/escrow/manage?id=xxx&token=yyy` for both parties

### 💳 Non-Custodial Web Wallet
- **No signup, no KYC**: Create a wallet instantly in the browser
- **Multi-chain**: BTC, ETH, SOL, POL, BCH + USDC addresses
- **Client-side encryption**: Private keys never leave the browser
- **Send & receive**: Full transaction support across all chains
- **Seed phrase backup**: Standard BIP-39 mnemonic with encrypted export
- **API-first**: REST API + SDK for programmatic access (AI agents, bots)
- **Transaction history**: Full tx history with explorer links

### ⚡ x402 Payment Protocol
- **HTTP-native machine payments**: Paywall any API route with HTTP 402
- **Multi-chain facilitator**: The only x402 implementation supporting BTC, ETH, SOL, POL, BCH, USDC (4 chains), Lightning, and Stripe
- **SDK middleware**: Express/Next.js middleware — set a USD price, buyers pick their chain
- **Client library**: `x402fetch()` wraps `fetch()` — handles 402 → pay → retry automatically
- **Facilitator API**: `/api/x402/verify` and `/api/x402/settle` endpoints
- **Built for agents**: AI agents pay for API calls with any crypto or Lightning

```javascript
// Merchant: paywall a route
app.get('/api/premium', x402({ amountUsd: 5.00 }), (req, res) => {
  res.json({ data: 'premium content' });
});

// Client: pay automatically
const response = await x402fetch('https://api.example.com/premium', {
  paymentMethods: { base: { signer: wallet } },
});
```

### 💳 Stripe Card Payments *(coming soon)*
- **Stripe Connect**: Merchant onboarding with Connect Express
- **Card + crypto**: Accept both card and crypto on the same checkout
- **Escrow mode**: Card-funded escrows with Stripe as payment method
- **Payouts**: Automated merchant payouts via Stripe

### 🆔 DID Reputation Protocol (CPTL)
- **Decentralized identifiers**: `did:web:coinpayportal.com:merchant:<id>`
- **7-dimension trust vectors**: Economic, Productivity, Behavioral, Delivery, Reliability, Accountability, Compliance
- **ActionReceipt schema**: Cryptographically signed receipts from escrow settlements
- **Cross-platform portability**: Reputation travels with your DID across platforms (e.g. [ugig.net](https://ugig.net))
- **Embeddable badges**: SVG trust badges for external sites
- **Anti-gaming**: Diminishing returns + 90-day recency decay
- **Platform Action API**: External platforms submit reputation signals

### 📦 SDK & CLI
- **NPM package**: `@profullstack/coinpay`
- **Full CLI**: `coinpay payment create`, `coinpay escrow create`, `coinpay wallet create`, `coinpay x402 test`
- **ESM module**: Import directly into Node.js applications
- **AI agent skill**: Feed `/skill.md` to any AI agent for autonomous operation

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and pnpm
- Supabase account
- RPC provider accounts (Alchemy, Infura, or public nodes)

### Installation

```bash
git clone https://github.com/profullstack/coinpayportal.git
cd coinpayportal
pnpm install
cp .env.example .env.local
# Configure .env.local with your credentials
pnpm dev
```

### Using the SDK

```bash
npm install @profullstack/coinpay
```

```javascript
import { CoinPay } from '@profullstack/coinpay';

const client = new CoinPay({ apiKey: 'cp_live_xxxxx' });

// Create a payment
const payment = await client.payments.create({
  businessId: 'biz_123',
  amount: 100,
  currency: 'USD',
  blockchain: 'eth',
});

// Create an escrow
const escrow = await client.escrow.create({
  chain: 'sol',
  amount: 500,
  depositorAddress: 'So1...',
  beneficiaryAddress: 'So2...',
  expiresIn: '7d',
});

// Create a web wallet
const wallet = await client.wallet.create({ password: 'secure' });
// → { id, addresses: { btc, eth, sol, pol, bch } }
```

### Using the CLI

```bash
# Payments
coinpay payment create --amount 100 --currency USD --blockchain eth
coinpay payment status --id pay_xyz

# Escrow
coinpay escrow create --chain sol --amount 500 --depositor So1... --beneficiary So2...
coinpay escrow release --id esc_123 --token rel_xxx

# Web Wallet
coinpay wallet create
coinpay wallet send --chain eth --to 0x... --amount 0.1

# x402
coinpay x402 test --url http://localhost:3000/api/premium
coinpay x402 status

# Reputation
coinpay reputation profile did:web:coinpayportal.com:merchant:123
```

## 📖 Documentation

- [API Reference](https://coinpayportal.com/docs) — Full REST API documentation
- [SDK & CLI](https://coinpayportal.com/docs/sdk) — Node.js SDK and CLI reference
- [x402 Integration](./docs/X402_INTEGRATION.md) — x402 payment protocol guide
- [Architecture](./docs/ARCHITECTURE.md) — System design overview
- [Database Schema](./docs/DATABASE.md) — Supabase schema reference
- [Security](./docs/SECURITY.md) — Security best practices
- [CPTL PRD](./docs/CPTL-PRD-v2.md) — Reputation protocol design document
- [Platform Integration](./docs/PLATFORM_INTEGRATION.md) — Integrate CPTL reputation

## 🏗️ Architecture

- **Frontend**: Next.js 16 + TypeScript + TailwindCSS
- **Backend**: Next.js API Routes (serverless)
- **Database**: Supabase (PostgreSQL) with Row-Level Security
- **Blockchain**: Self-hosted wallet generation, multi-RPC failover
- **Lightning**: Greenlight (CLN) managed nodes
- **Testing**: Vitest — 2,800+ tests
- **CI**: GitHub Actions with automated build + test

## 📦 Project Structure

```
coinpayportal/
├── docs/                     # Documentation
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/        # Authentication
│   │   │   ├── payments/    # Payment endpoints
│   │   │   ├── escrow/      # Escrow endpoints
│   │   │   ├── lightning/   # Lightning endpoints
│   │   │   ├── reputation/  # DID & trust endpoints
│   │   │   ├── x402/       # x402 facilitator (verify/settle)
│   │   │   └── ...
│   │   ├── dashboard/       # Merchant dashboard
│   │   ├── web-wallet/      # Non-custodial wallet UI
│   │   ├── escrow/          # Escrow management UI
│   │   ├── x402/           # x402 dashboard
│   │   └── reputation/     # DID & trust profile
│   ├── components/
│   ├── lib/
│   │   ├── blockchain/      # Multi-chain providers
│   │   ├── lightning/       # Greenlight + LNbits
│   │   ├── payments/        # Payment processing
│   │   ├── web-wallet/      # Wallet SDK (keys, signing, fees)
│   │   ├── reputation/      # Trust engine
│   │   └── crypto/          # Encryption
│   └── types/
├── packages/
│   └── sdk/                  # @profullstack/coinpay (SDK + CLI)
└── supabase/
    └── migrations/           # Database migrations
```

## 🧪 Testing

```bash
pnpm test              # Run all 2,800+ tests
pnpm test:watch        # Watch mode
pnpm test:coverage     # Coverage report
pnpm build             # Production build
```

## 🔐 Security

- Private keys encrypted at rest (AES-256)
- Client-side key generation for web wallet (keys never leave browser)
- Row-Level Security on all Supabase tables
- API key + JWT authentication
- Rate limiting on all endpoints
- Webhook signature verification
- Replay protection on x402 payments (nonce-based)

## 🛣️ Roadmap

- [x] Multi-chain payments (BTC, BCH, ETH, POL, SOL, USDC)
- [x] Non-custodial web wallet
- [x] On-chain escrow with auto-refund + recurring
- [x] Lightning Network (BOLT12 via Greenlight)
- [x] x402 payment protocol (multi-chain facilitator)
- [x] DID reputation protocol (CPTL)
- [x] SDK & CLI
- [x] Subscription plans & entitlements
- [ ] Stripe card payments *(in progress)*
- [ ] x402 Solana signature verification
- [ ] CPTL Phase 3 — Anti-collusion engine
- [ ] CPTL Phase 4 — ZK proofs, cross-chain anchoring
- [ ] Mobile SDK
- [ ] WooCommerce / Shopify plugins
- [ ] Fiat off-ramp

## 🤝 Contributing

Contributions welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md).

## 📄 License

MIT — see [LICENSE](./LICENSE).

## 🆘 Support

- **Docs**: [coinpayportal.com/docs](https://coinpayportal.com/docs)
- **Discord**: [discord.gg/U7dEXfBA3s](https://discord.gg/U7dEXfBA3s)
- **Email**: support@coinpayportal.com
- **Issues**: [GitHub Issues](https://github.com/profullstack/coinpayportal/issues)

---

Built with ❤️ by [Profullstack Inc](https://profullstack.com)
