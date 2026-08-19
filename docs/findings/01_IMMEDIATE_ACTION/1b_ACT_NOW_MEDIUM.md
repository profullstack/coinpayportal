# Priority 1b — Act Now: Medium (32 findings)

**Target**: CoinPay Portal (`github.com/profullstack/coinpayportal`)
**Audited commit**: `f487631852cda525a6efbbe322066ba21a35b67e` (PR #262, merged 2026-08-15)
**Report date**: August 19, 2026
**Prepared by**: Eduardo Camarillo, Security Engineer
**Classification**: Confidential

**Business impact tier**: real, exploitable or self-triggering today — the Medium severity (and 1 Informational) subset of the 70 Priority-1 findings. Lower per-incident cost than Critical/High, but still meets the immediate-action bar: no attacker precondition, no config assumption.

**How to use this document**: each row is one finding. `Location` is where to start reading in the target repository to trace and confirm the mechanism described.

---

## Medium (31)

| ID | Location | Issue |
|---|---|---|
| `E-03` | `src/lib/stripe/subscriptions/service.ts:~126` | `application_fee` is only mentioned in a comment claiming it's applied; the field is absent from `sessionParams`. 100% of the platform fee goes to the merchant on the only recurring card rail. |
| `CP-024` | Proposal→invoice conversion | No `UNIQUE` constraint on `proposals.invoice_id` — TOCTOU allows double invoicing from one proposal. |
| `CP-P5` | `businesses.tier` | Column does not exist; every business is charged the 1% minimum fee regardless of actual tier. |
| `IA-017` | Escrow/swap creation | No idempotency key; the unique index that provides it exists only for the `payments` table. |
| `L-01` | `src/lib/web-wallet/settings.ts:186-189,209-227` | `checkTransactionAllowed` fails open through two independent code paths. |
| `L-04` | `src/lib/payments/business-collection.ts:319,381-392` | Forward-claim logic has no CAS — concurrent claims possible. |
| `L4-NEW-02` | `src/lib/payments/service.ts:287-296` | Writes `status:'failed'` on address-generation failure, but `payments_status_check` does not include `'failed'`; the `UPDATE` violates the CHECK constraint and is never verified. The payment stays `pending` forever, invisible. |
| `NEW-L5-2` | `payments.blockchain` CHECK constraint vs. `src/lib/payments/service.ts` | Schema CHECK omits generic `USDT`/`USDC` and `USDC_BASE`; application code inserts them anyway — payment creation fails in the primary flow for these stablecoins. |
| `NEW-06` | WebAuthn routes | No rate limit on any WebAuthn route; `login-options` enumerates registered users. |
| `NEW-24` | `src/lib/email/invoice-templates.ts:86,110,113,143` | Invoice email templates interpolate merchant-controlled fields into HTML with no escaping. |
| `FR-01` | `src/lib/fraud/screen.ts:124-131` | Fraud screening (and its denylist) fails open. |
| `AUD-01` | Systemic | No audit-logging infrastructure exists anywhere in the codebase. |
| `DOC-01` | `src/app/layout.tsx:35,43,49` | Site title/meta claim "non-custodial" against the product's own actual custody policy — direct regulatory/legal exposure, no attacker needed. |
| `GAP-02` | `strix_runs/**`, `strix_*.log` | Own pentest reports versioned in the public repo, including one false CRITICAL finding — hands any reader a ready-made roadmap. |
| `G-1.2-02` | Stripe payouts/disputes/subscriptions routes | Filter by `ownerMerchantIds` (every business the owner has) with no capability check — a `readonly` team member reads Stripe payout/dispute/subscription data for all of the owner's businesses. |
| `G-1.2-09` | `team/service.ts`, `invoice-templates.ts`, `templates.ts` | Trivially-registered merchant account can send unescaped HTML to any recipient, no rate limit. |
| `H-R-06` | Address validator vs. balance/fee/creation modules | For plain `USDC`, the address validator assumes Solana (base58) while balance, fee estimation, and creation assume Ethereum (ERC-20). |
| `R3-DIN-01` | Invoice payment monitor, no-`payment_id` branch | Marks an invoice `paid` and sends "Payment Received" unconditionally, without a `payment_id`. Funds can be stuck at the intermediary address. |
| `R3-DIN-06` | Email-only escrow creation | Sets `pending:${email}` as the escrow address with zero resolution logic in `src/`. Settle and refund fail unconditionally for these escrows. |
| `R4-STRIPE-SUB` | `src/app/api/stripe/subscriptions/route.ts:116` | Spreads caller-supplied `{...metadata}` without overwriting `platform_fee_amount`/`coinpay_*`; the webhook consumes it as-is. |
| `REC-D-02` | `src/lib/webhooks/service.ts:673` | Escrow webhook events reuse `payment_id` against the `payments(id)` FK — violates the constraint, fails silently. 100% of escrow webhook delivery audit records are lost. |
| `REC-D-04` | P2P/escrow payout path | `crypto_currency` is decoupled from the real payout network — a payout can target a different chain than the actual wallet. |
| `REC-D-05` | `src/app/api/p2p/request/route.ts:270-317` | Stripe-branch checkout session is created without calling `screenCheckout` at all. |
| `REC3-L1-01` | `src/lib/web-wallet/keys.ts`, `deriveADA()` | Uses generic SLIP-0010 instead of the CIP-3/Icarus derivation standard used by Yoroi/Daedalus/Eternl/Ledger/Trezor. Resulting addresses are not recoverable in any standard Cardano wallet. |
| `ESC-NEW-03` | Escrow settle, broadcast exception path | A broadcast exception during settle leaves `settlement_started_at` set, pushing state to `settle_failed`, which a DB constraint then blocks permanently. |
| `F3-L2-02` | `background/index.ts`, `fundingFor()` | Balance shown at payment-approval time is computed against the wallet active *when the request was made*; if the user switches wallets before approving, the final signature executes against the new wallet, not the one the approval screen showed. |
| `WW-02` | Web-wallet address-derivation route | No rate limit, unlike its 5 sibling mutating routes. |
| `F5-L4-03` | `scripts/test-spam-detection.ts:9-31` | Real merchant PII (names, emails, live corporate domains) hardcoded as test fixtures, in a public repository. Same class of leak the team already remediated in `send-announcement.ts` in the same commit, without touching this sibling file. |
| `F6-01` | `public/install.sh`, auto-upgrade timer/wrapper | `COINPAY_REF` is never exported into the timer/wrapper's re-invocation environment; every auto-upgrade silently falls back to `master`, defeating the only user-facing mitigation against `W-01` without warning. |
| `F7-01` | `docs/SECURITY_KEYS.md:156`, `docs/SECURITY.md:626-630` | Public documentation checklist/prose claims audit logging exists for key access and payment state changes. Directly contradicted by `AUD-01` (confirmed: no audit infrastructure exists) and the confirmed no-op of `clearSensitiveString`. |
| `R4-DIN-08` | `business-collection` retry queue + forward | Retry-queue claim is not exclusive, combined with an uncoordinated forward with no CAS — double send of 100% of a payment under overlapping cron runs. |

## Informational (1)

| ID | Location | Issue |
|---|---|---|
| `BL-03` | `mark-paid` endpoint | Documented-by-design commission-bypass path, usable today by any merchant. |

---

**This document covers the Medium and Informational subset of Priority 1 (32 of 70 findings).** The Critical/High subset is in `1a_ACT_NOW_CRITICAL_HIGH.md`; the Low subset is in `1c_ACT_NOW_LOW.md`.

---

## Sign-off

**Eduardo Camarillo**
Security Engineer

Report date: August 19, 2026
Audited commit: `f487631852cda525a6efbbe322066ba21a35b67e`
Document integrity: SHA-256 checksum published in `../CHECKSUMS.sha256`.
Parent report: `../06_REPORTS/SECURITY_AUDIT_REPORT.md`

