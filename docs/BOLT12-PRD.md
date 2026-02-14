# BOLT12 Lightning Network Support — Product Requirements Document

**Version:** 1.0  
**Date:** 2026-02-14  
**Status:** Draft  
**Author:** CoinPay Engineering  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Architecture](#3-architecture)
4. [API Design](#4-api-design)
5. [Database Schema](#5-database-schema)
6. [Frontend Changes](#6-frontend-changes)
7. [Infrastructure Requirements](#7-infrastructure-requirements)
8. [Security Considerations](#8-security-considerations)
9. [Migration Plan](#9-migration-plan)
10. [Timeline Estimates](#10-timeline-estimates)
11. [Risks and Mitigations](#11-risks-and-mitigations)
12. [Dependencies and Open Questions](#12-dependencies-and-open-questions)

---

## 1. Executive Summary

This PRD defines the integration of BOLT12 (Lightning Offers) into CoinPay Portal, enabling merchants to receive Lightning Network payments via static, reusable payment offers. Unlike BOLT11 invoices which are single-use and expire, BOLT12 offers are permanent payment endpoints — analogous to on-chain addresses but for Lightning.

**Scope:** Receive-side only. Merchants create BOLT12 offers via CoinPay; customers pay using any BOLT12-compatible wallet. CoinPay operates a Core Lightning (CLN) node cluster that manages the offer lifecycle, settles payments, and fires webhooks to merchants.

**Key value proposition:** A merchant deploys a single QR code (the offer) that works forever — no invoice expiration, no session management, no polling. Customers scan, their wallet negotiates an invoice via the BOLT12 `invoice_request`/`invoice` flow, and payment settles instantly.

---

## 2. Problem Statement

### 2.1 Why Lightning for CoinPay

CoinPay currently supports on-chain payments across BTC, BCH, ETH, POL, SOL, and stablecoins. On-chain BTC payments have:

- **Slow confirmation** (10–60 min for 1–6 confirmations)
- **High fees** during congestion ($2–$50+)
- **Address reuse concerns** with HD wallets for payment tracking

Lightning eliminates all three: sub-second settlement, sub-cent fees, native payment correlation.

### 2.2 Why BOLT12 over BOLT11

| Concern | BOLT11 | BOLT12 |
|---|---|---|
| **Reusability** | Single-use; new invoice per payment | Static offer; unlimited payments |
| **Expiration** | Expires (typically 1h) | Never expires |
| **Payer privacy** | Payer identity leaked to routing nodes | Blinded reply paths hide payer |
| **Receiver privacy** | Node pubkey embedded in invoice | Blinded paths hide receiver node |
| **Amount flexibility** | Fixed amount baked in | Payer specifies amount (or offer sets it) |
| **Recurring payments** | Not natively supported | Built-in recurrence fields |
| **Server requirement** | Merchant must be online to generate invoices | Offer is static; CLN handles negotiation |
| **Proof of payment** | HMAC-based, limited | Schnorr-signed invoice = cryptographic receipt |

**BOLT11 is fundamentally broken for merchant use:** it requires the merchant's backend to generate a fresh invoice for every checkout, manage expiration/retry logic, and correlate payments to sessions. BOLT12 collapses this into a static string.

### 2.3 Current Architecture Gap

CoinPay's payment flow (`src/lib/payments/service.ts`) currently:

1. Creates a payment record with a unique on-chain `payment_address` via `generatePaymentAddress()`
2. Monitors for incoming transactions
3. Confirms and webhooks the merchant

Lightning requires a fundamentally different model: there's no "address" to watch — instead, CLN manages the invoice negotiation and emits events when payment settles. CoinPay needs a new service layer that bridges CLN's event model to our existing payment/webhook infrastructure.

---

## 3. Architecture

### 3.1 High-Level System Design

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Merchant    │────▶│  CoinPay Portal  │────▶│   CLN Node  │
│  Dashboard   │     │  (Next.js API)   │◀────│  (lightningd)│
└─────────────┘     └──────────────────┘     └──────┬──────┘
                           │    ▲                    │
                           │    │ gRPC/Unix socket   │
                           ▼    │                    ▼
                    ┌──────────────────┐     ┌─────────────┐
                    │    Supabase      │     │  Lightning   │
                    │  (PostgreSQL)    │     │  Network     │
                    └──────────────────┘     └─────────────┘
                           │
                           ▼
                    ┌──────────────────┐
                    │  Webhook Worker  │───▶ Merchant backend
                    └──────────────────┘
```

### 3.2 Component Breakdown

#### 3.2.1 CLN Node Service (`src/lib/lightning/cln-client.ts`)

A TypeScript client wrapping CLN's JSON-RPC interface (via Unix socket or gRPC via `cln-grpc`).

```typescript
// src/lib/lightning/cln-client.ts
import { ClnClient } from './rpc';

export interface OfferCreateParams {
  amount_msat?: string;       // e.g. "10000msat" or "any" for variable
  description: string;
  label: string;              // CoinPay internal label (offer UUID)
  absolute_expiry?: number;   // Unix timestamp, optional
  quantity_max?: number;      // For limited-use offers
  blinded_paths?: boolean;    // Default true — use blinded reply paths
}

export interface OfferResult {
  offer_id: string;           // CLN's internal offer hash
  bolt12: string;             // The bech32m-encoded offer string
  active: boolean;
  single_use: boolean;
  used: boolean;
}

export interface InvoicePaidEvent {
  label: string;
  payment_hash: string;
  amount_msat: number;
  amount_received_msat: number;
  pay_index: number;
  payment_preimage: string;
  bolt12: string;             // The offer that generated this
  payer_note?: string;
}

export class CLNService {
  private client: ClnClient;

  constructor(socketPath: string) {
    this.client = new ClnClient(socketPath);
  }

  async createOffer(params: OfferCreateParams): Promise<OfferResult> {
    return this.client.call('offer', {
      amount: params.amount_msat || 'any',
      description: params.description,
      label: params.label,
      absolute_expiry: params.absolute_expiry,
      quantity_max: params.quantity_max,
    });
  }

  async disableOffer(offerId: string): Promise<void> {
    await this.client.call('disableoffer', { offer_id: offerId });
  }

  async listOffers(activeOnly?: boolean): Promise<OfferResult[]> {
    const result = await this.client.call('listoffers', {
      active_only: activeOnly,
    });
    return result.offers;
  }

  async waitAnyInvoice(lastPayIndex?: number): Promise<InvoicePaidEvent> {
    return this.client.call('waitanyinvoice', {
      lastpay_index: lastPayIndex,
    });
  }

  async getInfo(): Promise<{ id: string; alias: string; num_peers: number }> {
    return this.client.call('getinfo', {});
  }
}
```

#### 3.2.2 CLN RPC Transport (`src/lib/lightning/rpc.ts`)

Low-level JSON-RPC over Unix domain socket:

```typescript
// src/lib/lightning/rpc.ts
import net from 'node:net';

export class ClnClient {
  constructor(private socketPath: string) {}

  async call<T = any>(method: string, params: Record<string, any>): Promise<T> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      const id = Math.random().toString(36).slice(2);
      const request = JSON.stringify({ jsonrpc: '2.0', id, method, params });

      let data = '';
      socket.on('data', chunk => { data += chunk.toString(); });
      socket.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(parsed.error.message));
          else resolve(parsed.result as T);
        } catch (e) { reject(e); }
      });
      socket.on('error', reject);
      socket.write(request);
      socket.end();
    });
  }
}
```

#### 3.2.3 Payment Settlement Worker (`src/lib/lightning/settlement-worker.ts`)

A long-running process (or serverless cron) that polls `waitanyinvoice` and processes settled payments:

```typescript
// src/lib/lightning/settlement-worker.ts
export class SettlementWorker {
  private lastPayIndex: number = 0;
  private running = false;

  constructor(
    private cln: CLNService,
    private supabase: SupabaseClient,
    private webhookService: WebhookDeliveryService,
  ) {}

  async start(): Promise<void> {
    this.running = true;
    // Resume from last known pay_index
    const { data } = await this.supabase
      .from('ln_settlement_state')
      .select('last_pay_index')
      .single();
    this.lastPayIndex = data?.last_pay_index || 0;

    while (this.running) {
      try {
        const event = await this.cln.waitAnyInvoice(this.lastPayIndex);
        await this.processPayment(event);
        this.lastPayIndex = event.pay_index;
        await this.supabase
          .from('ln_settlement_state')
          .upsert({ id: 1, last_pay_index: this.lastPayIndex });
      } catch (err) {
        console.error('Settlement worker error:', err);
        await sleep(5000);
      }
    }
  }

  private async processPayment(event: InvoicePaidEvent): Promise<void> {
    // 1. Look up the offer by label (our offer UUID)
    const { data: offer } = await this.supabase
      .from('ln_offers')
      .select('*')
      .eq('id', event.label)
      .single();

    if (!offer) {
      console.warn(`Unknown offer label: ${event.label}`);
      return;
    }

    // 2. Insert payment record
    const payment = {
      id: crypto.randomUUID(),
      offer_id: offer.id,
      business_id: offer.business_id,
      payment_hash: event.payment_hash,
      payment_preimage: event.payment_preimage,
      amount_msat: event.amount_received_msat,
      amount_sat: Math.floor(event.amount_received_msat / 1000),
      payer_note: event.payer_note,
      pay_index: event.pay_index,
      status: 'settled',
      settled_at: new Date().toISOString(),
    };

    await this.supabase.from('ln_payments').insert(payment);

    // 3. Fire webhook
    await this.webhookService.deliver(offer.business_id, {
      event: 'lightning.payment.settled',
      payment,
    });
  }

  stop(): void {
    this.running = false;
  }
}
```

#### 3.2.4 Webhook Delivery Service (`src/lib/lightning/webhook-delivery.ts`)

Follows the existing pattern from `src/lib/wallet-sdk/types.ts` (WebhookRegistration) and the Stripe webhook route patterns:

```typescript
// src/lib/lightning/webhook-delivery.ts
export class WebhookDeliveryService {
  constructor(private supabase: SupabaseClient) {}

  async deliver(businessId: string, payload: WebhookPayload): Promise<void> {
    // Get all active webhook endpoints for this business
    const { data: endpoints } = await this.supabase
      .from('webhook_endpoints')
      .select('*')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .contains('events', ['lightning.payment.settled']);

    for (const endpoint of endpoints || []) {
      const signature = this.sign(payload, endpoint.secret);
      await this.attemptDelivery(endpoint, payload, signature);
    }
  }

  private sign(payload: WebhookPayload, secret: string): string {
    const hmac = createHmac('sha256', secret);
    hmac.update(JSON.stringify(payload));
    return hmac.digest('hex');
  }

  private async attemptDelivery(
    endpoint: any,
    payload: WebhookPayload,
    signature: string,
    attempt = 1,
  ): Promise<void> {
    // Insert delivery attempt
    const deliveryId = crypto.randomUUID();
    await this.supabase.from('webhook_deliveries').insert({
      id: deliveryId,
      endpoint_id: endpoint.id,
      payload,
      attempt,
      status: 'pending',
    });

    try {
      const res = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CoinPay-Signature': signature,
          'X-CoinPay-Event': payload.event,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });

      await this.supabase.from('webhook_deliveries').update({
        status: res.ok ? 'delivered' : 'failed',
        response_status: res.status,
        delivered_at: new Date().toISOString(),
      }).eq('id', deliveryId);

      // Retry with exponential backoff (up to 5 attempts)
      if (!res.ok && attempt < 5) {
        setTimeout(() => this.attemptDelivery(endpoint, payload, signature, attempt + 1),
          Math.pow(2, attempt) * 1000);
      }
    } catch (err) {
      await this.supabase.from('webhook_deliveries').update({
        status: 'failed',
        error: (err as Error).message,
      }).eq('id', deliveryId);
    }
  }
}
```

### 3.3 Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| CLN over LND | CLN (Core Lightning) | Best BOLT12 support; offers are a first-class CLN feature since v23.08. LND has no BOLT12. |
| RPC transport | Unix socket JSON-RPC | Lowest latency, no TLS overhead, CLN runs co-located. gRPC as fallback for remote nodes. |
| Settlement model | `waitanyinvoice` long-poll | Event-driven, no polling interval. Missed events recovered via `lastpay_index`. |
| Offer per merchant vs shared | One CLN offer per CoinPay offer | 1:1 mapping. Label = offer UUID. Clean separation. |
| Node topology | Single CLN node (MVP) → cluster (Phase 3) | Start simple. CLN supports `hsmd` remote signing for future HA. |

---

## 4. API Design

All endpoints follow CoinPay's existing patterns: Bearer JWT or API key auth via `src/lib/auth/middleware.ts`, JSON responses with `{ success, data?, error? }` envelope.

### 4.1 Offer Management

#### `POST /api/lightning/offers`

Create a new BOLT12 offer for a business.

```typescript
// src/app/api/lightning/offers/route.ts

// Request
{
  "business_id": "uuid",
  "description": "Payment to Acme Corp",
  "amount_sats": 0,           // 0 = any amount (payer chooses)
  "currency": "BTC",          // For display; LN is always BTC
  "metadata": { "sku": "..." },
  "single_use": false,
  "expiry_timestamp": null     // null = never expires
}

// Response 201
{
  "success": true,
  "data": {
    "id": "uuid",
    "business_id": "uuid",
    "bolt12": "lno1qgsq...",   // The offer string
    "offer_id": "abc123...",   // CLN's offer hash
    "description": "Payment to Acme Corp",
    "amount_sats": 0,
    "status": "active",
    "created_at": "2026-02-14T14:00:00Z"
  }
}
```

#### `GET /api/lightning/offers`

List offers for a business.

```
GET /api/lightning/offers?business_id=uuid&status=active&limit=20&offset=0
```

```typescript
// Response 200
{
  "success": true,
  "data": {
    "offers": [
      {
        "id": "uuid",
        "bolt12": "lno1qgsq...",
        "description": "...",
        "amount_sats": 0,
        "status": "active",
        "total_received_sats": 150000,
        "payment_count": 12,
        "created_at": "...",
        "last_payment_at": "..."
      }
    ],
    "total": 1,
    "limit": 20,
    "offset": 0
  }
}
```

#### `GET /api/lightning/offers/[id]`

Get offer details including recent payments.

#### `PATCH /api/lightning/offers/[id]`

Update offer metadata or disable it.

```typescript
// Request
{ "status": "disabled" }  // or { "description": "Updated description" }

// Response 200
{ "success": true, "data": { ... } }
```

#### `DELETE /api/lightning/offers/[id]`

Disable and archive an offer (soft delete — CLN offers can be disabled but not truly deleted).

### 4.2 Payment Status

#### `GET /api/lightning/payments`

List Lightning payments for a business.

```
GET /api/lightning/payments?business_id=uuid&offer_id=uuid&status=settled&limit=50&offset=0
```

```typescript
// Response 200
{
  "success": true,
  "data": {
    "payments": [
      {
        "id": "uuid",
        "offer_id": "uuid",
        "payment_hash": "hex...",
        "amount_sats": 15000,
        "amount_msat": 15000000,
        "status": "settled",
        "payer_note": "Order #1234",
        "settled_at": "2026-02-14T14:05:00Z"
      }
    ],
    "total": 1,
    "limit": 50,
    "offset": 0
  }
}
```

#### `GET /api/lightning/payments/[id]`

Get single payment details including preimage (proof of payment).

```typescript
// Response 200
{
  "success": true,
  "data": {
    "id": "uuid",
    "offer_id": "uuid",
    "business_id": "uuid",
    "payment_hash": "hex...",
    "payment_preimage": "hex...",
    "amount_sats": 15000,
    "amount_msat": 15000000,
    "payer_note": "Order #1234",
    "status": "settled",
    "pay_index": 42,
    "settled_at": "2026-02-14T14:05:00Z",
    "created_at": "2026-02-14T14:05:00Z"
  }
}
```

### 4.3 Node Health

#### `GET /api/lightning/node/status`

Internal/admin endpoint for monitoring.

```typescript
// Response 200
{
  "success": true,
  "data": {
    "node_id": "02abc...",
    "alias": "coinpay-ln-01",
    "num_peers": 15,
    "num_channels": 8,
    "total_capacity_sats": 50000000,
    "inbound_capacity_sats": 30000000,
    "block_height": 890123,
    "synced": true
  }
}
```

### 4.4 Public Payment Page

#### `GET /api/lightning/pay/[offer_id]`

Public (no auth) endpoint that returns offer details for the customer-facing payment page.

```typescript
// Response 200
{
  "success": true,
  "data": {
    "bolt12": "lno1qgsq...",
    "description": "Payment to Acme Corp",
    "amount_sats": 0,       // 0 = variable
    "business_name": "Acme Corp",
    "status": "active"
  }
}
```

### 4.5 Webhook Events

Events delivered to merchant webhook endpoints:

| Event | Trigger |
|---|---|
| `lightning.payment.settled` | Payment received and settled |
| `lightning.offer.created` | New offer created |
| `lightning.offer.disabled` | Offer disabled |

**Webhook payload:**

```json
{
  "event": "lightning.payment.settled",
  "timestamp": "2026-02-14T14:05:00Z",
  "data": {
    "payment_id": "uuid",
    "offer_id": "uuid",
    "amount_sats": 15000,
    "amount_msat": 15000000,
    "payment_hash": "hex...",
    "payment_preimage": "hex...",
    "payer_note": "Order #1234"
  }
}
```

**Headers:**

```
X-CoinPay-Signature: sha256=<HMAC of body with endpoint secret>
X-CoinPay-Event: lightning.payment.settled
X-CoinPay-Delivery: <delivery-uuid>
```

---

## 5. Database Schema

### 5.1 Migration: `20260220000000_lightning_bolt12.sql`

```sql
-- ============================================================
-- BOLT12 Lightning Network Support
-- ============================================================

-- Lightning offers (BOLT12)
CREATE TABLE ln_offers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  
  -- CLN offer data
  cln_offer_id  text NOT NULL,              -- CLN's internal offer hash
  bolt12        text NOT NULL,              -- Full bech32m-encoded offer string
  
  -- Offer configuration
  description   text NOT NULL,
  amount_msat   bigint,                     -- NULL = any amount (payer chooses)
  single_use    boolean DEFAULT false,
  
  -- State
  status        text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'disabled', 'archived')),
  
  -- Aggregates (denormalized for dashboard performance)
  total_received_msat  bigint DEFAULT 0,
  payment_count        integer DEFAULT 0,
  last_payment_at      timestamptz,
  
  -- Metadata
  metadata      jsonb DEFAULT '{}',
  expires_at    timestamptz,                -- NULL = never
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_ln_offers_business_id ON ln_offers(business_id);
CREATE INDEX idx_ln_offers_status ON ln_offers(status);
CREATE INDEX idx_ln_offers_cln_offer_id ON ln_offers(cln_offer_id);
CREATE UNIQUE INDEX idx_ln_offers_bolt12 ON ln_offers(bolt12);

-- Lightning payments (settled invoices from BOLT12 offers)
CREATE TABLE ln_payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id            uuid NOT NULL REFERENCES ln_offers(id) ON DELETE CASCADE,
  business_id         uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  
  -- Payment data from CLN
  payment_hash        text NOT NULL UNIQUE,
  payment_preimage    text NOT NULL,
  amount_msat         bigint NOT NULL,
  amount_sat          bigint GENERATED ALWAYS AS (amount_msat / 1000) STORED,
  
  -- Optional payer metadata
  payer_note          text,
  payer_key           text,                 -- Payer's ephemeral key (if provided)
  
  -- Settlement tracking  
  pay_index           integer NOT NULL,      -- CLN's monotonic pay index
  status              text NOT NULL DEFAULT 'settled'
                      CHECK (status IN ('settled', 'forwarded', 'failed')),
  
  -- Timestamps
  settled_at          timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX idx_ln_payments_offer_id ON ln_payments(offer_id);
CREATE INDEX idx_ln_payments_business_id ON ln_payments(business_id);
CREATE INDEX idx_ln_payments_payment_hash ON ln_payments(payment_hash);
CREATE INDEX idx_ln_payments_pay_index ON ln_payments(pay_index);
CREATE INDEX idx_ln_payments_settled_at ON ln_payments(settled_at);

-- Settlement worker state (single-row table for tracking waitanyinvoice cursor)
CREATE TABLE ln_settlement_state (
  id              integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_pay_index  integer NOT NULL DEFAULT 0,
  updated_at      timestamptz DEFAULT now()
);

INSERT INTO ln_settlement_state (id, last_pay_index) VALUES (1, 0);

-- Webhook deliveries for Lightning events  
-- (extends existing webhook_endpoints table if present,
--  or works alongside the Stripe webhook pattern)
CREATE TABLE ln_webhook_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  endpoint_url    text NOT NULL,
  event           text NOT NULL,
  payload         jsonb NOT NULL,
  signature       text NOT NULL,
  
  -- Delivery status
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'delivered', 'failed')),
  attempt         integer DEFAULT 1,
  max_attempts    integer DEFAULT 5,
  response_status integer,
  error           text,
  
  -- Timestamps
  created_at      timestamptz DEFAULT now(),
  delivered_at    timestamptz,
  next_retry_at   timestamptz
);

CREATE INDEX idx_ln_webhook_deliveries_business_id ON ln_webhook_deliveries(business_id);
CREATE INDEX idx_ln_webhook_deliveries_status ON ln_webhook_deliveries(status);
CREATE INDEX idx_ln_webhook_deliveries_next_retry ON ln_webhook_deliveries(next_retry_at)
  WHERE status = 'pending';

-- Trigger to update offer aggregates on payment insert
CREATE OR REPLACE FUNCTION update_offer_aggregates()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE ln_offers SET
    total_received_msat = total_received_msat + NEW.amount_msat,
    payment_count = payment_count + 1,
    last_payment_at = NEW.settled_at,
    updated_at = now()
  WHERE id = NEW.offer_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ln_payment_aggregates
  AFTER INSERT ON ln_payments
  FOR EACH ROW
  EXECUTE FUNCTION update_offer_aggregates();

-- RLS Policies
ALTER TABLE ln_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ln_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ln_webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- Service role has full access (API routes use service role key)
CREATE POLICY ln_offers_service ON ln_offers FOR ALL
  USING (true) WITH CHECK (true);
CREATE POLICY ln_payments_service ON ln_payments FOR ALL
  USING (true) WITH CHECK (true);
CREATE POLICY ln_webhook_deliveries_service ON ln_webhook_deliveries FOR ALL
  USING (true) WITH CHECK (true);
```

### 5.2 Entity Relationship

```
businesses (existing)
    │
    ├──< ln_offers
    │       │
    │       └──< ln_payments
    │
    └──< ln_webhook_deliveries
```

---

## 6. Frontend Changes

### 6.1 Customer Payment Page (`/pay/ln/[offer_id]`)

A new public page (no auth required) for customers to pay a BOLT12 offer:

```
src/app/pay/ln/[offer_id]/page.tsx
```

**UI Components:**

1. **QR Code** — Renders the `bolt12:` URI as a QR code (using existing QR library)
2. **Copy Button** — One-click copy of the bolt12 string
3. **Amount Input** — If offer is variable-amount, customer enters desired amount (informational; the wallet handles the actual amount in the invoice_request)
4. **Status Indicator** — Real-time payment status via SSE or polling:
   - "Waiting for payment..."
   - "Payment received! ✓" (when settled)
5. **Deep Link** — `lightning:lno1qgsq...` URI for mobile wallet auto-open

**Payment status polling:**

```typescript
// src/app/pay/ln/[offer_id]/usePaymentStatus.ts
// Polls GET /api/lightning/payments?offer_id=X&since=<page_load_time>
// Switches to "paid" state when a new payment appears
// Alternative: SSE endpoint for real-time push
```

**Note on UX limitation:** BOLT12 offers are "fire and forget" — the offer doesn't know about a specific checkout session. For session-correlated payments (e.g., "pay exactly 15,000 sats for order #1234"), we create a fixed-amount single-use offer per checkout. The payment page monitors for that specific offer's first payment.

### 6.2 Merchant Dashboard — Lightning Section

New dashboard tab at `/dashboard/lightning`:

```
src/app/dashboard/lightning/page.tsx
src/app/dashboard/lightning/offers/page.tsx
src/app/dashboard/lightning/offers/[id]/page.tsx
src/app/dashboard/lightning/payments/page.tsx
```

**Components:**

- **Offers List** — Table with offer description, bolt12 (truncated), status, total received, payment count, actions (disable/copy/QR)
- **Create Offer Form** — Description, amount (fixed or variable), single-use toggle, expiry
- **Offer Detail** — QR code, full bolt12, payment history for that offer, embed code snippet
- **Payments List** — All Lightning payments across offers, filterable by date/offer/amount
- **Lightning Balance Card** — Total received (all time), last 24h, last 7d

**Embed snippet (for merchants to add to their sites):**

```html
<!-- CoinPay Lightning Payment Button -->
<a href="https://app.coinpay.com/pay/ln/{offer_id}">
  <img src="https://app.coinpay.com/api/lightning/offers/{offer_id}/qr.png" 
       alt="Pay with Lightning" width="200" />
</a>
```

### 6.3 QR Code Generation

#### `GET /api/lightning/offers/[id]/qr.png`

Server-rendered QR code image (public, no auth):

```typescript
// Returns PNG image of the bolt12 offer string
// Query params: ?size=300 (pixels)
// Uses qrcode library (already likely in deps for on-chain payment pages)
```

---

## 7. Infrastructure Requirements

### 7.1 CLN Node

| Requirement | Specification |
|---|---|
| **Software** | Core Lightning ≥ v24.11 (latest stable with full BOLT12) |
| **OS** | Ubuntu 22.04+ or Debian 12 |
| **Hardware (MVP)** | 4 vCPU, 8GB RAM, 500GB NVMe (Bitcoin full node) |
| **Hardware (Production)** | 8 vCPU, 16GB RAM, 1TB NVMe, dedicated SSD for LN DB |
| **Bitcoin backend** | `bitcoind` full node (pruned OK for CLN, but unpruned recommended) |
| **Network** | Static IP, ports 9735 (LN p2p), 9736 (gRPC optional) |
| **Backup** | `hsm_secret` backed up to encrypted cold storage; `lightningd` DB replicated |

### 7.2 CLN Configuration

```ini
# ~/.lightning/config
alias=coinpay-ln
network=bitcoin
log-level=info

# BOLT12
experimental-offers

# Performance
large-channels
max-concurrent-htlcs=30

# Security — blinded paths by default
# (CLN uses blinded paths for offers automatically in modern versions)

# Fee policy (as routing node)
fee-base=1000
fee-per-satoshi=1

# RPC
rpc-file=/run/lightning/lightning-rpc
```

### 7.3 Liquidity / LSP Strategy

Since CoinPay is **receive-only** (merchants receive payments), the critical requirement is **inbound liquidity** — channel capacity on the remote side pointing toward our node.

**Phase 1 (MVP):**
- Open 3–5 channels with well-connected nodes (ACINQ, Blockstream, LNBig)
- Purchase inbound liquidity via LSPs:
  - **Blocktank** (Synonym) — API-driven channel purchases
  - **LN+** — Liquidity triangles (free but manual)
  - **Magma** (Amboss) — Marketplace for inbound channels
- Target: 5 BTC total inbound capacity

**Phase 2:**
- Integrate **LSP (Lightning Service Provider)** for automatic channel management
- Candidates: **Breez SDK** server-side, **Greenlight** (Blockstream's CLN-as-a-service)
- Implement **channel rebalancing** — submarine swaps via Boltz Exchange to move outbound→inbound

**Phase 3:**
- Run multiple CLN nodes behind a load balancer
- CLN's `hsmd` remote signer allows multiple nodes to share keys
- Geographic distribution for latency optimization

### 7.4 Deployment Architecture

```
┌─────────────────────────────────────────────┐
│  Docker Compose / Kubernetes                │
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐│
│  │ bitcoind  │  │  CLN     │  │ Settlement││
│  │ (pruned)  │──│ node     │──│ Worker    ││
│  └──────────┘  └──────────┘  └───────────┘│
│                      │                      │
│                 Unix socket                 │
│                      │                      │
│              ┌───────────────┐              │
│              │  Next.js API  │              │
│              └───────────────┘              │
└─────────────────────────────────────────────┘
```

---

## 8. Security Considerations

### 8.1 Node Key Management

The CLN `hsm_secret` is the master key. Compromise = total fund loss.

- **Storage:** Encrypted at rest (LUKS or AWS KMS envelope encryption)
- **Backup:** Encrypted copy in geographically separate cold storage (e.g., AWS S3 Glacier with KMS)
- **Access:** Only the `lightningd` process reads the HSM secret. No API exposure.
- **Future:** Migrate to CLN's remote `hsmd` signer (separates signing from routing)

### 8.2 Blinded Paths

BOLT12 offers support **blinded reply paths** — the payer's wallet routes the `invoice_request` through intermediate nodes without learning the recipient's node ID or network position.

- **Default ON** for all CoinPay offers
- Protects merchant node from targeted attacks (channel jamming, probing)
- CLN generates blinded paths automatically when `experimental-offers` is enabled

### 8.3 API Security

- All offer management endpoints require authentication (JWT or API key, consistent with existing `src/lib/auth/middleware.ts`)
- Public payment page (`/pay/ln/[id]`) is rate-limited (100 req/min per IP)
- Webhook secrets are HMAC-SHA256, generated per endpoint, stored hashed in DB
- Payment preimages are only exposed to the merchant who owns the offer (not on public endpoints)

### 8.4 CLN RPC Security

- Unix socket only (no TCP exposure)
- Socket permissions: `srw-------` (owner-only, `lightningd` user)
- Next.js API connects via same-host socket; no network traversal
- For remote/multi-node setups: gRPC with mTLS client certificates

### 8.5 Fund Management

- **No custodial holding:** Payments settle in CLN's on-node wallet. Merchants initiate withdrawal (on-chain or LN send) via dashboard.
- **Hot wallet limits:** Configurable max on-node balance. Auto-sweep to cold storage (on-chain) above threshold.
- **Monitoring:** Alert on unexpected large payments, channel force-closes, low inbound capacity.

### 8.6 Denial of Service

- **Channel jamming mitigation:** CLN's built-in HTLC limits (`max-concurrent-htlcs=30`)
- **Offer spam:** Rate-limit offer creation per business (10/day on free tier, unlimited on paid)
- **Invoice request spam:** CLN handles this at protocol level; consider `quantity_max` for public offers

---

## 9. Migration Plan

### Phase 1: MVP — Receive-Only (8 weeks)

**Goal:** Merchants can create BOLT12 offers and receive payments with webhook notifications.

**Deliverables:**
- [ ] CLN node provisioned and synced (bitcoind + lightningd)
- [ ] `src/lib/lightning/` — CLN client, settlement worker
- [ ] Database migration: `ln_offers`, `ln_payments`, `ln_settlement_state`
- [ ] API routes: `POST/GET /api/lightning/offers`, `GET /api/lightning/payments`
- [ ] Public payment page: `/pay/ln/[offer_id]` with QR code
- [ ] Webhook delivery for `lightning.payment.settled`
- [ ] Basic dashboard: list offers, view payments
- [ ] Integration tests against CLN regtest

**Not included in Phase 1:**
- On-chain withdrawal from LN wallet
- Automatic liquidity management
- Multi-node setup
- Amount-locked checkout sessions

### Phase 2: Checkout Integration (4 weeks)

**Goal:** Integrate LN payments into CoinPay's existing checkout flow alongside on-chain options.

**Deliverables:**
- [ ] Unified payment creation: `POST /api/payments/create` accepts `blockchain: 'LN'`
- [ ] Payment page shows both on-chain address AND LN offer (customer chooses)
- [ ] Amount-locked single-use offers for checkout sessions (exact amount, auto-expire)
- [ ] Payment expiration handling for single-use offers
- [ ] Merchant withdrawal: sweep CLN balance to on-chain address
- [ ] Analytics: LN payments in existing dashboard charts (`/api/stripe/analytics` pattern)
- [ ] QR code generation endpoint (`/api/lightning/offers/[id]/qr.png`)

### Phase 3: Production Hardening (4 weeks)

**Goal:** Production-grade reliability and scalability.

**Deliverables:**
- [ ] LSP integration for automatic inbound liquidity
- [ ] Channel monitoring and rebalancing automation
- [ ] Multi-node CLN with `hsmd` remote signer
- [ ] Hot wallet sweep to cold storage
- [ ] Comprehensive monitoring/alerting (node health, channel states, payment volume)
- [ ] Load testing: 100+ concurrent payments
- [ ] Disaster recovery runbook and tested backup restoration

### Phase 4: Advanced Features (6 weeks)

**Goal:** Full Lightning integration with advanced BOLT12 features.

**Deliverables:**
- [ ] Recurring payments (BOLT12 `recurrence` field)
- [ ] Payer identity verification (optional payer_key in offers)
- [ ] LN→LN payouts (pay merchants via Lightning instead of on-chain)
- [ ] Offer templates and embeddable payment widgets
- [ ] Refund flow via BOLT12 (merchant sends to customer's offer)
- [ ] Currency conversion: receive LN, settle as stablecoin (via submarine swap + DEX)

---

## 10. Timeline Estimates

| Phase | Duration | Start | End | Team |
|---|---|---|---|---|
| **Phase 1: MVP** | 8 weeks | Week 1 | Week 8 | 2 backend, 1 frontend, 1 infra |
| **Phase 2: Checkout** | 4 weeks | Week 9 | Week 12 | 2 backend, 1 frontend |
| **Phase 3: Hardening** | 4 weeks | Week 13 | Week 16 | 1 backend, 1 infra/SRE |
| **Phase 4: Advanced** | 6 weeks | Week 17 | Week 22 | 2 backend, 1 frontend |

**Total: ~22 weeks (5.5 months) to full integration.**

**Phase 1 breakdown:**

| Task | Estimate | Dependencies |
|---|---|---|
| CLN node setup + sync | 1 week | Infra provisioning |
| CLN TypeScript client | 1 week | — |
| Database schema + migration | 0.5 weeks | — |
| Offer CRUD API routes | 1 week | CLN client, schema |
| Settlement worker | 1.5 weeks | CLN client, schema |
| Webhook delivery service | 1 week | Schema |
| Payment page frontend | 1 week | Offer API |
| Dashboard (offers + payments) | 1 week | APIs |
| Integration testing (regtest) | 1 week | All above |
| **Buffer** | — | Included in estimates |

---

## 11. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **BOLT12 wallet adoption** — Few consumer wallets support BOLT12 today | Medium | High | Phase 1 is low-cost; monitor wallet ecosystem. Phoenix, Zeus, and CLN-based wallets already support it. BOLT12 adoption is accelerating. |
| **Inbound liquidity shortage** — Can't receive if no inbound capacity | Medium | High | Pre-purchase channels via LSPs. Monitor capacity. Auto-alert at 20% remaining inbound. |
| **CLN node failure** — Single point of failure in MVP | Medium | High | Automated backups (SCB + DB snapshots). Phase 3 adds multi-node HA. |
| **Force-close channel losses** — Funds locked for days during force-close | Low | Medium | Maintain diversified channels (no single large channel). Monitor for force-close triggers. |
| **Payment correlation on public offers** — Variable-amount offers can't easily correlate to specific orders | Medium | Medium | Use single-use fixed-amount offers for checkout sessions. Variable offers are for donation/tip use cases. |
| **Regulatory uncertainty** — Lightning may face regulatory scrutiny | Low | High | CoinPay is non-custodial. Maintain audit trail. Offer KYC hooks for merchants who need them. |
| **CLN breaking changes** — BOLT12 is still "experimental" in CLN | Low | Medium | Pin CLN version. Run regtest CI against target version. Monitor CLN release notes. |
| **Webhook reliability** — Merchant endpoints may be down | Medium | Low | Exponential retry (5 attempts over ~30s). Dead letter queue for inspection. |

---

## 12. Dependencies and Open Questions

### 12.1 External Dependencies

| Dependency | Version | Purpose |
|---|---|---|
| Core Lightning (CLN) | ≥ 24.11 | BOLT12 offer management, payment settlement |
| Bitcoin Core | ≥ 27.0 | Block data for CLN |
| `qrcode` (npm) | latest | QR code generation for offers |
| LSP provider (Blocktank/Magma) | — | Inbound liquidity purchasing |

### 12.2 Internal Dependencies

- **Existing webhook system** — Do we unify LN webhooks with the existing Stripe webhook endpoints table, or keep them separate? **Recommendation:** Separate tables for MVP, unified in Phase 2.
- **Existing payment service** (`src/lib/payments/service.ts`) — Phase 2 needs `Blockchain` type extended with `'LN'` and `CreatePaymentInput` updated.
- **Business/merchant model** — LN offers are per-business, consistent with existing patterns.

### 12.3 Open Questions

1. **Custodial vs non-custodial for LN:** CoinPay's on-chain flow is non-custodial (funds go directly to merchant addresses). LN payments settle on CoinPay's node first, then merchants withdraw. This is technically **custodial** during the settlement window. Do we need a compliance review?

2. **On-chain sweep frequency:** How often should CLN's on-node balance be swept to merchant-controlled addresses? Options:
   - Manual (merchant-initiated)
   - Threshold-based (auto-sweep above X sats)
   - Time-based (daily sweep)

3. **Multi-tenant CLN:** Should each merchant get their own CLN node (true non-custodial via Greenlight), or do we operate a shared node? **Recommendation:** Shared node for MVP (simpler ops), evaluate Greenlight for Phase 4.

4. **BOLT11 fallback:** Should the payment page also display a BOLT11 invoice as fallback for wallets that don't support BOLT12? This would require generating invoices on-demand (negating some BOLT12 benefits) but increases compatibility.

5. **Testnet vs Signet:** Which test network for development? Signet is more stable but has fewer faucets. Regtest for CI, Signet for staging.

6. **Fee model:** Does CoinPay charge a fee on LN payments? On-chain payments have network fees passed through. LN routing fees are negligible (<1 sat). Options:
   - Flat fee per payment (e.g., 1 sat)
   - Percentage (e.g., 0.5%)
   - Free for LN (competitive advantage)

7. **Maximum payment size:** CLN channels have per-channel capacity limits. What's our target max single payment? 1M sats (~$500 at current prices)? This determines channel sizing strategy.

---

## Appendix A: File Structure

```
src/
├── app/
│   ├── api/
│   │   └── lightning/
│   │       ├── offers/
│   │       │   ├── route.ts              # POST (create), GET (list)
│   │       │   └── [id]/
│   │       │       ├── route.ts          # GET, PATCH, DELETE
│   │       │       └── qr.png/
│   │       │           └── route.ts      # GET (QR image)
│   │       ├── payments/
│   │       │   ├── route.ts              # GET (list)
│   │       │   └── [id]/
│   │       │       └── route.ts          # GET (detail)
│   │       ├── node/
│   │       │   └── status/
│   │       │       └── route.ts          # GET (admin)
│   │       └── pay/
│   │           └── [offer_id]/
│   │               └── route.ts          # GET (public)
│   ├── pay/
│   │   └── ln/
│   │       └── [offer_id]/
│   │           └── page.tsx              # Public payment page
│   └── dashboard/
│       └── lightning/
│           ├── page.tsx                  # Overview
│           ├── offers/
│           │   ├── page.tsx              # List
│           │   └── [id]/
│           │       └── page.tsx          # Detail
│           └── payments/
│               └── page.tsx              # History
├── lib/
│   └── lightning/
│       ├── cln-client.ts                 # CLN service wrapper
│       ├── rpc.ts                        # JSON-RPC transport
│       ├── settlement-worker.ts          # Payment processing loop
│       ├── webhook-delivery.ts           # Webhook dispatch
│       ├── types.ts                      # TypeScript types
│       └── __tests__/
│           ├── cln-client.test.ts
│           ├── settlement-worker.test.ts
│           └── webhook-delivery.test.ts
└── supabase/
    └── migrations/
        └── 20260220000000_lightning_bolt12.sql
```

## Appendix B: BOLT12 Offer Format Reference

A BOLT12 offer encodes:

```
lno1 <bech32m encoded TLV>
```

Key TLV fields:
- `offer_chains` — Which chains (default: Bitcoin mainnet)
- `offer_amount` — Fixed amount in msat (omit for any-amount)
- `offer_description` — Human-readable description
- `offer_node_id` — Recipient's node public key (or blinded path)
- `offer_paths` — Blinded paths for privacy
- `offer_quantity_max` — Max number of payments (omit for unlimited)
- `offer_absolute_expiry` — Expiry timestamp

The customer's wallet:
1. Decodes the offer
2. Constructs an `invoice_request` (adding amount, payer_key, payer_note)
3. Sends it via the offer's blinded path to the recipient
4. Receives back a signed `invoice`
5. Pays the invoice via normal LN routing

This entire negotiation is invisible to CoinPay's API — CLN handles it internally. CoinPay only sees the final settled payment via `waitanyinvoice`.
