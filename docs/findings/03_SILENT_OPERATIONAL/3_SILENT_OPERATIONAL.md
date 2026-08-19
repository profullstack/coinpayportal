# Priority 3 — Silent Operational Loss (39 findings)

**Target**: CoinPay Portal (`github.com/profullstack/coinpayportal`)
**Audited commit**: `f487631852cda525a6efbbe322066ba21a35b67e` (PR #262, merged 2026-08-15)
**Report date**: August 19, 2026
**Prepared by**: Eduardo Camarillo, Security Engineer
**Classification**: Confidential

**Business impact tier**: deterministic, no attacker required, but narrower scope or lower frequency than Priority 1. Typically a stuck payment, a lost audit record, or a permanently-collided state — discovered by an operator, not triggered by an adversary.

**How to use this document**: each row is one finding. `Location` is where to start reading in the target repository to trace and confirm the mechanism described.

---

| ID | Sev. | Location | Issue |
|---|---|---|---|
| `BL-02` | High | `monitor-escrow.ts:85-113`, `escrow/service.ts:527,584,639` | An escrow funded at expiry gets stuck with no exit for either party. |
| `CP-025` | High | `src/lib/escrow/service.ts:616-666` | Depositor can unilaterally refund with no gate — the escrow does not protect the seller. |
| `F-1.1-01` | High [latent] | Escrow monitor cron | Ignores `escrow_model`, marks funded multisig escrows `refunded`, closing the only two recovery paths (`proposeTransaction`/`disputeMultisigEscrow` require `funded`). |
| `ESC-NEW-14` | Low | Platform-arbiter derivation, index 0 | Deterministic address-derivation collision with the first escrow address. No evidence of third-party fund diversion — the arbiter is platform-controlled — but a scoped operational/addressing glitch. |
| `A-05` | Medium | Boltz swap creation | Swallows the DB write error and responds `success:true` — a live Boltz swap exists with no corresponding platform row or encrypted key. |
| `B-04` | Medium | `credentials/route.ts` | Filters `reputation_credentials` by a non-existent column `subject_did` (real column: `agent_did`) — always 500. |
| `F-1.1-06` | Low | `settleRefundedEscrows` | No retry cap (`MAX_SETTLE_ATTEMPTS`), unlike its sibling `settleReleasedEscrows`. |
| `F-1.1-13` | Medium | `secure-forwarding.ts` | Missing floor sanity check — if the real balance falls into `(0, gasReserve]` between confirmation and re-send, the tiered split logic misbehaves. |
| `F-1.3-04` | Medium | Payment + forwarding rail | Two divergent balance oracles; the DOGE stub returns `0`, and `secure-forwarding.ts` treats that as a real balance. |
| `F-1.3-08` | Low | Swap creation | A write failure is swallowed and answered `success:true`; for Boltz, the only copy of the refund key is never persisted. |
| `F-1.3-09` | Medium | Invoice payment detection | `.limit(100)` with no `.order()`; invoices with no `due_date` never leave the processed set — the entire rail stalls platform-wide. |
| `F-1.3-10` | Medium | Recurring invoice scheduler | Reuses a numbering algorithm its interactive sibling already documented as broken; a collision halts the subscription. |
| `F-1.3-12` | Medium | Escrow settlement window | 20-row batch with no `.order()`; a permanently-failing escrow occupies its slot forever; SOL exhaustion stalls the window. |
| `F-1.3-15` | Medium | Collections | Quotes with no network fee and sweeps the full amount with no gas reserve; throws on BTC. |
| `F3-L5-02` | Medium | `swap.js`, `waitForSwap()` | No `try/catch` around `getSwapStatus()` inside the polling loop — a single 502/504/timeout kills tracking permanently. |
| `F4-03` | Low | FossBilling config UI | Does not display the webhook URL merchants must manually register. |
| `G-1.2-04` | Medium | `GET /api/realtime/payments` | 7-day session JWT travels as `?token=`, landing in proxy/CDN logs, browser history, and `Referer` headers. |
| `H-R-04` | Medium | `monitorSeries` | Writes `periods_completed`/`next_charge_at` with `.eq('id', series.id)` and no CAS on the read state — same class as `L-04`. |
| `H-R-05` | Low→Medium | `sendStatusChangeNotifications` | `.limit(200)`, no pending filter, no order — the processed set never rotates once the 5 notifiable states are terminal. |
| `H-R-09` | Medium | `wallets/service.ts`, `merchant-service.ts` | `walletAddressSchema` validates length only (26-100 chars), not format, across both wallet tables. |
| `IA-006` | Medium | Sequential settlement | Commission leak. |
| `IA-008` | Medium | 8 routes | No timeouts; balance fails open to `0`. |
| `IA-010` | Medium | `blockchain/providers.ts:325-333,490-497` | Silent amount adjustment. |
| `INV-01` | Medium | Stripe webhook | No idempotency key by `event.id`. |
| `L-03` | Medium | Production image | Installs dependencies without a pinned lockfile. |
| `L5-02` | Medium | `system-wallet.ts` | Generates ADA address as `addr1_${pubkey.hex.slice(0,40)}...` — confirmed invalid, non-bech32, in the **custodial** wallet. |
| `L7A-04` | Medium | `check/route.ts` | Queries a non-existent `did_identities` table — returns `verified:false`/500 for any DID, including legitimate ones. |
| `L8-01` | Medium | `src/lib/webhooks/service.ts:673` | The `webhook_logs.payment_id → payments(id)` FK was never dropped despite `DROP NOT NULL`; escrow event webhook logging silently fails on the constraint. |
| `N-03` | Low | Payout state machine | `indeterminate` has no exit transition to `completed`/`tx_hash` in any route. |
| `NEW-F1A-P-01` | Medium | `convertToInvoice` | No `23505` retry, no correct numbering — 4th instance of the `H-R-04` class. |
| `NEW-F1A-P-02` | Low | Proposal lifecycle | Expiration not enforced on reject/counter/withdraw/send/token-view; `'expired'` state has no producer. |
| `NEW-L5-1` | Medium | `business_collection_payments_blockchain_check` | Constraint fixed 2025-11-30, never updated — silently excludes chains added since. |
| `R4-DIN-07` | Medium | `runInvoiceSchedulerCycle` | Read-then-write numbering + unsynchronized schedule — two consecutive invoices can share a `due_date` under overlapping cycles. |
| `REC-D-07` | [Inferred] | Webhook delivery | No durable retry, no dead-letter queue. |
| `SUB-02` | [Inferred] | `subscriptions/checkout` | No cap on pending payments, no rate limit — accumulation of `business_collection_payments` and encrypted-key HD addresses. |
| `V-01` | Medium | `webhook_logs` | `url`/`payload` are `NOT NULL` with no default; all 4 insert sites write `webhook_url` instead — insert always fails. |
| `W-08` | Medium | `stripe_disputes`/`stripe_payouts` | Schema drift; the "don't refund if a dispute is open" guard swallows the query error and always sees "no dispute." |
| `F5-L1-06` | Low (operational) | `scripts/sweep-balances.mjs` | File is truncated (`node --check` fails) and has been since its introduction (Dec 2025) — the documented emergency fund-recovery procedure has never worked. |
| `R3-DIN-03` | Medium — **confirmed against live production schema** | `escrow-monitor.ts` | Writes `settle_failed` to `escrows.status` on a failed re-send. The production `CHECK` constraint's allowed value list does not include `'settle_failed'` — confirmed via authorized read-only access to the live schema. The `UPDATE` is silently rejected; the escrow is left `released` with no status flag to signal the failure. |

---

**Total: 39 findings.**

---

## Sign-off

**Eduardo Camarillo**
Security Engineer

Report date: August 19, 2026
Audited commit: `f487631852cda525a6efbbe322066ba21a35b67e`
Document integrity: SHA-256 checksum published in `../CHECKSUMS.sha256`.
Parent report: `../06_REPORTS/SECURITY_AUDIT_REPORT.md`

