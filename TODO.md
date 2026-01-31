# CoinPayPortal Web Wallet - Launch Checklist

> **Goal**: Launch a fully functional anonymous multi-chain wallet that works for both human users (browser) and bots (API/SDK).

---

## Phase 1: Foundation (Read-Only Wallet)

### Database & Infrastructure
- [x] Create `wallets` table migration
- [x] Create `wallet_addresses` table migration
- [x] Create `wallet_transactions` table migration
- [x] Create `wallet_auth_challenges` table migration
- [x] Create `wallet_settings` table migration
- [x] Create `wallet_nonces` table migration
- [x] Add database indexes for performance
- [x] Set up Row Level Security (RLS) policies
- [x] Create database helper functions

### Wallet Identity System
- [x] Implement BIP39 mnemonic generation (12/24 words)
- [x] Implement BIP32/BIP44 HD key derivation
- [x] Create secp256k1 key derivation (BTC, BCH, ETH, POL)
- [x] Create ed25519 key derivation (SOL)
- [x] Implement public key validation

### Authentication (Auth-Lite)
- [x] Create challenge generation endpoint (`GET /api/web-wallet/auth/challenge`)
- [x] Create signature verification endpoint (`POST /api/web-wallet/auth/verify`)
- [x] Implement per-request signature authentication
- [x] Implement JWT token authentication (optional convenience)
- [x] Add replay attack prevention (timestamp + nonce tracking)
- [x] Add rate limiting for auth endpoints

### Wallet API - Core Endpoints
- [x] `POST /api/web-wallet/create` - Register new wallet (public keys only)
- [x] `POST /api/web-wallet/import` - Import existing wallet with proof of ownership
- [x] `GET /api/web-wallet/:id` - Get wallet info
- [x] `POST /api/web-wallet/:id/derive` - Derive new address
- [x] `GET /api/web-wallet/:id/addresses` - List all addresses
- [x] `DELETE /api/web-wallet/:id/addresses/:address_id` - Deactivate address

### Balance Indexer
- [x] Extend existing payment monitor for persistent address watching
- [x] Implement address registry service
- [x] Create balance fetcher for Bitcoin (BTC)
- [x] Create balance fetcher for Bitcoin Cash (BCH)
- [x] Create balance fetcher for Ethereum (ETH)
- [x] Create balance fetcher for Polygon (POL)
- [x] Create balance fetcher for Solana (SOL)
- [x] Create balance fetcher for USDC (ETH, POL, SOL variants)
- [x] Implement balance caching with TTL
- [x] Set up polling scheduler for balance updates
- [x] `GET /api/web-wallet/:id/balances` - Get all balances
- [x] `GET /api/web-wallet/:id/addresses/:address_id/balance` - Get single balance

### Transaction History
- [x] Implement transaction scanner for all chains
- [x] Create unified transaction schema
- [x] `GET /api/web-wallet/:id/transactions` - Get transaction history
- [x] `GET /api/web-wallet/:id/transactions/:tx_id` - Get transaction details
- [x] Add pagination support
- [x] Add filtering (chain, direction, status, date range)

---

## Phase 2: Send Transactions

### Transaction Preparation
- [x] Implement nonce management for ETH/POL
- [x] Implement UTXO selection for BTC/BCH
- [x] Implement blockhash fetching for SOL
- [x] Build unsigned transaction for ETH (EIP-1559)
- [x] Build unsigned transaction for POL (EIP-1559)
- [x] Build unsigned transaction for BTC (P2WPKH)
- [x] Build unsigned transaction for BCH
- [x] Build unsigned transaction for SOL
- [x] Build unsigned transaction for USDC transfers (ERC-20, SPL)
- [x] `POST /api/web-wallet/:id/prepare-tx` - Prepare unsigned transaction
- [x] Add transaction expiration (5 minute TTL)

### Fee Estimation
- [x] Implement gas estimation for ETH/POL
- [x] Implement fee rate fetching for BTC/BCH
- [x] Implement priority fee estimation for SOL
- [x] `POST /api/web-wallet/:id/estimate-fee` - Get fee estimates
- [x] Support low/medium/high priority options

### Client-Side Signing (Library)
- [x] Create unified signing interface
- [x] Implement Ethereum transaction signing
- [x] Implement Polygon transaction signing
- [x] Implement Bitcoin transaction signing (PSBT)
- [x] Implement Bitcoin Cash transaction signing
- [x] Implement Solana transaction signing
- [x] Implement ERC-20 token transfer signing
- [x] Implement SPL token transfer signing
- [x] Add memory clearing after signing

### Relay Service
- [x] `POST /api/web-wallet/:id/broadcast` - Broadcast signed transaction
- [x] Implement signature verification (signer matches wallet)
- [x] Implement transaction validation
- [x] Create broadcaster for ETH/POL
- [x] Create broadcaster for BTC/BCH
- [x] Create broadcaster for SOL
- [x] Add retry logic for failed broadcasts
- [x] Track transaction status after broadcast
- [x] Update confirmation tracking

### Security Controls
- [x] Implement spend limit checks
- [x] Implement address whitelist checks
- [x] `GET /api/web-wallet/:id/settings` - Get wallet settings
- [x] `PATCH /api/web-wallet/:id/settings` - Update wallet settings

---

## Phase 3: Bot SDK

### SDK Core
- [ ] Create `@coinpayportal/wallet-sdk` package structure
- [ ] Implement `Wallet.create()` - Create new wallet
- [ ] Implement `Wallet.fromSeed()` - Import from seed
- [ ] Implement `Wallet.fromWalletId()` - Read-only mode
- [ ] Implement `wallet.getAddress()` - Get address for chain
- [ ] Implement `wallet.getAddresses()` - Get all addresses
- [ ] Implement `wallet.deriveAddress()` - Derive new address

### SDK Balance & History
- [ ] Implement `wallet.getBalance()` - Get balance for chain
- [ ] Implement `wallet.getBalances()` - Get all balances
- [ ] Implement `wallet.getTotalBalanceUSD()` - Get total in USD
- [ ] Implement `wallet.getTransactions()` - Get transaction history
- [ ] Implement `wallet.getTransaction()` - Get single transaction

### SDK Transactions
- [ ] Implement `wallet.send()` - Send transaction (full flow)
- [ ] Implement `wallet.estimateFee()` - Estimate fees
- [ ] Implement local signing within SDK
- [ ] Add automatic retry logic

### SDK Events
- [ ] Implement `wallet.on('transaction.incoming')` - Incoming tx event
- [ ] Implement `wallet.on('transaction.confirmed')` - Confirmation event
- [ ] Implement `wallet.on('balance.changed')` - Balance change event
- [ ] Implement webhook registration for events

### SDK Utilities
- [ ] Implement `isValidAddress()` - Address validation
- [ ] Implement `retry()` - Retry helper
- [ ] Create error classes (InsufficientFundsError, InvalidAddressError, etc.)
- [ ] Add TypeScript type definitions

### SDK CLI Tool
- [ ] Create `coinpay-wallet create` command
- [ ] Create `coinpay-wallet import` command
- [ ] Create `coinpay-wallet balance` command
- [ ] Create `coinpay-wallet send` command
- [ ] Create `coinpay-wallet address` command
- [ ] Create `coinpay-wallet history` command
- [ ] Support environment variable configuration
- [ ] Support config file

### SDK Documentation
- [ ] Write SDK README with quick start
- [ ] Document all API methods
- [ ] Create usage examples
- [ ] Publish to npm

---

## Phase 4: Web Wallet UI

### Core Pages
- [ ] Create `/web-wallet` landing page
- [ ] Create `/web-wallet/create` - Create wallet flow
- [ ] Create `/web-wallet/import` - Import wallet flow
- [ ] Create `/web-wallet/unlock` - Unlock screen
- [ ] Create `/web-wallet` dashboard (authenticated)
- [ ] Create `/web-wallet/send` - Send transaction
- [ ] Create `/web-wallet/receive` - Receive addresses
- [ ] Create `/web-wallet/history` - Transaction history
- [ ] Create `/web-wallet/settings` - Wallet settings
- [ ] Create `/web-wallet/tx/[hash]` - Transaction details

### Wallet Creation Flow
- [ ] Implement seed phrase generation UI
- [ ] Implement seed phrase display (numbered grid)
- [ ] Implement seed backup verification (select random words)
- [ ] Implement password creation with strength indicator
- [ ] Implement seed encryption with AES-256-GCM
- [ ] Store encrypted seed in localStorage

### Wallet Import Flow
- [ ] Implement seed phrase input UI
- [ ] Implement seed validation
- [ ] Implement address discovery (gap limit scan)
- [ ] Implement password creation
- [ ] Store encrypted seed in localStorage

### Dashboard
- [ ] Display total balance in USD
- [ ] Display asset list with balances
- [ ] Display recent transactions
- [ ] Add Send/Receive quick actions
- [ ] Implement real-time balance updates

### Send Flow
- [ ] Implement chain/asset selector
- [ ] Implement recipient address input with validation
- [ ] Implement amount input with USD conversion
- [ ] Implement Max button
- [ ] Implement fee priority selector
- [ ] Implement transaction confirmation screen
- [ ] Implement password entry for signing
- [ ] Implement transaction submission
- [ ] Display transaction result

### Receive Flow
- [ ] Implement chain/asset selector
- [ ] Display QR code for address
- [ ] Display address with copy button
- [ ] Implement "Generate New Address" button
- [ ] Show chain-specific warnings

### Transaction History
- [ ] Display transaction list
- [ ] Implement filters (chain, direction, status)
- [ ] Implement date range filter
- [ ] Implement pagination/infinite scroll
- [ ] Link to transaction details

### Settings
- [ ] Implement auto-lock timeout setting
- [ ] Implement password change
- [ ] Implement daily spend limit setting
- [ ] Implement address whitelist management
- [ ] Implement "View Recovery Phrase" (password protected)
- [ ] Implement "Delete Wallet from Device"

### Security UX
- [ ] Implement auto-lock on inactivity
- [ ] Implement lock on tab close (optional)
- [ ] Clear sensitive data from memory
- [ ] Add screenshot warning for seed display
- [ ] Implement password entry for sensitive actions

### UI Components
- [ ] Create `WalletHeader` component
- [ ] Create `BalanceCard` component
- [ ] Create `AssetList` component
- [ ] Create `TransactionList` component
- [ ] Create `TransactionItem` component
- [ ] Create `AddressDisplay` component
- [ ] Create `QRCode` component
- [ ] Create `ChainSelector` component
- [ ] Create `AmountInput` component
- [ ] Create `FeeSelector` component
- [ ] Create `PasswordInput` component
- [ ] Create `SeedDisplay` component
- [ ] Create `SeedInput` component

### Responsive Design
- [ ] Implement mobile layout
- [ ] Implement tablet layout
- [ ] Add bottom navigation for mobile
- [ ] Test on various screen sizes

### Accessibility
- [ ] Add keyboard navigation
- [ ] Add screen reader support
- [ ] Ensure color contrast (4.5:1 minimum)
- [ ] Add focus indicators
- [ ] Add ARIA labels

---

## Phase 5: Testing & Security

### Unit Tests
- [x] Test key derivation for all chains
- [x] Test address validation for all chains
- [x] Test transaction building for all chains
- [x] Test signature verification
- [x] Test encryption/decryption
- [ ] Test SDK methods

### Integration Tests
- [x] Test wallet creation flow
- [x] Test wallet import flow
- [x] Test balance fetching
- [x] Test transaction history
- [ ] Test send transaction flow (testnet)
- [ ] Test SDK integration

### E2E Tests
- [ ] Test UI wallet creation
- [ ] Test UI wallet import
- [ ] Test UI send flow
- [ ] Test UI receive flow
- [ ] Test UI settings

### Security Audit
- [ ] Review key management code
- [ ] Review authentication code
- [ ] Review transaction signing code
- [ ] Check for XSS vulnerabilities
- [ ] Check for CSRF vulnerabilities
- [ ] Verify CSP headers
- [ ] Verify HTTPS enforcement
- [ ] Review rate limiting

### Load Testing
- [ ] Test indexer under load
- [ ] Test API under load
- [ ] Test concurrent wallet operations

---

## Phase 6: Documentation & Launch

### Documentation
- [ ] Update API documentation
- [ ] Write SDK getting started guide
- [ ] Create integration examples
- [ ] Write security best practices guide
- [ ] Create troubleshooting guide
- [ ] Add FAQ section

### Deployment
- [ ] Deploy database migrations
- [ ] Deploy API endpoints
- [ ] Deploy indexer service
- [ ] Deploy web wallet UI
- [ ] Publish SDK to npm
- [ ] Set up monitoring dashboards
- [ ] Set up alerting

### Launch Checklist
- [ ] Internal testing complete
- [ ] Beta user testing complete
- [ ] Security audit complete
- [ ] Documentation complete
- [ ] Monitoring in place
- [ ] Rollback plan ready
- [ ] Support channels ready

---

## Success Criteria

### Technical
- [ ] Wallet creation < 500ms
- [ ] Transaction broadcast < 2s
- [ ] Balance query < 1s
- [ ] 99.9% API uptime
- [ ] Indexer lag < 30 seconds

### Functional
- [ ] Can create wallet from seed (all chains)
- [ ] Can import existing wallet (all chains)
- [ ] Can view balances (all chains)
- [ ] Can send transactions (all chains)
- [ ] Can receive transactions (all chains)
- [ ] SDK works in Node.js
- [ ] SDK works in browser
- [ ] UI works on desktop
- [ ] UI works on mobile

### Security
- [ ] Private keys never leave client
- [ ] No PII stored on server
- [ ] Signature authentication working
- [ ] Rate limiting enforced
- [ ] Spend limits enforced (when set)

---

## Notes

- **Non-custodial**: Server NEVER stores private keys or seed phrases
- **Anonymous**: No email, no password, no KYC - seed = identity
- **Multi-chain**: BTC, BCH, ETH, POL, SOL, USDC variants
- **Dual interface**: Browser UI for humans, SDK/API for bots
- **Backward compatible**: Existing payment gateway unchanged
