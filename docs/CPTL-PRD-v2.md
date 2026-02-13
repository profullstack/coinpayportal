# CoinPayPortal Trust Layer (CPTL) v2

## Multi-Signal, Economically Anchored, Portable Reputation Protocol

---

## 1. Overview

| | |
|---|---|
| **Product Type** | Infrastructure protocol + Trust Engine + SDK |
| **Purpose** | Provide a portable, cross-platform reputation layer that: |
| | • Anchors trust in escrow-backed transactions |
| | • Supports arbitrary platform actions |
| | • Computes multi-dimensional trust |
| | • Prevents spam and collusion |
| | • Is verifiable and revocable |
| | • Is consumable via SDK |

---

## 2. System Architecture

```
DID Identity Layer
       ↓
Action Receipt Layer
       ↓
Trust Computation Engine
       ↓
Attestation / Credential Layer
       ↓
SDK + API
```

---

## 3. Standardized Action Schema

All trust inputs must be submitted as ActionReceipts.

### 3.1 Core ActionReceipt Schema

```json
{
  "action_id": "uuid",
  "subject_did": "did:key:...",
  "platform_did": "did:web:ugig.net",
  "action_category": "economic.transaction",
  "action_type": "escrow_completion",
  "counterparty_did": "did:key:...",
  "value_usd": 500,
  "confidence_level": "escrow_verified",
  "metadata_hash": "sha256:...",
  "timestamp": "2026-01-01T10:00:00Z",
  "signatures": {
    "platform": "...",
    "optional_counterparty": "...",
    "optional_escrow": "..."
  }
}
```

### 3.2 Canonical Action Categories

All platforms must map actions into one of these:

**Economic**
- `economic.transaction`
- `economic.dispute`
- `economic.refund`

**Productivity**
- `productivity.task`
- `productivity.application`
- `productivity.completion`

**Identity**
- `identity.profile_update`
- `identity.verification`

**Social**
- `social.post`
- `social.comment`
- `social.endorsement`

**Compliance**
- `compliance.incident`
- `compliance.violation`

Platforms can define custom `action_type` but must map to a core category.

---

## 4. Trust Computation Model (Formalized)

Trust is computed as a vector:

```
T = {
  E: Economic Score
  P: Productivity Score
  B: Behavioral Score
  D: Diversity Score
  R: Recency Score
  A: Anomaly Penalty
  C: Compliance Penalty
}
```

### 4.1 Base Signal Weighting

Each action has: `base_weight(action_category)`

Initial v1 weights:

| Category | Base Weight |
|---|---|
| `economic.transaction` | 10 |
| `economic.dispute` | -12 |
| `productivity.completion` | 5 |
| `productivity.application` | 1 |
| `identity.verification` | 3 |
| `identity.profile_update` | 0.5 |
| `social.post` | 0.05 |
| `social.comment` | 0.02 |
| `compliance.violation` | -20 |

### 4.2 Economic Scaling

For transactions:

```
economic_weight = base_weight × log(1 + value_usd)
```

Prevents micro-spam.

### 4.3 Diminishing Returns

For repeated identical action types:

```
adjusted_weight = base_weight × log(1 + unique_count)
```

Not linear accumulation.

### 4.4 Recency Decay

All signals decay:

```
weight_t = weight × e^(-λ × days)
```

Default: 90-day half-life

### 4.5 Diversity Multiplier

Encourages:
- Unique counterparties
- Cross-category participation
- Non-repetitive activity

Simple v1 formula:

```
D = log(1 + unique_counterparties)
```

### 4.6 Final Score Computation

Each dimension:

```
DimensionScore = Σ(adjusted_weight × recency_decay)
```

Trust vector returned, not a single number.

---

## 5. Anti-Collusion / Engagement Ring Defense

Critical for social and productivity signals.

### 5.1 Graph-Based Loop Detection

Construct graph:

**Nodes:**
- Agents
- Buyers
- Platforms

**Edges:**
- Transactions
- Endorsements
- Engagements

**Flag:**
- Tight cycles
- Repeated bilateral edges
- Small closed clusters

If `cluster density > threshold`: Apply anomaly penalty

### 5.2 Reciprocal Engagement Dampening

If Agent A ↔ Agent B repeatedly endorse/comment only on each other:

```
engagement_weight *= reciprocal_penalty
```

### 5.3 Burst Detection

Detect abnormal time clustering:
- Z-score over rolling window
- If > threshold → temporary dampening

### 5.4 Platform Trust Weighting

Each platform has: `PlatformTrustScore`

Derived from:
- History
- Fraud incidents
- Volume legitimacy
- Registration age

All submitted actions scaled by platform trust.

---

## 6. SDK Design

Package: `@coinpayportal/trust-sdk`

### 6.1 Submit Action

```typescript
submitActionReceipt(receipt)
```

Validates:
- Signature
- Schema
- Platform registration
- Required fields

### 6.2 Get Trust Profile

```typescript
getTrustProfile(subjectDid)
```

Returns:

```json
{
  "economic_score": 0,
  "productivity_score": 0,
  "behavioral_score": 0,
  "diversity_score": 0,
  "compliance_score": 0,
  "anomaly_flag": false,
  "recency_factor": 0,
  "proofs": []
}
```

### 6.3 Verify Trust Credential

```typescript
verifyCredential(credential)
```

### 6.4 Generate Selective Proof

```typescript
generateProof(subjectDid, { metric: "dispute_rate", max: 0.02 })
```

---

## 7. Revocation & Negative Signals

Supported:
- Receipt revocation
- Credential revocation
- Platform suspension
- Agent downgrade
- Buyer credibility downgrade

Revocation registry is public. Negative signals weighted heavier than positive.

---

## 8. Platform Integration Model

External platforms must:

1. Register DID
2. Declare supported action types
3. Map to canonical categories
4. Use SDK for submission
5. Accept revocation protocol

Optional:
- Use CoinPay escrow for high-trust signals

---

## 9. Phased Implementation

### Phase 1 — Core ← WE ARE HERE
- ActionReceipt schema
- Basic economic signals
- Simple trust vector computation
- SDK submission + query

### Phase 2 — Productivity & Behavioral Signals
- Diminishing returns
- Recency decay
- Diversity multiplier

### Phase 3 — Anti-Collusion Engine
- Graph clustering
- Reciprocal detection
- Burst detection
- Platform trust scoring

### Phase 4 — Advanced
- Slashing bonds
- ZK proof generation
- Cross-chain anchoring
- Weighted verifier policies

---

## 10. Strategic Positioning

**CoinPayPortal becomes:** Escrow + Multi-Signal Portable Trust Infrastructure

**ugig becomes:** Signal producer + trust consumer

Other platforms can integrate without escrow but receive lower signal weight.

---

## 11. Key Design Safeguards

- No universal star rating
- No linear accumulation
- Heavy negative weighting
- Economic anchor dominance
- Diminishing marginal returns
- Time decay
- Public methodology

---

## Gap Analysis: Current Implementation vs Phase 1

### What Exists (CPR Phase 1 + 1.5)
- ✅ DID identity layer (claim, link, manage)
- ✅ Basic reputation receipts (task_id, agent_did, buyer_did, amount, outcome)
- ✅ Simple windowed reputation query (30d/90d/all-time)
- ✅ Anti-gaming flags (circular payments, burst detection, unique buyer check)
- ✅ Verifiable credentials + revocation registry
- ✅ SDK methods (submitReceipt, queryReputation, etc.)
- ✅ CLI commands

### What Needs to Change for CPTL v2 Phase 1
- ❌ ActionReceipt schema (replaces simple receipt schema)
- ❌ Canonical action categories (economic, productivity, identity, social, compliance)
- ❌ Trust vector computation (E/P/B/D/R/A/C dimensions)
- ❌ Economic scaling: `log(1 + value_usd)` weighting
- ❌ Platform DID registration (reputation_issuers → platform trust)
- ❌ `@coinpayportal/trust-sdk` package (separate from current `@profullstack/coinpay`)
- ❌ `getTrustProfile()` returning vector instead of simple windows
- ❌ `submitActionReceipt()` with schema validation
