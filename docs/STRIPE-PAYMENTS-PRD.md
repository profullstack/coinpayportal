# CoinPayPortal Card Gateway + Card Escrow + DID Reputation Integration
## Full Product Requirements Document (PRD)

---

## 1. Executive Summary

CoinPayPortal currently provides:
- Crypto payment gateway
- Non-custodial crypto payments
- Escrow-style crypto release
- Tiered SaaS pricing (1% Free / 0.5% Pro)
- DID-based portable reputation layer
- Unified webhook system

This project extends CoinPayPortal to support:
1. Credit & Debit Card payments via Stripe Connect Express
2. Optional Card Escrow Mode
3. Full integration of card activity into DID reputation scoring

Stripe will act purely as payment infrastructure. CoinPayPortal remains the product, API layer, risk engine, and identity layer.

---

## 2. Strategic Objectives

### 2.1 Primary Goals
- Add card payment rail
- Maintain unified CoinPay API
- Maintain tiered fee model
- Introduce optional card escrow
- Feed all card activity into DID reputation engine
- Keep compliance burden minimal
- Avoid Custom Connect complexity

### 2.2 Non-Goals (V1)
- Full white-label card processing
- Licensed escrow entity structure
- Multi-processor routing
- Internal custodial wallet ledger
- Advanced reserve modeling

---

## 3. Product Positioning

CoinPayPortal becomes:

> A multi-rail payments infrastructure (Crypto + Card)
> With identity-based trust scoring via DID
> With optional escrow logic
> With risk-aware automation

Stripe processes payments. CoinPayPortal manages trust and logic.

---

## 4. Architecture Overview

### 4.1 Stripe Integration Model
- **Connect Type:** Express
- **Default Charge Model:** Destination Charges
- **Escrow Charge Model:** Separate Charges & Transfers
- **Commission Mechanism:** `application_fee_amount`

### 4.2 High-Level Payment Flows

#### Card Gateway Mode
```
Customer → CoinPay Checkout → Stripe Destination Charge
→ Stripe deducts processing fee
→ CoinPay deducts platform fee
→ Merchant receives payout
```

#### Card Escrow Mode
```
Customer → CoinPay Checkout → Stripe PaymentIntent (platform-owned)
→ Funds land in platform balance
→ Escrow record created
→ Manual or timed release
→ Stripe transfer to merchant
```

---

## 5. Feature Separation

### 5.1 Card Gateway Mode (Default)
- Fast payment processing
- Immediate merchant payout
- Platform takes 1% (Free) or 0.5% (Pro)
- Lowest operational risk
- No fund holding

### 5.2 Card Escrow Mode (Optional)
- Funds held in platform balance
- Manual release or auto-release after X days
- Requires DID risk eligibility
- Recommended higher fee tier
- Higher operational risk

---

## 6. DID Identity & Reputation Integration

Every merchant and user has:
```
did:coinpay:<unique_identifier>
```

All card events generate DID reputation entries.

---

## 7. Reputation Events (Card Rail)

### 7.1 Successful Payment
- **Event:** `card_payment_success`
- **Impact:** Positive trust weight, volume-weighted scoring

### 7.2 Refund
- **Event:** `card_refund`
- **Impact:** Negative weight, affects refund ratio metric

### 7.3 Dispute Created
- **Event:** `card_dispute_created`
- **Impact:** Heavy negative weight, affects dispute ratio

### 7.4 Chargeback Lost
- **Event:** `card_chargeback_lost`
- **Impact:** Severe negative, may disable escrow, may disable card rail

---

## 8. DID Risk Scoring

Each DID maintains:
- `reputation_score`
- `risk_score`
- `dispute_ratio`
- `refund_ratio`
- `successful_volume`
- `total_volume`

### 8.1 Escrow Eligibility Rule (Example)
```
dispute_ratio < 0.6%
AND refund_ratio < 5%
AND successful_volume > $5,000
```

Only eligible DIDs can enable card escrow.

---

## 9. Database Schema

> All Stripe tables MUST be prefixed with `stripe_`.

### 9.1 stripe_accounts
```sql
CREATE TABLE stripe_accounts (
  id uuid PRIMARY KEY,
  merchant_id uuid REFERENCES merchants(id),
  stripe_account_id text UNIQUE NOT NULL,
  account_type text DEFAULT 'express',
  charges_enabled boolean DEFAULT false,
  payouts_enabled boolean DEFAULT false,
  details_submitted boolean DEFAULT false,
  country text,
  email text,
  created_at timestamp,
  updated_at timestamp
);
```

### 9.2 stripe_transactions
```sql
CREATE TABLE stripe_transactions (
  id uuid PRIMARY KEY,
  merchant_id uuid,
  stripe_payment_intent_id text UNIQUE,
  stripe_charge_id text,
  stripe_balance_txn_id text,
  amount bigint,
  currency text,
  platform_fee_amount bigint,
  stripe_fee_amount bigint,
  net_to_merchant bigint,
  status text,
  rail text DEFAULT 'card',
  created_at timestamp,
  updated_at timestamp
);
```

### 9.3 stripe_disputes
```sql
CREATE TABLE stripe_disputes (
  id uuid PRIMARY KEY,
  merchant_id uuid,
  stripe_dispute_id text UNIQUE,
  stripe_charge_id text,
  amount bigint,
  currency text,
  status text,
  reason text,
  evidence_due_by timestamp,
  created_at timestamp,
  updated_at timestamp
);
```

### 9.4 stripe_payouts
```sql
CREATE TABLE stripe_payouts (
  id uuid PRIMARY KEY,
  merchant_id uuid,
  stripe_payout_id text UNIQUE,
  amount bigint,
  currency text,
  status text,
  arrival_date timestamp,
  created_at timestamp
);
```

### 9.5 stripe_escrows
```sql
CREATE TABLE stripe_escrows (
  id uuid PRIMARY KEY,
  merchant_id uuid,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  total_amount bigint,
  platform_fee bigint,
  stripe_fee bigint,
  releasable_amount bigint,
  status text,
  release_after timestamp,
  created_at timestamp,
  updated_at timestamp
);
```

### 9.6 did_reputation_events
```sql
CREATE TABLE did_reputation_events (
  id uuid PRIMARY KEY,
  did text,
  event_type text,
  source_rail text,
  related_transaction_id text,
  weight integer,
  metadata jsonb,
  created_at timestamp
);
```

---

## 10. Payment Logic

### 10.1 Platform Fee Calculation
```javascript
if (merchant.tier === 'free') {
  fee = amount * 0.01;
} else if (merchant.tier === 'pro') {
  fee = amount * 0.005;
}
```
Server-side only.

### 10.2 Escrow Transfer Logic
After release:
```javascript
stripe.transfers.create({
  amount: releasable_amount,
  destination: merchant.stripe_account_id,
});
```

---

## 11. Dashboard Requirements

### Merchant Dashboard Overview
- Card revenue
- Crypto revenue
- Platform fees
- Stripe fees
- Net earnings
- DID reputation score
- Risk rating

### Transactions Table
- Date
- Rail
- Amount
- Status
- Platform fee
- Stripe fee
- Net

### Escrow Panel
- Pending escrow balance
- Release button
- Auto-release countdown
- Dispute status

### Disputes Panel
- Dispute status
- Evidence deadline
- Submission link

---

## 12. Admin Controls

Admin must be able to:
- View Stripe account status
- Freeze card rail
- Disable escrow
- Override DID score
- Apply reserve requirement
- Force refund
- Adjust release delay

---

## 13. Security Requirements
- Use Stripe Checkout or Elements
- Never store raw card data
- Verify webhook signatures
- Validate all amounts server-side
- Store money in smallest unit
- Log all DID risk changes

---

## 14. Compliance

**Stripe handles:**
- KYC
- AML
- PCI
- Sanctions
- Tax reporting (if configured)

**CoinPay must:**
- Disclose Stripe processing
- Disclose escrow reversal risk
- Disclose clawback policy
- Maintain platform Terms of Service
- Monitor prohibited industries

---

## 15. Risk Automation Rules

```
If dispute_ratio > 0.9%:
  → Disable escrow
  → Increase release delay

If dispute_ratio > 1.5%:
  → Disable card rail
  → Admin review required
```

---

## 16. Metrics
- GMV per DID
- Reputation-weighted GMV
- Dispute ratio
- Refund ratio
- Escrow adoption rate
- Revenue per DID
- Risk-adjusted revenue

---

## 17. Rollout Plan

| Phase | Description |
|-------|-------------|
| Phase 1 | Internal test merchant |
| Phase 2 | Invite-only beta |
| Phase 3 | Public release |

---

## 18. Future Enhancements
- ACH
- Subscription billing
- Rolling reserves
- Internal wallet abstraction
- Multi-processor routing
- Upgrade to Custom Connect if needed

---

## 19. Long-Term Vision

CoinPayPortal evolves into:

> A DID-powered trust-weighted payment layer
> Multi-rail commerce infrastructure
> Reputation-portable across ecosystems (e.g., ugig)

Card rails strengthen DID graph. Crypto rails provide final settlement trust. Together, they form defensible infrastructure.
