# DID & Reputation System

## CoinPayPortal Reputation Protocol (CPR)

A portable, escrow-backed reputation layer anchored in decentralized identifiers (DIDs) and real economic activity.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [DID Identity Layer](#did-identity-layer)
4. [Reputation Flow](#reputation-flow)
5. [Trust Computation](#trust-computation)
6. [Anti-Gaming Defenses](#anti-gaming-defenses)
7. [Database Schema](#database-schema)
8. [API Reference](#api-reference)
9. [SDK & CLI](#sdk--cli)
10. [Cross-Platform Integration](#cross-platform-integration)
11. [Roadmap](#roadmap)

---

## Overview

Traditional reputation systems (star ratings, reviews) are:
- **Platform-locked** — your Uber rating means nothing on Fiverr
- **Easily gamed** — fake reviews, self-dealing, review farms
- **Subjective** — one person's 3-star is another's 5-star

CPR solves this by anchoring reputation in **real economic activity** (escrow settlements) tied to **self-owned identities** (DIDs).

```
┌─────────────────────────────────────────────────┐
│              What Makes CPR Different            │
├─────────────────────────────────────────────────┤
│  ✓ Backed by real money (escrow settlements)    │
│  ✓ Portable across platforms (DID-based)        │
│  ✓ Anti-gaming (circular payment detection)     │
│  ✓ Verifiable (signed credentials)              │
│  ✓ Revocable (public revocation registry)       │
│  ✓ No universal star rating (multi-dimensional) │
└─────────────────────────────────────────────────┘
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    CoinPayPortal Platform                     │
│                                                              │
│  ┌──────────┐   ┌──────────────┐   ┌─────────────────────┐  │
│  │  Escrow   │──▶│  Settlement  │──▶│   Task Receipt      │  │
│  │  System   │   │  Engine      │   │   (Signed Proof)    │  │
│  └──────────┘   └──────────────┘   └─────────┬───────────┘  │
│                                               │              │
│                                               ▼              │
│  ┌──────────┐   ┌──────────────┐   ┌─────────────────────┐  │
│  │  DID     │──▶│  Reputation  │──▶│  Verifiable         │  │
│  │  Layer   │   │  Engine      │   │  Credentials        │  │
│  └──────────┘   └──────────────┘   └─────────┬───────────┘  │
│                                               │              │
│                                               ▼              │
│                                    ┌─────────────────────┐   │
│                                    │  Public API / SDK   │   │
│                                    └─────────┬───────────┘   │
└──────────────────────────────────────────────┼───────────────┘
                                               │
                    ┌──────────────────────────┼──────────────┐
                    │                          │              │
                    ▼                          ▼              ▼
             ┌────────────┐          ┌──────────────┐  ┌───────────┐
             │  ugig.net  │          │  Other       │  │  Badge    │
             │  (consumer)│          │  Platforms   │  │  Embeds   │
             └────────────┘          └──────────────┘  └───────────┘
```

### Component Breakdown

```
┌─────────────────────────────────────────────────────────────┐
│                      Data Flow                               │
│                                                              │
│  User claims DID ──▶ Completes escrow ──▶ Receipt generated  │
│       │                                        │             │
│       │              ┌─────────────────────────┘             │
│       │              ▼                                       │
│       │        Reputation computed                           │
│       │              │                                       │
│       │              ├──▶ Credentials issued                 │
│       │              ├──▶ Score queryable via API             │
│       │              └──▶ Badge SVG available                │
│       │                                                      │
│       └──▶ DID shared on ugig.net, GitHub, etc.             │
│                      │                                       │
│                      └──▶ Clients verify before hiring       │
└─────────────────────────────────────────────────────────────┘
```

---

## DID Identity Layer

### What is a DID?

A **Decentralized Identifier** (DID) is a globally unique, self-owned identifier. Unlike usernames or email addresses, no central authority controls it.

```
did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK
│   │   └── Multibase-encoded ed25519 public key
│   └────── DID method (key = self-certifying)
└────────── DID scheme
```

### DID Lifecycle

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│  Generate   │────▶│  Store in    │────▶│  Use Across      │
│  ed25519    │     │  merchant_   │     │  Platforms        │
│  Keypair    │     │  dids table  │     │                  │
└─────────────┘     └──────────────┘     └──────────────────┘
       │                                          │
       │         ┌────────────────────┐           │
       └────────▶│  Derive did:key    │           │
                 │  from public key   │           │
                 └────────────────────┘           │
                                                  │
                          ┌───────────────────────┘
                          ▼
              ┌──────────────────────┐
              │  Verify via          │
              │  cryptographic proof │
              └──────────────────────┘
```

### Claiming a DID

Two paths:

```
Path A: Auto-Generate                Path B: Link Existing
┌──────────────────┐                ┌──────────────────────┐
│ POST /did/claim  │                │ POST /did/claim      │
│ (empty body)     │                │ {did, public_key,    │
│                  │                │  signature}          │
│ Server generates │                │                      │
│ ed25519 keypair  │                │ Server verifies      │
│ → did:key:z6Mk...│               │ signature proves     │
│                  │                │ DID ownership        │
└──────────────────┘                └──────────────────────┘
```

---

## Reputation Flow

### End-to-End Flow

```
 Buyer                   Escrow                  Seller (Agent)
  │                        │                        │
  │  1. Create Escrow      │                        │
  │───────────────────────▶│                        │
  │                        │                        │
  │  2. Fund Escrow        │                        │
  │───────────────────────▶│                        │
  │                        │                        │
  │                        │  3. Monitor detects    │
  │                        │     funding            │
  │                        │──────────────────────▶ │
  │                        │                        │
  │                        │  4. Work completed     │
  │                        │◀────────────────────── │
  │                        │                        │
  │  5. Release escrow     │                        │
  │───────────────────────▶│                        │
  │                        │                        │
  │                        │  6. Settle on-chain    │
  │                        │───────────────────────▶│
  │                        │                        │
  │                        │  7. Task receipt       │
  │                        │     generated          │
  │                        │        │               │
  │                        │        ▼               │
  │                        │  ┌──────────────┐      │
  │                        │  │  Reputation  │      │
  │                        │  │  Engine      │      │
  │                        │  │  computes    │      │
  │                        │  │  new score   │      │
  │                        │  └──────────────┘      │
  │                        │        │               │
  │                        │        ▼               │
  │                        │  ┌──────────────┐      │
  │                        │  │  Credential  │      │
  │                        │  │  issued      │      │
  │                        │  └──────────────┘      │
```

### Receipt Structure

```json
{
  "receipt_id": "uuid",
  "task_id": "uuid",
  "agent_did": "did:key:z6Mk...",
  "buyer_did": "did:key:z6Mk...",
  "platform_did": "did:web:coinpayportal.com",
  "escrow_tx": "0xabc...",
  "amount": 500.00,
  "currency": "USD",
  "category": "development",
  "outcome": "accepted | rejected | disputed",
  "artifact_hash": "sha256:...",
  "signatures": {
    "platform": "base64url...",
    "buyer": "base64url..."
  },
  "created_at": "2026-02-13T09:00:00Z"
}
```

---

## Trust Computation

### Reputation Windows

Scores are computed over rolling time windows:

```
┌────────────────────────────────────────────────────────┐
│                   Time Windows                          │
│                                                         │
│  ├──── 30 days ────┤                                   │
│  ├──────── 90 days ─────────┤                          │
│  ├───────────── All Time ───────────────────────┤      │
│                                                         │
│  Each window independently computes:                    │
│  • Task count         • Accepted rate                  │
│  • Disputed rate      • Total volume ($)               │
│  • Unique buyers      • Avg task value                 │
│  • Category breakdown                                  │
└────────────────────────────────────────────────────────┘
```

### Score Dimensions (v2 — CPTL)

```
Trust Vector T = {
  E: Economic Score       ← escrow settlements, weighted by log(1 + USD)
  P: Productivity Score   ← task completions, applications
  B: Behavioral Score     ← dispute rate, response patterns
  D: Diversity Score      ← unique counterparties, categories
  R: Recency Score        ← exponential decay (90-day half-life)
  A: Anomaly Penalty      ← anti-gaming flags
  C: Compliance Penalty   ← violations, incidents
}
```

### Economic Weighting

```
Raw transactions don't scale linearly:

$10 job   → weight: 10 × log(1 + 10)   = 10 × 2.40  = 24.0
$100 job  → weight: 10 × log(1 + 100)  = 10 × 4.62  = 46.2
$1000 job → weight: 10 × log(1 + 1000) = 10 × 6.91  = 69.1

This prevents micro-transaction spam while still
rewarding higher-value settlements.
```

### Diminishing Returns

```
Repeated identical actions don't accumulate linearly:

1st completion  → weight: 5 × log(1 + 1) = 3.47
10th completion → weight: 5 × log(1 + 10) = 11.99
100th           → weight: 5 × log(1 + 100) = 23.10

Encourages diverse activity over repetitive grinding.
```

### Recency Decay

```
weight_t = weight × e^(-λ × days)

λ = ln(2) / 90 ≈ 0.0077 (90-day half-life)

Day 0:   100% weight
Day 30:  79% weight
Day 90:  50% weight
Day 180: 25% weight
Day 365: 6% weight

Old activity fades. Recent activity matters most.
```

---

## Anti-Gaming Defenses

### Attack Vectors & Mitigations

```
┌─────────────────────────────────────────────────────────┐
│  Attack                │  Defense                        │
├────────────────────────┼────────────────────────────────┤
│  Self-dealing          │  Circular payment detection    │
│  (A pays B, B pays A)  │  Graph cycle analysis          │
│                        │                                │
│  Sybil farms           │  Unique buyer requirement      │
│  (fake accounts)       │  Min economic threshold        │
│                        │                                │
│  Volume spam           │  Logarithmic scaling           │
│  ($0.01 transactions)  │  Diminishing returns           │
│                        │                                │
│  Burst gaming          │  Time clustering detection     │
│  (100 txns in 1 hour)  │  Z-score anomaly flagging      │
│                        │                                │
│  Review trading        │  Reciprocal engagement         │
│  (mutual endorsements) │  dampening                     │
│                        │                                │
│  Old reputation        │  Exponential time decay        │
│  coasting              │  (90-day half-life)            │
└─────────────────────────────────────────────────────────┘
```

### Circular Payment Detection

```
Transaction Graph:

  A ──$500──▶ B ──$480──▶ C ──$460──▶ A
  │                                    │
  └────── CYCLE DETECTED ──────────────┘

  If: cycle length ≤ 5 nodes
  And: amounts within 20% of each other
  Then: FLAG as circular, apply anomaly penalty

  Result: adjusted_weight × 0.1 (90% penalty)
```

### Burst Detection

```
Normal pattern:           Suspicious pattern:
  ╷                         ╷
  │  ·  · ·  ·  · ·        │        ·····
  │ · ·  ·  ·  · ·  ·      │       ·····
  │·  ·   ·  ·   ·  ·      │      ·····
  └────────────────────     └────────────────────
   Jan   Feb   Mar           Jan   Feb   Mar

Z-score > 3σ over rolling 7-day window
→ Temporary dampening applied
```

---

## Database Schema

```
┌─────────────────────┐     ┌──────────────────────────┐
│   merchants         │     │   merchant_dids           │
├─────────────────────┤     ├──────────────────────────┤
│ id (PK)             │◀────│ merchant_id (FK, UNIQUE)  │
│ email               │     │ id (PK)                   │
│ ...                 │     │ did (UNIQUE)               │
└─────────────────────┘     │ public_key                │
                            │ private_key_encrypted     │
                            │ verified                  │
                            │ created_at                │
                            └──────────────────────────┘

┌──────────────────────────┐     ┌──────────────────────────┐
│   reputation_receipts    │     │  reputation_credentials  │
├──────────────────────────┤     ├──────────────────────────┤
│ id (PK)                  │     │ id (PK)                  │
│ receipt_id (UNIQUE)      │     │ agent_did                │
│ task_id                  │     │ credential_type          │
│ agent_did ───────────────┼────▶│ category                 │
│ buyer_did                │     │ data (JSONB)             │
│ platform_did             │     │ window_start             │
│ escrow_tx                │     │ window_end               │
│ amount                   │     │ issued_at                │
│ currency                 │     │ issuer_did               │
│ category                 │     │ signature                │
│ outcome                  │     │ revoked                  │
│ dispute                  │     │ revoked_at               │
│ artifact_hash            │     └──────────┬───────────────┘
│ signatures (JSONB)       │                │
│ created_at               │                │
│ finalized_at             │     ┌──────────▼───────────────┐
└──────────────────────────┘     │  reputation_revocations  │
                                 ├──────────────────────────┤
┌──────────────────────────┐     │ id (PK)                  │
│   reputation_issuers     │     │ credential_id (FK)       │
├──────────────────────────┤     │ reason                   │
│ id (PK)                  │     │ revoked_by               │
│ did (UNIQUE)             │     │ revoked_at               │
│ name                     │     └──────────────────────────┘
│ domain                   │
│ api_key_hash             │
│ active                   │
│ created_at               │
└──────────────────────────┘
```

---

## API Reference

### DID Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/reputation/did/claim` | Claim or link a DID |
| `GET` | `/api/reputation/did/me` | Get your DID |

### Reputation

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/reputation/receipt` | Submit a task receipt |
| `GET` | `/api/reputation/agent/[did]/reputation` | Query reputation score |
| `GET` | `/api/reputation/receipts?did=[did]` | List all receipts for a DID |

### Credentials

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/reputation/credential/[id]` | Get a specific credential |
| `GET` | `/api/reputation/credentials?did=[did]` | List all credentials for a DID |
| `POST` | `/api/reputation/verify` | Verify a credential |
| `GET` | `/api/reputation/revocation-list` | Get revocation registry |

### Badge

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/reputation/badge/[did]` | SVG reputation badge (shields.io style) |

---

## SDK & CLI

### SDK (`@profullstack/coinpay`)

```javascript
import { CoinPayClient } from '@profullstack/coinpay';
import {
  claimDid, getMyDid, linkDid,
  submitReceipt, getReputation,
  getCredential, getCredentials,
  getReceipts, getBadgeUrl,
  verifyCredential, getRevocationList,
} from '@profullstack/coinpay';

const client = new CoinPayClient({ apiKey: 'your-key' });

// DID
const did = await claimDid(client);
const myDid = await getMyDid(client);

// Reputation
const rep = await getReputation(client, 'did:key:z6Mk...');
const receipts = await getReceipts(client, 'did:key:z6Mk...');

// Credentials
const creds = await getCredentials(client, 'did:key:z6Mk...');
const cred = await getCredential(client, 'cred-id');
const valid = await verifyCredential(client, { credential_id: 'cred-id' });

// Badge
const url = getBadgeUrl('https://coinpayportal.com', 'did:key:z6Mk...');
```

### CLI

```bash
# DID Management
coinpay reputation did              # View your DID
coinpay reputation did claim        # Generate new DID
coinpay reputation did link \
  --did "did:key:..." \
  --public-key "..." \
  --signature "..."                 # Link existing DID

# Reputation
coinpay reputation query <did>      # Query reputation score
coinpay reputation submit \
  --receipt receipt.json            # Submit task receipt

# Credentials & Receipts
coinpay reputation credentials      # List your credentials
coinpay reputation credentials <did> # List credentials for a DID
coinpay reputation receipts         # List your receipts
coinpay reputation receipts <did>   # List receipts for a DID
coinpay reputation credential <id>  # Get credential details
coinpay reputation verify <id>      # Verify a credential
coinpay reputation revocations      # List revoked credentials

# Badge
coinpay reputation badge            # Get your badge URL
coinpay reputation badge <did>      # Get badge URL for a DID
```

---

## Cross-Platform Integration

### How ugig.net Consumes Reputation

```
┌──────────────┐                    ┌──────────────────┐
│   ugig.net   │                    │  CoinPayPortal   │
│              │   GET /reputation  │                  │
│  Freelancer  │───────────────────▶│  Reputation API  │
│  Profile     │◀───────────────────│                  │
│              │   Trust Vector     │                  │
│  Shows:      │                    │  Computes from:  │
│  • Score     │                    │  • Escrow data   │
│  • Badge     │                    │  • Receipts      │
│  • Verified  │                    │  • Anti-gaming   │
└──────────────┘                    └──────────────────┘
```

### Integration Steps for External Platforms

```
1. Register as Platform Issuer
   POST /api/reputation/receipt
   Platform DID: did:web:yourplatform.com

2. Map Actions to Categories
   economic.transaction → escrow completions
   productivity.completion → task deliveries
   social.endorsement → reviews/ratings

3. Submit Action Receipts
   Each completed transaction generates a signed receipt

4. Query Trust Profiles
   GET /api/reputation/agent/{did}/reputation
   Display trust vector on user profiles

5. Embed Badges
   <img src="coinpayportal.com/api/reputation/badge/{did}" />
```

---

## Roadmap

### Phase 1 — Core (Current) ✅
- [x] DID identity layer (claim, link, manage)
- [x] Task receipts from escrow settlements
- [x] Windowed reputation computation (30d/90d/all)
- [x] Anti-gaming flags (circular, burst, unique buyer)
- [x] Verifiable credentials + revocation
- [x] SDK + CLI
- [x] Web UI (dashboard, DID management, search)
- [x] Embeddable SVG badge
- [x] API documentation

### Phase 2 — Advanced Trust Math
- [ ] ActionReceipt schema (canonical categories)
- [ ] Multi-dimensional trust vector (E/P/B/D/R/A/C)
- [ ] Economic scaling: `log(1 + value_usd)`
- [ ] Diminishing returns: `log(1 + unique_count)`
- [ ] Recency decay: 90-day half-life
- [ ] Diversity multiplier
- [ ] `@coinpayportal/trust-sdk` standalone package

### Phase 3 — Anti-Collusion Engine
- [ ] Graph-based loop detection
- [ ] Reciprocal engagement dampening
- [ ] Burst detection (Z-score)
- [ ] Platform trust scoring
- [ ] Slashing bonds

### Phase 4 — Advanced
- [ ] ZK proof generation (selective disclosure)
- [ ] Cross-chain anchoring
- [ ] Weighted verifier policies
- [ ] Trust tier model (Bronze/Silver/Gold)

---

## Files & Locations

```
coinpayportal/
├── docs/
│   ├── DID_REPUTATION_SYSTEM.md    ← This file
│   └── CPTL-PRD-v2.md             ← Full PRD
├── src/
│   ├── app/
│   │   ├── api/reputation/
│   │   │   ├── did/claim/route.ts
│   │   │   ├── did/me/route.ts
│   │   │   ├── agent/[did]/reputation/route.ts
│   │   │   ├── receipt/route.ts
│   │   │   ├── credential/[id]/route.ts
│   │   │   ├── credentials/route.ts
│   │   │   ├── receipts/route.ts
│   │   │   ├── verify/route.ts
│   │   │   ├── revocation-list/route.ts
│   │   │   └── badge/[did]/route.ts
│   │   ├── reputation/
│   │   │   ├── page.tsx            ← Dashboard + search
│   │   │   ├── did/page.tsx        ← DID management
│   │   │   ├── submit/page.tsx     ← Submit receipt
│   │   │   └── credential/[id]/page.tsx
│   │   └── docs/
│   │       ├── page.tsx            ← API docs (includes reputation)
│   │       └── sdk/page.tsx        ← SDK docs (includes reputation)
│   └── components/docs/
│       └── ReputationDocs.tsx
├── packages/sdk/
│   ├── src/reputation.js           ← SDK methods
│   ├── bin/coinpay.js              ← CLI commands
│   └── test/
│       ├── reputation-sdk.test.js  ← 13 tests
│       └── cli-reputation.test.js  ← 9 tests
└── supabase/migrations/
    ├── 20260214_merchant_dids.sql
    └── 20260214_reputation_protocol.sql
```
