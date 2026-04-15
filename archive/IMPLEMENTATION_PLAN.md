> ⚠️ **ARCHIVED — 2026-04-07**
> This file is superseded by [`PROJECT_STATUS.md`](../PROJECT_STATUS.md) at the project root.
> This was the original pre-build planning document. Note: it contains an incorrect 2% fee figure (actual: 0.5%).
> Do not update this file.

---

# CoinPay Implementation Plan

## Project Overview

CoinPay is a non-custodial cryptocurrency payment gateway that enables e-commerce merchants to accept crypto payments with automatic fee handling and real-time transaction monitoring.

## Documentation Completed ✅

1. **README.md** - Project overview, quick start guide, and usage examples
2. **docs/ARCHITECTURE.md** - System architecture, components, and deployment strategy
3. **docs/API.md** - Complete API documentation with endpoints and examples
4. **docs/DATABASE.md** - Database schema, tables, indexes, and security policies
5. **docs/SECURITY.md** - Security best practices, encryption, and threat mitigation

## Technology Stack

### Frontend
- Next.js 14+ (App Router)
- TypeScript
- TailwindCSS
- Wagmi (Ethereum wallet connection)
- WalletConnect v2
- Phantom Wallet SDK

### Backend
- Next.js API Routes (serverless)
- Supabase (PostgreSQL with RLS)
- Node.js crypto libraries

### Blockchain
- bitcoinjs-lib (Bitcoin/BCH)
- ethers.js v6 (Ethereum/Polygon)
- @solana/web3.js (Solana)
- Tatum API (exchange rates)

### Testing
- Vitest
- React Testing Library
- Playwright (E2E)

### CLI/SDK
- Commander.js (CLI)
- ESM exports for programmatic use

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
**Goal:** Set up project structure and core infrastructure

1. Initialize Next.js project with TypeScript
2. Configure Supabase and create database schema
3. Set up environment configuration
4. Implement authentication system
5. Create basic API route structure

**Deliverables:**
- Working Next.js app with TypeScript
- Supabase database with all tables
- Authentication flow (register/login)
- Environment configuration template

### Phase 2: Blockchain Integration (Week 3-4)
**Goal:** Implement wallet generation and blockchain monitoring

1. Implement HD wallet generation for all supported chains
2. Create encryption/decryption utilities for private keys
3. Set up RPC provider connections
4. Implement blockchain monitoring service
5. Create payment address generation system

**Deliverables:**
- Wallet generation service for BTC, BCH, ETH, POL, SOL
- Encrypted key storage
- Real-time blockchain monitoring
- Payment detection system

### Phase 3: Payment Processing (Week 5-6)
**Goal:** Complete payment lifecycle implementation

1. Create payment creation API
2. Implement exchange rate integration (Tatum)
3. Build payment forwarding logic with 2% fee
4. Create QR code generation
5. Implement webhook system

**Deliverables:**
- Complete payment API
- Real-time exchange rates
- Automatic payment forwarding
- QR code generation
- Webhook notifications

### Phase 4: Frontend Development (Week 7-8)
**Goal:** Build user-facing interfaces

1. Create landing page with demo
2. Build merchant dashboard
3. Implement wallet connection (MetaMask, WalletConnect, Phantom)
4. Create business management UI
5. Build payment history and analytics

**Deliverables:**
- Landing page with live demo
- Merchant dashboard
- Wallet connection integration
- Business management interface
- Payment tracking UI

### Phase 5: CLI & SDK (Week 9)
**Goal:** Provide developer tools

1. Create CLI package structure
2. Implement CLI commands
3. Build ESM module/SDK
4. Write integration examples
5. Create documentation

**Deliverables:**
- CLI tool for merchant operations
- SDK for programmatic integration
- Integration examples
- Developer documentation

### Phase 6: Testing & Security (Week 10)
**Goal:** Ensure quality and security

1. Write unit tests (Vitest)
2. Create integration tests
3. Implement E2E tests (Playwright)
4. Security audit and penetration testing
5. Performance optimization

**Deliverables:**
- Comprehensive test coverage (>80%)
- Security audit report
- Performance benchmarks
- Bug fixes and optimizations

### Phase 7: Deployment & Launch (Week 11-12)
**Goal:** Production deployment

1. Set up production environment
2. Configure monitoring and alerting
3. Deploy to Vercel
4. Set up CI/CD pipeline
5. Launch and monitor

**Deliverables:**
- Production deployment
- Monitoring dashboards
- CI/CD pipeline
- Launch documentation

## Key Features Summary

### For Merchants
- ✅ Multi-business support (one account, multiple businesses)
- ✅ Non-custodial (merchants control their funds)
- ✅ Real-time payment processing
- ✅ Automatic fee handling (2%)
- ✅ Webhook notifications
- ✅ Multiple wallet connections
- ✅ Payment analytics

### For Customers
- ✅ QR code payments
- ✅ Multiple blockchain support
- ✅ Real-time exchange rates
- ✅ Simple payment flow
- ✅ No account required

### For Developers
- ✅ RESTful API
- ✅ CLI tool
- ✅ SDK/ESM module
- ✅ Webhook integration
- ✅ Comprehensive documentation

## Supported Blockchains

1. **Bitcoin (BTC)** - 3 confirmations
2. **Bitcoin Cash (BCH)** - 6 confirmations
3. **Ethereum (ETH)** - 12 confirmations
4. **Polygon (POL)** - 128 confirmations
5. **Solana (SOL)** - 32 confirmations
6. **USDC** - On Ethereum, Polygon, and Solana

## Security Highlights

- 🔐 AES-256-GCM encryption for private keys
- 🔐 Bcrypt password hashing (cost factor 12)
- 🔐 JWT authentication with expiration
- 🔐 Row Level Security (RLS) in database
- 🔐 Rate limiting on all endpoints
- 🔐 CORS configuration
- 🔐 Input validation and sanitization
- 🔐 Webhook signature verification
- 🔐 Multi-confirmation requirements
- 🔐 Comprehensive audit logging

## Environment Variables Required

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY

# Encryption & Auth
ENCRYPTION_KEY (32-byte hex)
JWT_SECRET (base64)

# RPC Providers
BITCOIN_RPC_URL
ETHEREUM_RPC_URL
POLYGON_RPC_URL
SOLANA_RPC_URL

# Platform Fee Wallets
PLATFORM_FEE_WALLET_BTC
PLATFORM_FEE_WALLET_ETH
PLATFORM_FEE_WALLET_POL
PLATFORM_FEE_WALLET_SOL
SYSTEM_MNEMONIC_BTC
SYSTEM_MNEMONIC_ETH
SYSTEM_MNEMONIC_POL
SYSTEM_MNEMONIC_SOL

# APIs
TATUM_API_KEY

# Security
WEBHOOK_SIGNING_SECRET
ALLOWED_ORIGINS
```

## Database Tables

1. **merchants** - Merchant accounts
2. **businesses** - Business entities (many per merchant)
3. **payment_addresses** - Generated crypto addresses
4. **payments** - Payment transactions
5. **webhook_logs** - Webhook delivery logs

## API Endpoints

### Authentication
- POST `/api/auth/register`
- POST `/api/auth/login`
- POST `/api/auth/logout`

### Business Management
- GET `/api/businesses`
- POST `/api/businesses`
- GET `/api/businesses/:id`
- PATCH `/api/businesses/:id`
- DELETE `/api/businesses/:id`

### Payments
- POST `/api/payments/create`
- GET `/api/payments/:id`
- GET `/api/payments`
- GET `/api/payments/:id/qr`

### Exchange Rates
- GET `/api/rates`
- POST `/api/rates/batch`

### Webhooks
- POST `/api/webhooks`
- POST `/api/webhooks/test`
- GET `/api/webhooks/logs`

## Success Metrics

### Technical
- 99.9% uptime
- <500ms API response time
- <30s payment detection
- <5min payment forwarding
- >80% test coverage

### Business
- Merchant onboarding time <5 minutes
- Payment success rate >99%
- Webhook delivery success >95%
- Customer payment completion >90%

## Risk Mitigation

### Technical Risks
1. **Private key compromise** → Encryption, key rotation, monitoring
2. **Blockchain congestion** → Gas price limits, retry logic
3. **RPC provider downtime** → Multiple providers, fallback
4. **Database failure** → Automated backups, replication

### Business Risks
1. **Regulatory changes** → Legal consultation, compliance monitoring
2. **Market volatility** → Real-time rates, quick forwarding
3. **Competition** → Unique features, excellent UX
4. **Scaling issues** → Serverless architecture, caching

## Next Steps

1. **Review this plan** - Ensure alignment with requirements
2. **Prioritize features** - Identify must-haves vs nice-to-haves
3. **Set timeline** - Adjust phases based on resources
4. **Begin implementation** - Start with Phase 1 (Foundation)

## Questions for Discussion

1. Do you want to start with all blockchains or phase them in?
2. Should we implement testnet support first?
3. What's the priority: speed to market or feature completeness?
4. Do you have existing infrastructure we should integrate with?
5. What's your preferred deployment platform (Vercel, AWS, etc.)?

---

**Ready to proceed?** Switch to Code mode to begin implementation!