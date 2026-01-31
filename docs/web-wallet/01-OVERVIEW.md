# CoinPayPortal Anonymous Wallet Platform (AWP) - Overview

## 1. Executive Summary

### Product Name
**CoinPayPortal Wallet Mode (CPW)**

### Vision
Extend CoinPayPortal from a **payment gateway** into a **full multi-chain anonymous wallet platform**, enabling:

- Humans to use it in browser like a normal wallet
- Bots to use it via API
- No accounts, no KYC, no identity requirements
- Users retain full custody of their keys

### Core Value Proposition
A non-custodial, anonymous, multi-chain wallet that works for both humans and automated systems, built on top of CoinPayPortal's existing infrastructure.

---

## 2. Goals

### Primary Goals

1. **Anonymous Access**: No email, no password, no username - seed phrase = identity
2. **Non-Custodial**: CoinPayPortal never stores raw private keys
3. **Multi-Chain Support**: BTC, BCH, ETH, POL, SOL, and USDC variants
4. **Dual Interface**: Browser UI for humans, API/SDK for bots
5. **Backward Compatible**: Preserve existing payment gateway functionality

### Secondary Goals

1. **Hardware Wallet Ready**: BIP39/BIP44 compatible for future hardware wallet support
2. **Extensible**: Easy to add new chains and tokens
3. **Developer Friendly**: Comprehensive SDK with clear documentation
4. **Security First**: Client-side signing, encrypted storage, replay protection

---

## 3. Non-Goals (Out of Scope for MVP)

- Fiat on/off ramps
- DEX/swap functionality
- NFT support
- Multi-signature wallets
- Social recovery
- Mobile native apps (web-first approach)

---

## 4. Core Principle (Non-Negotiable)

> **CoinPayPortal never stores raw private keys.**

All signing happens:
- In browser (humans) using WebCrypto + WASM
- In bot environment (bots) using SDK

CoinPayPortal becomes:
> Wallet coordinator + indexer + relay + API

**Not a custodian.**

This keeps:
- Legal risk low
- Security manageable
- Architecture compatible with current model

---

## 5. Target Users

### Human Users
- Privacy-conscious individuals
- Users in regions with restrictive KYC requirements
- Developers testing blockchain applications
- Power users managing multiple wallets

### Bot Users
- Trading bots
- Payment automation systems
- DeFi automation
- Merchant backend systems
- Monitoring and alerting systems

---

## 6. Supported Chains (MVP)

| Chain | Native Token | Derivation Path | Notes |
|-------|--------------|-----------------|-------|
| Bitcoin | BTC | m/44'/0'/0'/0/n | BIP44 standard |
| Bitcoin Cash | BCH | m/44'/145'/0'/0/n | BIP44 standard |
| Ethereum | ETH | m/44'/60'/0'/0/n | BIP44 standard |
| Polygon | POL | m/44'/60'/0'/0/n | Same as ETH |
| Solana | SOL | m/44'/501'/n'/0' | Solana standard |

### Token Support (MVP)
- USDC on Ethereum (ERC-20)
- USDC on Polygon (ERC-20)
- USDC on Solana (SPL)

---

## 7. Key Features (MVP)

### 7.1 Wallet Management
- Create new wallet (generate seed)
- Import existing wallet (from seed)
- Export seed phrase
- Derive multiple addresses per chain

### 7.2 Balance & History
- View balances across all chains
- Transaction history with unified schema
- Real-time balance updates

### 7.3 Send & Receive
- Generate receive addresses
- Prepare unsigned transactions
- Client-side signing
- Broadcast signed transactions
- Fee estimation

### 7.4 Security
- Encrypted local keystore (browser)
- Signature-based authentication
- Rate limiting per wallet
- Optional spend limits

---

## 8. Integration with Existing CoinPayPortal

### What Stays the Same
- Payment gateway flows (`/api/payments/*`)
- Merchant integrations
- Webhook infrastructure
- Business/merchant accounts
- SDK compatibility for payments

### What Gets Added
- New `/api/web-wallet/*` endpoints
- Wallet identity system
- Persistent address indexing
- Client signing protocol
- Web wallet UI at `/web-wallet`

### Architecture Principle
**Additive, not destructive** - Wallet Mode runs parallel to Gateway Mode.

```
┌─────────────────────────────────────────────────────────────┐
│                     CoinPayPortal                           │
├─────────────────────────────┬───────────────────────────────┤
│      Gateway Mode           │        Wallet Mode            │
│   (Existing - Unchanged)    │        (New - Added)          │
├─────────────────────────────┼───────────────────────────────┤
│ • Merchant payments         │ • Anonymous wallets           │
│ • Business accounts         │ • Seed-based identity         │
│ • Webhook notifications     │ • Client-side signing         │
│ • Payment forwarding        │ • Persistent indexing         │
│ • Fee collection            │ • Bot SDK                     │
└─────────────────────────────┴───────────────────────────────┘
```

---

## 9. Success Metrics

### Technical Metrics
- Wallet creation < 500ms
- Transaction broadcast < 2s
- Balance query < 1s
- 99.9% API uptime

### User Metrics
- Successful wallet imports (seed compatibility)
- Transaction success rate > 99%
- SDK adoption by bot developers

---

## 10. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Key loss by users | High | Clear seed backup UX, export reminders |
| Regulatory scrutiny | Medium | Non-custodial architecture, no KYC data stored |
| Indexer lag | Medium | Multiple RPC providers, fallback mechanisms |
| Client-side vulnerabilities | High | Security audits, CSP headers, WASM isolation |
| Bot abuse | Medium | Rate limiting, optional spend caps |

---

## 11. Document Index

This specification is organized into the following documents:

1. **01-OVERVIEW.md** (this document) - Product overview and goals
2. **02-ARCHITECTURE.md** - System architecture extension
3. **03-DATABASE-SCHEMA.md** - New tables for wallet mode
4. **04-API-SPEC.md** - Wallet API endpoints
5. **05-IDENTITY-AUTH.md** - Anonymous wallet identity and auth
6. **06-KEY-MANAGEMENT.md** - Non-custodial key management
7. **07-SIGNING-PROTOCOL.md** - Client-side signing protocol
8. **08-INDEXER.md** - Blockchain indexer extension
9. **09-SDK-SPEC.md** - Bot SDK specification
10. **10-UI-SPEC.md** - Web wallet UI specification
11. **11-SECURITY.md** - Security model and threat analysis
12. **12-IMPLEMENTATION-PHASES.md** - Phased delivery plan
