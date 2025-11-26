# CoinPayPortal - Implementation TODO

## Phase 1: Foundation & Core Infrastructure ✅

### Database & Authentication
- [x] Initialize Supabase database schema
- [x] Set up Supabase client configuration
- [ ] Implement authentication API routes
  - [ ] POST /api/auth/register (with tests)
  - [ ] POST /api/auth/login (with tests)
  - [ ] POST /api/auth/logout (with tests)
- [ ] Add JWT token management utilities (with tests)

## Phase 2: Crypto & Blockchain Core 🔄

### Encryption & Security
- [ ] Implement AES-256-GCM encryption utilities (with tests)
  - [ ] `encrypt(data, key)` function
  - [ ] `decrypt(encryptedData, key)` function
  - [ ] Key derivation from master key
- [ ] Add bcrypt password hashing utilities (with tests)
- [ ] Create secure key storage service (with tests)

### Wallet Generation
- [ ] Implement HD wallet generation service (with tests)
  - [ ] Bitcoin (BTC) wallet generation
  - [ ] Bitcoin Cash (BCH) wallet generation
  - [ ] Ethereum (ETH) wallet generation
  - [ ] Polygon (MATIC) wallet generation
  - [ ] Solana (SOL) wallet generation
- [ ] Create mnemonic generation and validation (with tests)
- [ ] Implement derivation path utilities (with tests)

### Payment Address Generation
- [ ] Create payment address generation service (with tests)
  - [ ] Generate unique addresses per payment
  - [ ] Store encrypted private keys
  - [ ] Track address usage and status
- [ ] Implement address validation utilities (with tests)

## Phase 3: Payment Processing 🔄

### Exchange Rates
- [ ] Integrate Tatum API for exchange rates (with tests)
  - [ ] Fetch real-time crypto prices
  - [ ] Cache exchange rates (5-minute TTL)
  - [ ] Handle API failures gracefully
- [ ] Create exchange rate calculation utilities (with tests)
- [ ] Implement GET /api/rates endpoint (with tests)
- [ ] Implement POST /api/rates/batch endpoint (with tests)

### Payment Creation
- [ ] Implement POST /api/payments/create endpoint (with tests)
  - [ ] Validate payment request
  - [ ] Generate payment address
  - [ ] Calculate amounts with 2% fee
  - [ ] Store payment in database
  - [ ] Return payment details
- [ ] Create payment validation utilities (with tests)
- [ ] Add payment expiration logic (with tests)

### QR Code Generation
- [ ] Implement QR code generation service (with tests)
  - [ ] Generate QR codes for payment addresses
  - [ ] Support multiple formats (PNG, SVG)
  - [ ] Include payment amount in QR data
- [ ] Create GET /api/payments/:id/qr endpoint (with tests)

### Blockchain Monitoring
- [ ] Implement blockchain monitoring service (with tests)
  - [ ] Monitor Bitcoin transactions
  - [ ] Monitor Ethereum transactions
  - [ ] Monitor Polygon transactions
  - [ ] Monitor Solana transactions
- [ ] Create confirmation tracking (with tests)
  - [ ] BTC: 3 confirmations
  - [ ] BCH: 6 confirmations
  - [ ] ETH: 12 confirmations
  - [ ] MATIC: 128 confirmations
  - [ ] SOL: 32 confirmations
- [ ] Implement payment status updates (with tests)

### Payment Forwarding
- [ ] Implement payment forwarding service (with tests)
  - [ ] Calculate 2% platform fee
  - [ ] Split payment (98% merchant, 2% platform)
  - [ ] Execute blockchain transactions
  - [ ] Handle gas/transaction fees
- [ ] Create transaction retry logic (with tests)
- [ ] Add forwarding status tracking (with tests)

## Phase 4: Webhooks & Notifications 📡

### Webhook System
- [ ] Implement webhook delivery service (with tests)
  - [ ] Sign webhook payloads (HMAC-SHA256)
  - [ ] Retry failed deliveries (exponential backoff)
  - [ ] Log all webhook attempts
- [ ] Create POST /api/webhooks endpoint (with tests)
- [ ] Implement POST /api/webhooks/test endpoint (with tests)
- [ ] Create GET /api/webhooks/logs endpoint (with tests)
- [ ] Add webhook signature verification utilities (with tests)

## Phase 5: Business Management 🏢

### Business API
- [ ] Implement GET /api/businesses endpoint (with tests)
- [ ] Implement POST /api/businesses endpoint (with tests)
- [ ] Implement GET /api/businesses/:id endpoint (with tests)
- [ ] Implement PATCH /api/businesses/:id endpoint (with tests)
- [ ] Implement DELETE /api/businesses/:id endpoint (with tests)
- [ ] Add business validation utilities (with tests)

### Payment History
- [ ] Implement GET /api/payments endpoint (with tests)
  - [ ] Filter by business
  - [ ] Filter by status
  - [ ] Filter by date range
  - [ ] Pagination support
- [ ] Implement GET /api/payments/:id endpoint (with tests)
- [ ] Add payment analytics utilities (with tests)

## Phase 6: Frontend Development 🎨

### Landing Page
- [ ] Create landing page with demo
- [ ] Add feature showcase
- [ ] Implement live demo payment flow
- [ ] Add documentation links

### Merchant Dashboard
- [ ] Create dashboard layout
- [ ] Implement business selector
- [ ] Add payment statistics
- [ ] Create payment history table
- [ ] Add real-time payment updates

### Wallet Connection
- [ ] Integrate MetaMask connection
- [ ] Integrate WalletConnect v2
- [ ] Integrate Phantom Wallet
- [ ] Add wallet connection UI
- [ ] Implement wallet disconnection

### Business Management UI
- [ ] Create business creation form
- [ ] Implement business settings page
- [ ] Add wallet address management
- [ ] Create webhook configuration UI

## Phase 7: Testing & Quality 🧪

### Unit Tests
- [ ] Crypto utilities tests (>90% coverage)
- [ ] Wallet generation tests (>90% coverage)
- [ ] Payment processing tests (>90% coverage)
- [ ] API endpoint tests (>90% coverage)
- [ ] Webhook system tests (>90% coverage)

### Integration Tests
- [ ] End-to-end payment flow tests
- [ ] Blockchain monitoring tests
- [ ] Payment forwarding tests
- [ ] Webhook delivery tests

### E2E Tests (Playwright)
- [ ] User registration and login flow
- [ ] Business creation flow
- [ ] Payment creation and monitoring
- [ ] Dashboard navigation

### Performance & Security
- [ ] Load testing (API endpoints)
- [ ] Security audit
- [ ] Penetration testing
- [ ] Performance optimization

## Phase 8: CLI & SDK 🛠️

### CLI Tool
- [ ] Create CLI package structure
- [ ] Implement `coinpay init` command
- [ ] Implement `coinpay business create` command
- [ ] Implement `coinpay payment create` command
- [ ] Implement `coinpay payment list` command
- [ ] Add CLI tests

### SDK/ESM Module
- [ ] Create SDK package structure
- [ ] Implement payment creation SDK
- [ ] Implement webhook verification SDK
- [ ] Add SDK documentation
- [ ] Add SDK tests

## Phase 9: Deployment & DevOps 🚀

### Production Setup
- [ ] Configure production environment variables
- [ ] Set up Vercel deployment
- [ ] Configure custom domain
- [ ] Set up SSL certificates

### Monitoring & Logging
- [ ] Implement error tracking (Sentry)
- [ ] Set up application monitoring
- [ ] Configure log aggregation
- [ ] Create alerting rules

### CI/CD
- [ ] Set up GitHub Actions
- [ ] Configure automated testing
- [ ] Implement automated deployment
- [ ] Add deployment rollback strategy

## Current Priority: Phase 2 - Crypto & Blockchain Core

**Next Steps:**
1. Implement encryption utilities with comprehensive tests
2. Create wallet generation service with tests for all supported chains
3. Build payment address generation with tests
4. Set up exchange rate integration with tests

---

**Test Coverage Goal:** >80% overall, >90% for critical paths
**Testing Framework:** Vitest with React Testing Library
**Code Quality:** ESLint + Prettier, TypeScript strict mode