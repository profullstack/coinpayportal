# CoinPay 🚀

A non-custodial cryptocurrency payment gateway for e-commerce that enables merchants to accept crypto payments with automatic fee handling and real-time transaction monitoring.

## 🌟 Features

### Core Payment Features
- **Multi-Chain Support**: Bitcoin, Bitcoin Cash, Ethereum, Polygon, Solana, and USDC across major blockchains
- **Non-Custodial**: Merchants maintain full control of their funds
- **Real-Time Processing**: Instant payment detection and forwarding (no batching)
- **Automatic Fee Handling**: 0.5% platform fee automatically deducted during forwarding
- **Multi-Business Support**: Manage multiple businesses under one merchant account
- **Wallet Integration**: Connect MetaMask, WalletConnect, or Phantom wallet
- **QR Code Payments**: Easy-to-integrate payment QR codes
- **Webhook Notifications**: Real-time payment callbacks for your system
- **CLI & SDK**: Command-line interface and ESM module for programmatic integration
- **Exchange Rates**: Real-time crypto/fiat rates via Tatum API

### Subscription Plans & Entitlements
- **Starter Plan (Free)**: Up to 100 transactions/month, all supported chains, basic API access, email support
- **Professional Plan ($49/month)**: Unlimited transactions, priority support, advanced analytics, custom webhooks, white-label option
- **Crypto Payments for Subscriptions**: Pay for upgrades using BTC, BCH, ETH, POL, or SOL
- **Usage Tracking**: Real-time transaction counting with automatic limit enforcement
- **Feature Gating**: API-level enforcement of plan-specific features

### Business Collection
- **Platform Payments**: Collect subscription fees and service charges from businesses
- **100% Forwarding**: Business collection payments forward entirely to platform wallets
- **Multiple Blockchains**: Support for BTC, BCH, ETH, POL, SOL

## 🏗️ Architecture

CoinPay uses a modern, scalable architecture:

- **Frontend**: Next.js 14+ with TypeScript and TailwindCSS
- **Backend**: Next.js API Routes (serverless)
- **Database**: Supabase (PostgreSQL)
- **Blockchain**: Self-hosted wallet generation with RPC provider monitoring
- **Testing**: Vitest for unit and integration tests

See [Architecture Documentation](./docs/ARCHITECTURE.md) for detailed system design.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm/yarn/pnpm
- Supabase account (free tier available)
- RPC provider accounts (Alchemy, Infura, or public nodes)
- Tatum API key (for exchange rates)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/coinpayportal.git
cd coinpayportal
```

2. Install dependencies:
```bash
npm install
```

3. Copy environment variables:
```bash
cp .env.example .env.local
```

4. Configure your `.env.local` file with required credentials:
```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Encryption
ENCRYPTION_KEY=your_32_byte_encryption_key

# RPC Providers
BITCOIN_RPC_URL=https://your-bitcoin-rpc
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
POLYGON_RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Platform Fee Wallets
PLATFORM_FEE_WALLET_BTC=your_btc_address
PLATFORM_FEE_WALLET_ETH=your_eth_address
PLATFORM_FEE_WALLET_POL=your_pol_address
PLATFORM_FEE_WALLET_SOL=your_sol_address

# Tatum API
TATUM_API_KEY=your_tatum_api_key

# Webhook
WEBHOOK_SIGNING_SECRET=your_webhook_secret
```

5. Set up the database:
```bash
npm run db:setup
```

6. Run the development server:
```bash
npm run dev
```

7. Open [http://localhost:3000](http://localhost:3000) in your browser.

## 📖 Documentation

- [Architecture Overview](./docs/ARCHITECTURE.md)
- [API Documentation](./docs/API.md)
- [Database Schema](./docs/DATABASE.md)
- [Subscriptions & Entitlements](./docs/SUBSCRIPTIONS.md)
- [Business Collection](./docs/BUSINESS_COLLECTION.md)
- [Security Best Practices](./docs/SECURITY.md)

## 💻 Usage Examples

### Creating a Payment Request (API)

```typescript
const response = await fetch('/api/payments/create', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    businessId: 'your-business-id',
    amount: 100.00,
    currency: 'USD',
    blockchain: 'eth',
    merchantWalletAddress: '0x...',
    metadata: {
      orderId: 'ORDER-123',
      customerEmail: 'customer@example.com'
    }
  })
});

const payment = await response.json();
// Returns: { id, address, qrCode, amount, expiresAt }
```

### Using the CLI

```bash
# Create a payment
coinpay payment create \
  --business-id abc123 \
  --amount 100 \
  --currency USD \
  --blockchain eth \
  --wallet 0x...

# Check payment status
coinpay payment status --id payment_xyz

# List businesses
coinpay business list

# Configure webhook
coinpay webhook set --url https://yoursite.com/webhook
```

### Using the SDK

```typescript
import { CoinPay } from '@coinpayportal/sdk';

const client = new CoinPay({
  apiKey: 'your-api-key',
  environment: 'production'
});

// Create payment
const payment = await client.payments.create({
  businessId: 'your-business-id',
  amount: 100,
  currency: 'USD',
  blockchain: 'eth',
  merchantWalletAddress: '0x...'
});

// Monitor payment
client.payments.on('confirmed', (payment) => {
  console.log('Payment confirmed:', payment.id);
});
```

### Embedding Payment QR Code

```html
<!-- Simple integration -->
<div id="coinpay-widget"
     data-business-id="your-business-id"
     data-amount="100"
     data-currency="USD"
     data-blockchain="eth">
</div>
<script src="https://coinpayportal.com/widget.js"></script>
```

## 🔐 Security

- Private keys are encrypted at rest using AES-256
- All API routes require authentication
- Rate limiting on all endpoints
- Webhook signatures for verification
- Multi-confirmation requirements before forwarding
- See [Security Documentation](./docs/SECURITY.md) for details

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run E2E tests
npm run test:e2e
```

## 📦 Project Structure

```
coinpayportal/
├── docs/                    # Documentation
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── DATABASE.md
│   ├── SUBSCRIPTIONS.md    # Subscription plans & entitlements
│   ├── BUSINESS_COLLECTION.md
│   └── SECURITY.md
├── src/
│   ├── app/                # Next.js app directory
│   │   ├── api/           # API routes
│   │   │   ├── auth/      # Authentication endpoints
│   │   │   ├── payments/  # Payment endpoints
│   │   │   ├── businesses/ # Business management
│   │   │   ├── business-collection/ # Platform payments
│   │   │   ├── subscriptions/ # Subscription management
│   │   │   └── entitlements/ # Entitlements API
│   │   ├── dashboard/     # Merchant dashboard
│   │   ├── pricing/       # Pricing & upgrade page
│   │   ├── docs/          # API documentation page
│   │   └── page.tsx       # Landing page
│   ├── components/        # React components
│   │   ├── business/      # Business management components
│   │   └── docs/          # Documentation components
│   ├── lib/              # Utility libraries
│   │   ├── auth/         # Authentication services
│   │   ├── blockchain/   # Blockchain services
│   │   ├── business/     # Business services
│   │   ├── entitlements/ # Entitlements & usage tracking
│   │   ├── payments/     # Payment processing
│   │   ├── subscriptions/ # Subscription management
│   │   ├── supabase/     # Supabase client
│   │   └── crypto/       # Encryption utilities
│   └── types/            # TypeScript types
├── supabase/
│   └── migrations/       # Database migrations
├── cli/                   # CLI package
├── sdk/                   # SDK package
└── package.json
```

## 🛣️ Roadmap

- [x] Core payment processing
- [x] Multi-chain support (BTC, BCH, ETH, POL, SOL, USDC)
- [x] Merchant dashboard
- [x] Webhook system
- [x] Subscription plans (Starter/Professional)
- [x] Entitlements & usage tracking
- [x] Business collection payments
- [x] Crypto-based subscription payments
- [ ] Mobile SDK
- [ ] WooCommerce plugin
- [ ] Shopify app
- [ ] Recurring payments (auto-renewal)
- [ ] Fiat off-ramp
- [ ] Advanced analytics dashboard

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](./CONTRIBUTING.md) for details.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

## 🆘 Support

- Documentation: [coinpayportal.com/docs](https://coinpayportal.com/docs)
- Email: support@coinpayportal.com
- Discord: [Join our community](https://discord.gg/w5nHdzpQ29)
- GitHub Issues: [Report a bug](https://github.com/profullstack/coinpayportal/issues)

## 🙏 Acknowledgments

- [Next.js](https://nextjs.org/) - React framework
- [Supabase](https://supabase.com/) - Backend as a service
- [Tatum](https://tatum.io/) - Blockchain API and exchange rates
- [Alchemy](https://www.alchemy.com/) - Blockchain infrastructure
- [WalletConnect](https://walletconnect.com/) - Wallet connection protocol

---

Built with ❤️ by the CoinPay team