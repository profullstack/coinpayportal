# CoinPay Portal — Business Impact Report

**Target**: CoinPay Portal (`github.com/profullstack/coinpayportal`)
**Audited commit**: `f487631852cda525a6efbbe322066ba21a35b67e` (PR #262, merged 2026-08-15)
**Report date**: August 19, 2026
**Prepared by**: Eduardo Camarillo, Security Engineer
**Classification**: Confidential

---

## 1. Impact Summary

| | |
|---|---|
| Total findings evaluated for business impact | 331 |
| Findings with confirmed business impact | 189 (57%) |
| Findings with no qualifying business impact (technical debt) | 142 (43%) |
| **Immediate-action findings (Priority 1)** | **70** |
| Gated findings — real impact, requires a non-public identifier (Priority 2) | 54 |
| Silent operational-loss findings (Priority 3) | 39 |
| Conditional findings — impact depends on unverified config (Priority 4) | 26 |

**Qualifying criterion** (applied individually to all 331, not by category): a finding counts as business impact if, under conditions that hold **today** — no assumed environment variables, no dead code, no disabled flags — it produces loss or freezing of funds, revenue leakage, exposure of customer data, a breach of tenant separation, or regulatory exposure.

---

## 2. Impact by Category

Every Priority 1 finding (immediate action, 70 total) maps to at least one of the categories below — a finer-grained breakdown of the five qualifying criteria in §1. A finding mapping to more than one category is counted once per category it touches, so the column does not sum to 70. Distribution:

| Category | Count | Representative findings |
|---|---:|---|
| Direct theft / unauthorized acquisition of funds or paid resources | 9 | `F-1.3-13`, `F-1.3-01`, `NEW-04`, `REC-C-01`, `REC-C-02`, `CP-002`, `CP-005`, `H-R-01`, `NEW-01` |
| Revenue leakage | 6 | `E-03`, `CP-P5`, `L8-02`, `F-1.1-08`, `V-05`* (see note), `NEW-L5-2` |
| Customer / merchant data exposure | 5 | `W-07`, `G-1.2-02`, `G-1.2-09`, `F5-L4-03`, `GAP-02` |
| Custody / key-material compromise pathway | 4 | `F9-01`, `A-03`, `L5-01`, `L7A-01` |
| Irreversible destruction of legitimate customer data | 1 | `F5-L4-01` |
| Fraud-control bypass (enables downstream theft) | 3 | `N-01`, `REC-D-05`, `FR-01` |
| Regulatory / public-trust misrepresentation | 4 | `DOC-01`, `F7-01`, `BL-03`, `GAP-02` |
| Operational failure with direct fund consequence | 9 | `BL-01`, `ESC-NEW-01`, `R3-DIN-01`, `R3-DIN-06`, `L4-NEW-02`, `ESC-NEW-03`, `IA-017`, `L-01`, `L-04` |
| Supply-chain integrity (third-party/customer machines) | 2 | `W-01`, `F6-01` |
| Product-integrity / recurring transaction reliability | 3 | `F3-L3-01`, `F3-L5-01`, `F4-01` |

*`V-05` is currently neutralized — see §4.

---

## 3. Headline Business Consequences (Priority 1, selected)

Stated in business terms, not mechanism terms. Full technical detail is in `../01_IMMEDIATE_ACTION/1a_ACT_NOW_CRITICAL_HIGH.md`, `../01_IMMEDIATE_ACTION/1b_ACT_NOW_MEDIUM.md`, and `../01_IMMEDIATE_ACTION/1c_ACT_NOW_LOW.md`.

| Finding | Business consequence |
|---|---|
| `F-1.3-13` | Any party can activate the $490/year Professional plan on a merchant of their choosing for a $0.01 payment. No merchant selection restriction — the attacker names the beneficiary account. |
| `F-1.3-01` + `REC-C-01` + `REC-C-02` | Every paid resource behind the x402 payment facilitator (Lightning, EVM, and any network reachable by mislabeling the request) is accessible for free, indefinitely, with no transaction trail. |
| `NEW-04` | A merchant's incoming payment can be silently redirected to an attacker-controlled wallet by registering a second account with the victim's email. |
| `F5-L4-01` | The documented, routine maintenance procedure for spam cleanup destroys legitimate customer wallets — including wallets created seconds earlier — with no filter, no backup, no confirmation step, contradicting its own "safe" documentation. Direct customer-facing incident risk on every maintenance run. |
| `W-07` | Any unauthenticated party can retrieve every merchant's Lightning revenue and offer configuration in a single request — a full competitive-intelligence and reconnaissance dump of the platform's Lightning business. |
| `N-01` | Fraud screening protects 1 of 7 real card-charge paths. The most exposed of the six unprotected paths is a public embed requiring no credentials. |
| `E-03` | The platform's commission is never collected on Stripe subscriptions — 100% of revenue on the only recurring card rail goes to the merchant, with no code path currently applying the fee. |
| `L8-02` | All three live card-payment routes fail with a server error before reaching Stripe — a schema/code mismatch, live in production today. |
| `F9-01` | The safeguard against degenerate encryption keys covers 4 of 13 real use sites; the 9 unprotected sites are the system wallet, escrow, and collections — the actual custody hot path. The project's own test fixture value matches one of the specific weak keys the safeguard is designed to reject. |
| `F5-L4-03` | Real merchant names and email addresses are hardcoded in a public repository's test fixtures — an active, ongoing PII exposure of the same kind already remediated once in a sibling file in the same commit. |
| `DOC-01` / `F7-01` | Public product and security documentation make custody and audit-logging claims contradicted by the platform's actual, verified behavior — direct exposure if relied upon by a partner, regulator, or customer performing due diligence. |

---

## 4. Findings Whose Business Impact Is Currently Neutralized — Verify Before Deprioritizing

Two findings carry High technical severity but produce **no impact today** because of a specific, verifiable condition. Both revert to full impact the moment that condition changes, with no code change required on the attacker's part.

| Finding | Neutralizing condition | Verified how |
|---|---|---|
| `V-05` / `CP-P4` | `monthly_transaction_limit = NULL` for every subscription plan (migration `20260624113709`) — no quota currently exists to bypass. | Direct read of the migration and the `consume_transaction_quota()` RPC, which treats `NULL` as "unlimited, always allow." |
| `F9-02` | No internal HTTPS target is reachable from the code path in any of the three documented deployment topologies — the SSRF filter is weaker than the project's own hardened `ssrf.ts`, but there is nothing of value to reach today. | Network-topology review of `setup-droplet.sh`, `vercel.json`, `Dockerfile`, `docker-compose.yml`. |

**Recommendation**: track both as active risk, not closed findings — either one reactivates to Priority 1 without any code change, purely from a configuration or infrastructure decision made elsewhere.

---

## 5. Trend Since Last Assessment

The business-impact classification was performed twice during this engagement: an initial pass covering the 16 highest-severity findings only, and a complete pass covering all 341. The complete pass more than tripled the count of findings requiring immediate action (18 → 70) and confirmed that 189 additional findings, previously assumed to carry no impact, required individual review before that conclusion could be trusted — several (`G-1.2-01`, `G-R-07`, `W-07`, `N-01`) turned out to be Priority 1 and had never been individually assessed for business consequence at all.

A related check against the live production database schema (authorized, read-only) independently confirmed three findings that static code review alone could not settle: `R3-DIN-03` (the schema constraint that causes the silent escrow failure is present exactly as predicted), `CP-P5` (the `tier` column does not exist, confirming the fee-floor leak), and `ESC-NEW-01` (the dispute-resolution gap is confirmed to affect both the custodial and multisig escrow models, not only the custodial one as originally scoped).

---

## 6. Sign-off

**Eduardo Camarillo**
Security Engineer

Report date: August 19, 2026
Audited commit: `f487631852cda525a6efbbe322066ba21a35b67e`
Document integrity: SHA-256 checksum published in `../CHECKSUMS.sha256`.

Full findings register, prioritized with exact trace paths: sibling folders under `../`. Anti-pattern analysis: `SECURITY_AUDIT_REPORT.md`.
