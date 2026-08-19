# Technical Debt — 5b: Structural / Code-Health Risk (25 findings)

**Target**: CoinPay Portal (`github.com/profullstack/coinpayportal`)
**Audited commit**: `f487631852cda525a6efbbe322066ba21a35b67e` (PR #262, merged 2026-08-15)
**Report date**: August 19, 2026
**Prepared by**: Eduardo Camarillo, Security Engineer
**Classification**: Confidential

**Not a live exploit path.** Dead code, structural root causes already counted once under another finding, and race conditions confirmed compensated downstream. No independent attack surface — but each represents a maintainability or defense-in-depth gap worth closing during normal refactor work, and dead code in particular should not be trusted to stay dead as the codebase evolves.

---

## Dead code / no live caller (16)

No route or process in the codebase invokes this path today.

| ID | Sev. | Note |
|---|---|---|
| `F1.4-L1-NEW-02` | Low | `clearSensitiveString` — dead, requires pre-compromised client memory anyway |
| `G-R-04` | Tech Debt | Google Calendar token table doesn't exist in any migration |
| `H-R-02` | Tech Debt | 880 dead lines, has latent internal defects but never runs |
| `IA-004` | Low | `initSecrets()` — zero call sites |
| `L5-03` | Low | No active caller in the production flow |
| `L5-04` | Low | No caller exercising this SOL derivation path |
| `N-04` | Tech Debt | No route conditions anything on contracted plan today |
| `NEW-L6-2` | Low | No callers |
| `REP-F14-02` | Low | No caller outside its own export |
| `T-IDX-NEW-03` | Low | Indexer module has no caller in `src/` |
| `V-07` | Low | No callers |
| `IA-002` | High (structural) | RLS gap is real but only "explains" already-counted findings (`NEW-13`/`CP-010`/`NEW-14`/`NEW-15`) — not a distinct exploit path |
| `IA-005` | Medium (structural) | Root cause of `CP-024`/`L-04`/`IA-001`, already counted individually |
| `F-1.1-10` | Medium (structural) | Root cause of `F-1.1-07`, already counted |
| `CP-013` | Medium (structural) | Pure amplifier of `NEW-01`/`NEW-06`, already counted |
| `IA-003` | Medium | Labeled `[INFERRED-impact]` by the auditor — no traced fund consequence |


## Structural enabler — explains another already-counted finding, no independent exploit (5)

| ID | Sev. | Note |
|---|---|---|
| `G-R-02` | Medium | Depends on unobserved third-party integrator behavior |
| `REC-C-06` | Inferred | Weakens other controls, no direct exploit of its own |
| `REC-D-06` | Inferred | Content-quality gap, no fund/data leak mechanism described |
| `F3-L1-01` | Medium | Own closure doc classifies it as this exact excluded category |
| `A-04 ≡ B-04` | Medium | Own finding leaves real path traversal unverified |


## CAS / idempotency gap already compensated downstream (3)

| ID | Sev. | Note |
|---|---|---|
| `F-1.1-09` | Medium | Own finding confirms the CAS at the forward step contains the double-send |
| `IA-001` | Medium | Same — downstream CAS compensates |
| `WW-06` | Low | Each write is idempotent — derives from the same on-chain state |


## Individually verified Technical Debt severity, no qualifying business consequence today (1)

| ID | Sev. | Note |
|---|---|---|
| `H-R-12` | Tech Debt | Deliberate product limitation, not a defect (per Pass 11) |

---

**Total: 25 findings.**

---

## Sign-off

**Eduardo Camarillo**
Security Engineer

Report date: August 19, 2026
Audited commit: `f487631852cda525a6efbbe322066ba21a35b67e`
Document integrity: SHA-256 checksum published in `../CHECKSUMS.sha256`.
Parent report: `../06_REPORTS/SECURITY_AUDIT_REPORT.md`

