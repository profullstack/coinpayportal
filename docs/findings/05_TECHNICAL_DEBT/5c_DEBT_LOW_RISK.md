# Technical Debt — 5c: Low Risk / Hygiene (82 findings)

**Target**: CoinPay Portal (`github.com/profullstack/coinpayportal`)
**Audited commit**: `f487631852cda525a6efbbe322066ba21a35b67e` (PR #262, merged 2026-08-15)
**Report date**: August 19, 2026
**Prepared by**: Eduardo Camarillo, Security Engineer
**Classification**: Confidential

**Verified inert today.** Documentation drift with no live-code effect, timing side-channels defeated by real network jitter, immaterial-magnitude arithmetic, and mechanisms individually verified safe by reading the actual downstream consumer or the server-side validation that contains them. Lowest-priority bucket — track for completeness, revisit only if the surrounding code changes.

---

## Documentation drift / no live-code effect (9 rows, 11 findings)

The document and the code disagree, but no runtime behavior is affected.

| ID | Sev. | Note |
|---|---|---|
| `L3-NEW-02`/`L3-NEW-04` | Info | Missing RLS policy = default-deny; internal SQL doc drift |
| `L4-NEW-06` | Info | Doc drift, no live-code effect |
| `L6-02` | Low | Cosmetic name drift, <24h window, no live reference |
| `NEW-A2-02` | Info | Real limit is more permissive than documented — not an absent control |
| `NEW-L5-04`/`NEW-L6-1` | Low | TypeScript type contract mismatch — compile-time only, runtime unaffected |
| `NEW-L6-4` | Info | Overlaps `NEW-L5-04`/`NEW-L6-1` |
| `F4-04` | Low | Own finding text: "no direct security impact, header set by the server" |
| `REP-F1A-01` | Info | Endpoints just error out — broken, not exploitable |
| `W-10` | Info | Auditor's own label: "no security impact," function fully broken, not exploitable |


## Timing side-channels — not practical over real network jitter (4)

| ID | Sev. | Note |
|---|---|---|
| `L6-01` | Medium | No path returns the token value in any response |
| `NEW-08` | Low | Short-comparison timing attack, real network jitter defeats it |
| `R3-ID-01` | Low | Same class — theoretically real, not practically exploitable |
| `SDK-02` | Low | Only a risk if an integrator misuses the SDK with untrusted input as an "ID" |


## Immaterial magnitude (measured) (2)

| ID | Sev. | Note |
|---|---|---|
| `IA-007` | Low | Measured: ~128 wei deviation (~10⁻¹³ USD) |
| `NEW-22` | Low | Not measured (unlike `IA-007`) but presumed immaterial by analogy — worth an explicit measurement given ETH's 18 decimals |


## Downstream isolation confirmed by reading the real consumer (display-only, real balance/logic unaffected) (9)

| ID | Sev. | Note |
|---|---|---|
| `T-IDX-01` | Low | Only active in provider fallback, doesn't touch `cached_balance` |
| `T-IDX-02` | Low | Cosmetic counter; real table dedupes via `UNIQUE(chain,tx_hash)` |
| `T-IDX-NEW-01` | Low | `balance.ts` computes real balance independently via RPC |
| `T-IDX-NEW-02` | Low | Same isolation; spend limit counts `pending`+`confirmed` correctly either way |
| `REC3-L2-01` | Low | Only affects displayed history, not real balance |
| `F3-L2-01` | Medium | Verified real payload carries no recipient/amount, only status fields |
| `L4-NEW-03` | Inferred | `authorizeWalletRequest()` verified to require exact wallet match |
| `L4-NEW-05` | Low | `walletId` verified taken only from the authenticated result, never the body |
| `LOTE7-01` | Low | `authorizeBusiness(...)` verified called before every write in the 3 routes checked |


## Server-side validation already confirmed present (7)

| ID | Sev. | Note |
|---|---|---|
| `NEW-L5-02` | Low | Real CLI conversion flow verified to call the correct `convertFiatToCrypto()` |
| `NEW-L5-03` | Low | Verified scoped to the caller's own `userBusinessIds` — not cross-tenant |
| `NEW-L5-05` | Inferred | Server verified to validate `isNaN(amount)` |
| `NEW-L5-06` | Inferred | Server verified to never return `200` with `valid:false` |
| `N1-L5` | Low | Insertion point verified to receive an already-validated value |
| `G-R-01` | Low | All 3 routes verified to check `.eq('merchant_id', …)` downstream |
| `F-L7-04` | Inferred | Server verified to validate amounts consistently and broadly |


## Refuted / disproven assumption (2 — historical, kept for traceability)

| ID | Sev. | Note |
|---|---|---|
| `E-05` | Refuted | Refuted on recursive re-verification — the originally suspected mechanism did not hold up under direct re-reading of the current code |
| `H-R-11` | Refuted | Migration converts the column to `numeric` two days after creation; the finding stopped reading at `CREATE TABLE` |


## Individually verified Low/Informational/Inferred/Hypothesis severity, no qualifying business consequence today (49)

| ID | Sev. | Note |
|---|---|---|
| `CP-007` | Low | Exposes only already-public material |
| `CP-008` | Low | Real constant-time gate (`secretsMatch`) mitigates it |
| `CP-017` | Low | Recalibrated — `authorize` intersects scopes, no real escalation |
| `CP-P2` | Low | `WRITER_CAPS` bundles both capabilities — divergence never manifests |
| `CP-P6` | Low | Confirmed no path reaches an execution sink |
| `ESC-NEW-12` | Low | Access scoped to the token's own owner only |
| `F-1.1-05` | Low | `stripTokens` neutralizes the path today; latent only for a future endpoint |
| `F-1.1-15` | Low | Data already public via the sibling route |
| `F-1.1-17` | Info | Reveals a boolean only, no PII returned |
| `F-1.3-05` | Low | No live vulnerability — the cascade governs nothing real today |
| `F-1.3-11` | Low | Drift calibrated "irrelevant" in normal operation (15s cycle) |
| `F-L7-03` | Low | Deliberate owner action (viewing own seed with explicit warning) — standard wallet-CLI UX |
| `F1.4-L1-NEW-01` | Low | Confirms the code is correct — informational |
| `F1.4-L1-NEW-03` | Low | Build-risk/informational; implausible given the product is live in production |
| `F3-L2-03` | Low | Scope limited to the same user's own public addresses |
| `F3-L6-01`/`NEW-L6-3` | Medium | No qualifying mechanism found |
| `F3-L8-01` | Inferred | Example/documentation code, not code running in CoinPay's infrastructure |
| `F3-L8-02` | Inferred | Truncated timestamp cast verified safe — HMAC computed over the same truncated value on both sides |
| `F9-03` | Low | Effect is content-quality degradation, not fund/data/tenant/regulatory impact |
| `G-R-03` | Low | Forced logout only (minor availability nuisance) |
| `G-R-05` | Low | Latent — the one live caller passes the tier explicitly |
| `H-R-13` | Low | Own finding confirms it doesn't affect confirmation, which requires the real address |
| `IA-009` | Low | Recalibrated — encrypted blobs, not cleartext secrets |
| `IA-019` | Low | `POST /payments/[id]/forward` checks admin status via `payload.sub`, a claim no session token ever emits (all use `userId`) — fails closed for normal sessions. The one credential that does carry `sub` is an OAuth access token, whose scope is not checked at this call site. Availability issue for sessions; conditional privilege question for OAuth, contingent on `OIDC_SIGNING_SECRET` being unset. |
| `L3-NEW-01` | Low | Deliberate table reuse (documented in the migration comment) |
| `L5-4` | Low | Historical, no live mechanism |
| `L6-03` | Low | App revalidates in `poll/route.ts`, no bypass |
| `L6-04` | Low | Empty-key path documented as test-only; production always has the secret configured |
| `L6A-03` | Low | No external exploitability — internal test-guard asymmetry |
| `L6B-03` | Low | Symmetric client/server today, no active bypass |
| `L6B-04` | Low | Internal logging hygiene, no external exposure |
| `L6B-06` | Low | Confirmed fail-closed (401) |
| `MA-01` | Inferred | User sees only their own `is_admin` flag, already known to them |
| `NEW-10` | Low | No traced cross-tenant/financial consequence beyond theory |
| `NEW-12` | Low | Never stored or checked anywhere — functionally dead |
| `NEW-18` | Low | Defense-in-depth; only matters if a real XSS exists (not confirmed) |
| `NEW-A2-01` | Low | Free-text input hygiene, no injection sink |
| `REC-02` | Low | Tentative, not dynamically confirmed |
| `REC3-L1-02` | Low | Malformed address most likely rejected at broadcast, not redirected |
| `REP-F14-03` | Low | Performance/availability degradation, doesn't fit any of the 5 impact categories |
| `SUB-03` | Low | Internal config info leak (CWE-209), no secrets or customer data |
| `SUB-04` | Hypothesis | Own census: "weak hypothesis due to a 60s cache," concludes it isn't a finding |
| `T-01` | Low | Real production payload always populates both fields — trigger condition never observed |
| `W-04` | Low | Auditor confirms PHP-cURL verifies by default — no active degradation on a standard install |
| `W-09` | Low | Own finding: doesn't mitigate `NEW-13`/`C-01` — the critical secret returns directly from Stripe's response |
| `WW-04` | Low | Shares `WW-03`'s compromised-session gate, adds no incremental capability |
| `WW-05` | Low | Same gate as `WW-03`; only desyncs the ledger record, moves no funds |
| `WW-08` | Low | Unimplemented branch (`ed25519` TODO) — neutralized by its own incompleteness |
| `WW-L4-REC-01` | Low | Requires already knowing a high-entropy UUID; rate-limited |

---

**Total: 82 findings** (2 of them, `E-05`/`H-R-11`, are refuted — kept only for audit-trail completeness, not live findings. `G-1.2-11` is not listed here — it is a duplicate of the entry in `5a_DEBT_ELEVATED_RISK.md`, which carries the more specific classification.)

---

## Sign-off

**Eduardo Camarillo**
Security Engineer

Report date: August 19, 2026
Audited commit: `f487631852cda525a6efbbe322066ba21a35b67e`
Document integrity: SHA-256 checksum published in `../CHECKSUMS.sha256`.
Parent report: `../06_REPORTS/SECURITY_AUDIT_REPORT.md`

