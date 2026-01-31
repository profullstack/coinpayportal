# CoinPayPortal Anonymous Wallet Platform (AWP) - Documentation

## Overview

This directory contains the complete specification for extending CoinPayPortal from a payment gateway into a full multi-chain anonymous wallet platform.

## Document Index

| # | Document | Description |
|---|----------|-------------|
| 01 | [Overview](./01-OVERVIEW.md) | Product vision, goals, and scope |
| 02 | [Architecture](./02-ARCHITECTURE.md) | System architecture and component design |
| 03 | [Database Schema](./03-DATABASE-SCHEMA.md) | New database tables and migrations |
| 04 | [API Specification](./04-API-SPEC.md) | Wallet API endpoints |
| 05 | [Identity & Auth](./05-IDENTITY-AUTH.md) | Anonymous identity and signature-based auth |
| 06 | [Key Management](./06-KEY-MANAGEMENT.md) | Non-custodial key handling |
| 07 | [Signing Protocol](./07-SIGNING-PROTOCOL.md) | Client-side transaction signing |
| 08 | [Indexer](./08-INDEXER.md) | Blockchain indexer extension |
| 09 | [SDK Specification](./09-SDK-SPEC.md) | Bot SDK for programmatic access |
| 10 | [UI Specification](./10-UI-SPEC.md) | Web wallet user interface |
| 11 | [Security](./11-SECURITY.md) | Security model and threat analysis |
| 12 | [Implementation Phases](./12-IMPLEMENTATION-PHASES.md) | Phased delivery plan |

## Quick Links

### For Developers
- [API Endpoints](./04-API-SPEC.md#2-wallet-management-endpoints)
- [Database Schema](./03-DATABASE-SCHEMA.md#3-table-definitions)
- [SDK Quick Start](./09-SDK-SPEC.md#3-quick-start)

### For Security Review
- [Threat Model](./11-SECURITY.md#2-threat-model)
- [Security Controls](./11-SECURITY.md#3-security-controls)
- [Key Management](./06-KEY-MANAGEMENT.md)

### For Product/Design
- [UI Wireframes](./10-UI-SPEC.md#3-page-specifications)
- [User Flows](./10-UI-SPEC.md#22-navigation-flow)

## Key Principles

1. **Non-Custodial**: CoinPayPortal never stores private keys
2. **Anonymous**: No KYC, no email, no identity - seed = identity
3. **Multi-Chain**: BTC, BCH, ETH, POL, SOL, and USDC variants
4. **Dual Interface**: Browser UI for humans, API/SDK for bots
5. **Backward Compatible**: Existing payment gateway unchanged

## Architecture Summary

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

## Implementation Phases

### Phase 1: Read-Only Wallet
- Wallet creation/import
- Address derivation
- Balance tracking
- Transaction history

### Phase 2: Send Transactions
- Transaction preparation
- Client-side signing
- Broadcasting
- Fee estimation

### Phase 3: SDK & UI
- Bot SDK (`@coinpayportal/wallet-sdk`)
- Web wallet UI
- Security settings
- Documentation

## Getting Started

1. Read the [Overview](./01-OVERVIEW.md) for product context
2. Review the [Architecture](./02-ARCHITECTURE.md) for technical design
3. Check [Implementation Phases](./12-IMPLEMENTATION-PHASES.md) for the roadmap

## Related Documentation

- [Main CoinPayPortal Architecture](../ARCHITECTURE.md)
- [Existing Database Schema](../DATABASE.md)
- [Existing API Documentation](../API.md)
- [Security Documentation](../SECURITY.md)
