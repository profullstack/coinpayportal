# CoinPayPortal Escrow Service

## Overview

Anonymous, non-custodial-style escrow for crypto payments. Both humans and AI agents can use it to hold funds in escrow during jobs/gigs. Funds are held in platform-generated HD wallet addresses (same system wallet infrastructure as payments) and released based on escrow conditions.

**Key properties:**
- No KYC — anonymous by default
- API-first — agents can create/fund/release/dispute via API keys
- Multi-chain — supports all chains CoinPayPortal already supports (BTC, BCH, ETH, POL, SOL, USDC_*)
- Platform fee — same 0.5-1% fee structure as payments
- Metadata-rich — store job descriptions, milestones, deliverables in Supabase JSONB

## Terminology

| Term | Definition |
|------|-----------|
| **Depositor** | Party funding the escrow (client/buyer) |
| **Beneficiary** | Party receiving funds on completion (worker/seller) |
| **Escrow Address** | Platform-generated HD wallet address holding the funds |
| **Arbiter** | Optional third-party who can resolve disputes (defaults to platform) |

## Escrow Lifecycle

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│ CREATED  │────>│ FUNDED   │────>│ RELEASED │────>│ SETTLED  │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                      │                                  ▲
                      │           ┌──────────┐           │
                      └──────────>│ DISPUTED │───────────┘
                      │           └──────────┘
                      │           ┌──────────┐
                      └──────────>│ REFUNDED │
                      │           └──────────┘
                      │           ┌──────────┐
                      └──────────>│ EXPIRED  │
                                  └──────────┘
```

### States

| State | Description |
|-------|-------------|
| `created` | Escrow created, awaiting deposit |
| `funded` | Deposit confirmed on-chain at escrow address |
| `released` | Depositor approved release to beneficiary |
| `settled` | Funds forwarded to beneficiary wallet (terminal) |
| `disputed` | One party raised a dispute |
| `refunded` | Funds returned to depositor (terminal) |
| `expired` | Deposit never arrived within timeout (terminal) |

## Flow

### 1. Create Escrow
Depositor creates escrow with: amount, chain, beneficiary wallet, optional metadata.
- System generates a fresh HD wallet address (same as payment address generation)
- Returns escrow ID + deposit address
- Escrow timeout: configurable, default 24h for deposit

### 2. Fund Escrow
Depositor sends crypto to the escrow address.
- Monitored same way as payments (cron balance checker)
- Once confirmed → status moves to `funded`
- Webhook fires: `escrow.funded`

### 3. Release / Dispute / Refund
- **Release**: Depositor calls release endpoint → funds forwarded to beneficiary minus platform fee → `settled`
- **Dispute**: Either party disputes → `disputed` → arbiter resolves (release or refund)
- **Refund**: Depositor requests refund (only before release) → funds returned minus gas → `refunded`
- **Expire**: If not funded within timeout → `expired` (no funds to move)

### 4. Settlement
On release or dispute resolution:
- Platform takes fee (0.5% paid tier / 1% free tier)
- Remainder forwarded to beneficiary (release) or depositor (refund)
- Uses same forwarding infrastructure as payment forwarding
- Webhook fires: `escrow.settled` or `escrow.refunded`

## Database Schema

### `escrows` table

```sql
CREATE TABLE escrows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Parties (wallet addresses, not user accounts — anonymous)
    depositor_address TEXT NOT NULL,         -- where refunds go
    beneficiary_address TEXT NOT NULL,       -- where releases go
    arbiter_address TEXT,                    -- optional dispute resolver

    -- Escrow address (platform-generated)
    escrow_address_id UUID REFERENCES payment_addresses(id),
    escrow_address TEXT NOT NULL,

    -- Amounts
    chain TEXT NOT NULL,                     -- BTC, ETH, SOL, etc.
    amount NUMERIC(30, 18) NOT NULL,         -- expected deposit amount (crypto)
    amount_usd NUMERIC(20, 2),              -- USD equivalent at creation
    fee_amount NUMERIC(30, 18),             -- platform fee taken on settlement
    deposited_amount NUMERIC(30, 18),       -- actual amount received

    -- Status
    status TEXT NOT NULL DEFAULT 'created' CHECK (status IN (
        'created', 'funded', 'released', 'settled',
        'disputed', 'refunded', 'expired'
    )),

    -- Tx hashes
    deposit_tx_hash TEXT,
    settlement_tx_hash TEXT,
    fee_tx_hash TEXT,

    -- Metadata (job description, milestones, deliverables, etc.)
    metadata JSONB DEFAULT '{}'::jsonb,
    dispute_reason TEXT,
    dispute_resolution TEXT,

    -- Auth
    depositor_api_key TEXT,                 -- optional API key for depositor actions
    beneficiary_api_key TEXT,               -- optional API key for beneficiary actions
    release_token TEXT,                     -- secret token depositor uses to release

    -- Business association (optional — for merchants using escrow)
    business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    funded_at TIMESTAMPTZ,
    released_at TIMESTAMPTZ,
    settled_at TIMESTAMPTZ,
    disputed_at TIMESTAMPTZ,
    refunded_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours'),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_escrows_status ON escrows(status);
CREATE INDEX idx_escrows_chain ON escrows(chain);
CREATE INDEX idx_escrows_escrow_address ON escrows(escrow_address);
CREATE INDEX idx_escrows_depositor ON escrows(depositor_address);
CREATE INDEX idx_escrows_beneficiary ON escrows(beneficiary_address);
CREATE INDEX idx_escrows_business_id ON escrows(business_id);
CREATE INDEX idx_escrows_expires_at ON escrows(expires_at);
CREATE INDEX idx_escrows_created_at ON escrows(created_at DESC);
```

### `escrow_events` table (audit log)

```sql
CREATE TABLE escrow_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escrow_id UUID NOT NULL REFERENCES escrows(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'created', 'funded', 'released', 'settled',
        'disputed', 'dispute_resolved', 'refunded', 'expired',
        'metadata_updated'
    )),
    actor TEXT,                              -- address or 'system' or 'arbiter'
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_escrow_events_escrow_id ON escrow_events(escrow_id);
CREATE INDEX idx_escrow_events_type ON escrow_events(event_type);
```

## API Endpoints

### Public (no auth required — anonymous escrow creation)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/escrow` | Create new escrow |
| `GET` | `/api/escrow/:id` | Get escrow status (public view) |
| `GET` | `/api/escrow/:id/events` | Get escrow event log |

### Depositor Actions (auth via release_token or API key)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/escrow/:id/release` | Release funds to beneficiary |
| `POST` | `/api/escrow/:id/refund` | Request refund (before release) |
| `POST` | `/api/escrow/:id/dispute` | Open dispute |

### Beneficiary Actions (auth via beneficiary_api_key or signature)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/escrow/:id/dispute` | Open dispute |

### Arbiter Actions (auth via arbiter signature)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/escrow/:id/resolve` | Resolve dispute (release or refund) |

### Merchant/Business (auth via JWT or API key)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/escrow` | List escrows for business |
| `POST` | `/api/escrow` | Create escrow tied to business |

## Auth Model

Escrows are **anonymous by default**:
- `release_token` — random secret returned on creation, used by depositor to release/refund
- `beneficiary_api_key` — optional, for agents to poll status
- Wallet signature — alternative auth by signing a challenge with the party's wallet key

For merchants with CoinPayPortal accounts:
- Standard JWT/API key auth works
- Escrow tied to their `business_id`

## SDK Integration

```javascript
import { CoinPay } from '@profullstack/coinpay';

const client = new CoinPay({ apiKey: 'your-key', baseUrl: 'https://coinpayportal.com' });

// Create escrow
const escrow = await client.escrow.create({
  chain: 'SOL',
  amount: 0.5,
  depositorAddress: 'depositor-wallet-address',
  beneficiaryAddress: 'worker-wallet-address',
  metadata: {
    job: 'Code review for auth module',
    deliverable: 'PR with fixes',
    deadline: '2026-02-10'
  }
});
// Returns: { id, escrowAddress, releaseToken, status: 'created' }

// Check status
const status = await client.escrow.get(escrow.id);

// Release funds (depositor approves work)
await client.escrow.release(escrow.id, { releaseToken: escrow.releaseToken });

// Dispute
await client.escrow.dispute(escrow.id, {
  releaseToken: escrow.releaseToken,
  reason: 'Work not delivered'
});
```

## Agent Integration (ugig.net / toku.agency)

Agents create escrows via the REST API or SDK:

```bash
# Create escrow for a gig
curl -X POST https://coinpayportal.com/api/escrow \
  -H "Content-Type: application/json" \
  -d '{
    "chain": "SOL",
    "amount": 0.05,
    "depositor_address": "ClientWalletAddr...",
    "beneficiary_address": "AgentWalletAddr...",
    "metadata": {
      "platform": "ugig.net",
      "gig_id": "abc-123",
      "description": "Fix login bug"
    }
  }'

# Release after work delivered
curl -X POST https://coinpayportal.com/api/escrow/{id}/release \
  -H "Content-Type: application/json" \
  -d '{"release_token": "tok_..."}'
```

## Webhooks

Reuses existing webhook infrastructure. New events:

| Event | Fired When |
|-------|-----------|
| `escrow.created` | New escrow created |
| `escrow.funded` | Deposit confirmed on-chain |
| `escrow.released` | Depositor approved release |
| `escrow.settled` | Funds forwarded to beneficiary |
| `escrow.disputed` | Dispute opened |
| `escrow.resolved` | Dispute resolved |
| `escrow.refunded` | Funds returned to depositor |
| `escrow.expired` | Deposit timeout reached |

## Monitoring

Escrow addresses monitored by the same cron balance checker that monitors payments:
- Check `escrows` with status `created` for incoming deposits
- On confirmed deposit → update to `funded`
- Check `escrows` with status `created` past `expires_at` → update to `expired`

## Fee Structure

Same as payments:
- **Free tier**: 1% platform fee on settlement
- **Paid tier**: 0.5% platform fee on settlement
- Fee taken from the escrow amount before forwarding
- Gas/network fees borne by the escrow (deducted from settlement)

## Implementation Order

1. **Migration** — `escrows` + `escrow_events` tables
2. **Service** — `src/lib/escrow/service.ts` (create, fund, release, dispute, refund, expire)
3. **API routes** — `src/app/api/escrow/` (CRUD + actions)
4. **Monitor integration** — Add escrow address checking to existing cron
5. **SDK methods** — `client.escrow.*` in `@profullstack/coinpay`
6. **UI** — Escrow dashboard page for merchants
7. **Webhooks** — Wire up escrow events to webhook system
8. **Tests** — Unit + integration tests for all flows

## Open Questions

1. **Dispute resolution**: Default to platform as arbiter? Or require explicit arbiter address?
2. **Partial release**: Support milestone-based partial releases? (v2)
3. **Time-locked release**: Auto-release after N days if no dispute? (prevents funds stuck forever)
4. **Multi-sig**: Future option for on-chain multi-sig escrow instead of platform-held? (v2)
