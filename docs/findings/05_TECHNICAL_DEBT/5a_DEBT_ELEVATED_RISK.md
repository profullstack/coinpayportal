# Technical Debt — 5a: Elevated/Latent Risk (35 findings)

**Target**: CoinPay Portal (`github.com/profullstack/coinpayportal`)
**Audited commit**: `f487631852cda525a6efbbe322066ba21a35b67e` (PR #262, merged 2026-08-15)
**Report date**: August 19, 2026
**Prepared by**: Eduardo Camarillo, Security Engineer
**Classification**: Confidential

**Not urgent, but not inert.** These are confirmed real mechanisms that produce no business impact **only because of a specific condition** — the attacker needs prior access, a feature flag is off, or the consequence is limited to reputation-graph integrity rather than funds/data. Each reverts to active risk if that condition changes, with no code change required. Re-verify periodically, and treat any change to the gating condition as a trigger to re-prioritize.

---

## Requires prior compromise (post-exploitation only) (16)

Only reachable by an attacker who already has access — session recording, a stolen shell, a DB dump, or a leaked API key. Real defense-in-depth gaps, not initial-access vectors.

| ID | Sev. | Note |
|---|---|---|
| `CP-006` | Medium | Also conditional on an unobserved env var |
| `CP-009` | Medium | Requires direct DB read; confirmed not exposed via any API |
| `CP-012` | Medium | Requires prior DB/log read to obtain the comparison secret |
| `G-1.2-06` | Low | Only exploitable with a prior DB dump |
| `G-1.2-11` | Low | Needs a subdomain cookie-injection primitive not present |
| `IA-015` | High | Requires operator terminal history or CI log access |
| `NEW-02` | Medium | Also gated on a DB breach; remote timing attack impractical over real network jitter |
| `NEW-03` | High | Requires prior possession of a business API key — privilege escalation, not initial access |
| `NEW-17` | Medium | Only matters with an already-stolen session |
| `NEW-21` | Low | Requires simultaneous multi-user local access at the exact moment |
| `REC-03` | Low | Requires prior `localStorage` compromise |
| `W-02` | Medium | Requires prior access to the operator's own host (`ps`/shell history) |
| `W-03` | Medium | Requires compromising an external origin (bitcoincore.org/GitHub/PyPI) first |
| `WW-07` (=`WW-L4-REC-02`) | Low | Requires already holding the valid signature (equivalent to the private key) |
| `F3-L4-01` | Low | Requires local access to an already-unlocked device popup |
| `C-04` | Low | Not exploitable without already holding `ENCRYPTION_KEY` — a bigger compromise, covered elsewhere |


## Feature-flag disabled by default / latent (3)

| ID | Sev. | Note |
|---|---|---|
| `CP-020` | Medium | Verified end-to-end chain, but the feature flag is OFF today |
| `N-02` | High | `MULTISIG_ESCROW_ENABLED` off by default, returns 503, UI option hidden |
| `F-1.3-16` | Low | No component imports it today |


## Reputation-graph integrity, not funds (3)

Same root pattern (`CP-011`, `CP-018`, `CP-022`): affects trust-graph integrity, not custody. No financial decision in the corpus is shown to gate on it.

| ID | Sev. | Note |
|---|---|---|
| `CP-011` | Medium | Reputational, not fund-related, per the finding's own text |
| `CP-018` | Medium | Same pattern |
| `CP-022` | Medium | Worst of the three (forges receipts without a real signature) but still graph-integrity only |


## Individually verified Medium/High severity, no qualifying business consequence today (13)

| ID | Sev. | Note |
|---|---|---|
| `A-01` | Medium | Bookkeeping-only consequence, no fund loss |
| `A-02` | Medium | Refund path unaffected (uses `payment_intent`); degrades reconciliation only |
| `B-02` | Medium | Broken feature (fabricated key never works against real Stripe API) |
| `CP-016` | Medium | Own finding labels it abuse, not loss |
| `F-1.3-07` | Medium | Functionally dead — fails closed with 400 in 100% of cases |
| `G-R-06` | Medium | Baseline Node deployment behavior, not a regression |
| `G-R-08` | High | Not verifiable today from the repo alone |
| `IA-011` | Medium | Malformed address breaks availability, explicitly "does not lose funds" |
| `IA-013` | Medium | Requires a third-party GitHub Action maintainer to be compromised first |
| `IA-014` | Medium | Encryption-at-rest hygiene; no demonstrated cross-tenant exposure path |
| `REC-D-03` | Medium | Developer/merchant test utility, not a production flow |
| `UI-01` | Medium | Only materializes as token theft if a real XSS exists (not confirmed) |
| `UI-03` | Medium | Requires an unguaranteed chain of conditions |

---

**Total: 35 findings.** (`IA-012` is not listed separately — it is an earlier, narrower write-up of the same supply-chain mechanism now fully covered by `W-01`, Priority 1a.)

---

## Sign-off

**Eduardo Camarillo**
Security Engineer

Report date: August 19, 2026
Audited commit: `f487631852cda525a6efbbe322066ba21a35b67e`
Document integrity: SHA-256 checksum published in `../CHECKSUMS.sha256`.
Parent report: `../06_REPORTS/SECURITY_AUDIT_REPORT.md`

