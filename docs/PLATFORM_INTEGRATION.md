# Platform Integration Guide — CoinPayPortal Trust Protocol (CPTL)

## Overview

External platforms (ugig.net, etc.) can submit reputation signals to CoinPayPortal's trust protocol. These signals contribute to a user's portable, cross-platform trust profile anchored by their DID.

## Architecture

```
┌─────────────┐     Platform Action API      ┌──────────────────┐
│  ugig.net   │ ──── POST /api/reputation ──→ │  CoinPayPortal   │
│  (platform) │      /platform-action         │  (trust engine)  │
└─────────────┘                               └──────────────────┘
       │                                              │
       │  User links DID                    Trust vector updated
       │  on profile edit                   Credentials issued
       ▼                                              ▼
┌─────────────┐                               ┌──────────────────┐
│ User claims │  ← did:key:z6Mk...  →        │  GET /api/rep/   │
│ DID on      │                               │  agent/{did}     │
│ coinpayportal│                              │  (query profile) │
└─────────────┘                               └──────────────────┘
```

## Setup

### 1. Register as Platform Issuer

Contact CoinPayPortal to register. You'll receive:
- **Platform DID**: `did:web:yourplatform.com`
- **API Key**: `cprt_yourplatform_<hex>`

### 2. Environment Variables

```env
COINPAYPORTAL_API_URL=https://coinpayportal.com
COINPAYPORTAL_API_KEY=cprt_yourplatform_...
```

### 3. User DID Linking

Users claim a DID on [coinpayportal.com/reputation/did](https://coinpayportal.com/reputation/did), then paste it into your platform's profile settings.

## API Reference

### Submit Platform Action

```
POST /api/reputation/platform-action
Authorization: Bearer <api_key>
Content-Type: application/json

{
  "agent_did": "did:key:z6Mk...",       // User's DID (required)
  "action_category": "social.post",      // Canonical category (required)
  "action_type": "feed_post",            // Specific type (optional)
  "metadata": { ... },                   // Arbitrary metadata (optional)
  "value_usd": 0                         // Economic value if applicable (optional)
}
```

**Response (201):**
```json
{ "success": true, "receipt_id": "uuid" }
```

**Errors:**
- `401` — Invalid or missing API key
- `400` — Validation error (invalid DID, unknown category, etc.)

### Query Trust Profile

```
GET /api/reputation/agent/<did>
```

Returns trust score, trust vector (7 dimensions), and windowed stats.

### Get Badge

```
GET /api/reputation/badge/<did>
```

Returns an SVG badge (shields.io style) showing trust score.

## Canonical Action Categories

| Category | Weight | Use For |
|---|---|---|
| `economic.transaction` | 10 | Completed payments, hires |
| `economic.dispute` | -12 | Payment disputes |
| `economic.refund` | -2 | Refunds |
| `productivity.task` | 3 | Task assignments |
| `productivity.application` | 1 | Job applications |
| `productivity.completion` | 5 | Completed work |
| `identity.profile_update` | 0.5 | Profile completions |
| `identity.verification` | 3 | Email/ID verification |
| `social.post` | 0.05 | Feed posts |
| `social.comment` | 0.02 | Comments |
| `social.endorsement` | 1 | Endorsements/reviews |
| `compliance.incident` | -5 | Reports |
| `compliance.violation` | -20 | Bans/violations |

## Recommended Mappings for ugig.net

| ugig.net Action | action_category | action_type | value_usd |
|---|---|---|---|
| Profile completed | `identity.profile_update` | `profile_completed` | — |
| Email verified | `identity.verification` | `email_verified` | — |
| Resume uploaded | `identity.profile_update` | `resume_uploaded` | — |
| Gig posted | `productivity.task` | `gig_posted` | — |
| Application submitted | `productivity.application` | `application_submitted` | — |
| Hired for gig | `productivity.completion` | `hired` | gig value |
| Post created | `social.post` | `feed_post` | — |
| Comment created | `social.comment` | `comment` | — |
| Endorsement given | `social.endorsement` | `endorsement` | — |

## Trust Vector Dimensions

The trust engine computes a 7-dimension vector for each DID:

- **E** (Economic) — Transaction history, payment reliability
- **P** (Productivity) — Task completion, work quality
- **B** (Behavioral) — Platform conduct
- **D** (Dispute) — Conflict history
- **R** (Recency) — Recent activity freshness
- **A** (Activity) — Volume/consistency of engagement
- **C** (Cross-platform) — Multi-platform participation (boosted when signals come from multiple issuers)

## Rate Limits

- 100 requests/minute per API key
- Duplicate `agent_did + action_category + action_type` within 60s are deduplicated

## Security

- API keys are per-platform, revocable
- All receipts are signed by the platform's key
- Receipts are immutable once stored
- Platform actions carry lower base weight than escrow-backed economic transactions
