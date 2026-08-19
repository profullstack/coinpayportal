# Priority 1c — Act Now: Low (7 findings)

**Target**: CoinPay Portal (`github.com/profullstack/coinpayportal`)
**Audited commit**: `f487631852cda525a6efbbe322066ba21a35b67e` (PR #262, merged 2026-08-15)
**Report date**: August 19, 2026
**Prepared by**: Eduardo Camarillo, Security Engineer
**Classification**: Confidential

**Business impact tier**: real, exploitable or self-triggering today — the Low severity subset of the 70 Priority-1 findings. Lowest per-incident cost of the immediate-action tier, but still meets the bar: no attacker precondition, no config assumption.

**How to use this document**: each row is one finding. `Location` is where to start reading in the target repository to trace and confirm the mechanism described.

---

| ID | Sev. | Location | Issue |
|---|---|---|---|
| `REC-C-04` | Low | x402 `verify`/`settle` | No rate limit or size cap — ledger bloat and Stripe API quota consumption by an anonymous caller. |
| `REC-C-05` | Low | `GET /api/swap/quote` | Anonymous, no rate limit; each request triggers 2 calls to the ChangeNOW third-party API — quota exhaustion. |
| `WW-L4-01` | Low | `GET /api/wallets/lookup` | No auth, no rate limit. Responds `found:true/false` for whether an address belongs to a merchant/business with an active email — a boolean oracle usable to enumerate CoinPay merchant addresses. |
| `NEW-19` | Low | `/api/partners` | Publishes every merchant's webhook host, with no opt-in. |
| `NEW-F1A-P-03` | Low | Proposal creation | `client_id` is cross-tenant and unvalidated. |
| `NEW-L5-01` | Low | SDK `card-payments.js` | Calls `client.request('POST'/'GET', path, body)` (3 args) against `CoinPayClient.request(endpoint, options)`, which only accepts 2 (`client.js:40`). Every call builds a broken URL (`baseUrl + 'POST'`) and fails 100% of the time — blocks releasing/refunding a card escrow entirely. |
| `BL-04` | Low | Balance-forwarding code comment | The comment promises a "floor" sanity check the code does not perform. |

---

**Total: 7 findings.** (`R4-DIN-08` was reclassified from an intermediate tier to Medium and moved to `1b_ACT_NOW_MEDIUM.md`.)

---

## Sign-off

**Eduardo Camarillo**
Security Engineer

Report date: August 19, 2026
Audited commit: `f487631852cda525a6efbbe322066ba21a35b67e`
Document integrity: SHA-256 checksum published in `../CHECKSUMS.sha256`.
Parent report: `../06_REPORTS/SECURITY_AUDIT_REPORT.md`
