# CoinPay Portal — Security Audit Report

**Target**: CoinPay Portal (`github.com/profullstack/coinpayportal`)
**Audited commit**: `f487631852cda525a6efbbe322066ba21a35b67e` (PR #262, merged 2026-08-15)
**Report date**: August 19, 2026
**Prepared by**: Eduardo Camarillo, Security Engineer
**Classification**: Confidential

---

## Scope & Limitations

**In scope**: the full `coinpayportal` repository at the audited commit above — backend routes and services (`src/`), database schema and migrations (`supabase/migrations/`), infrastructure and deployment configuration, CI/CD workflows, the browser extension, JS/PHP SDKs and CLI, e-commerce plugin integrations (WooCommerce, WHMCS, FossBilling), and public-facing documentation. Every file in these areas was read directly; none of this engagement's findings rest on tooling output alone.

**Out of scope**: dynamic and black-box testing (live requests against a running deployment, fuzzing, exploit proof-of-concept execution) were **not performed**. Every finding in this report and in the sibling `../` finding folders was established by static reading of source code, configuration, and — where noted explicitly on the finding — authorized read-only inspection of the production database schema. No traffic was sent to any CoinPay Portal environment, staging or production, during this engagement. A dynamic-testing plan exists as an internal working set kept outside this `findings/` package, but has not yet been executed; findings that a dynamic pass could newly surface, confirm at higher confidence, or downgrade are not reflected here.

**Independent verification performed**: a subset of findings (`R3-DIN-03`, `CP-P5`, `ESC-NEW-01`, `V-06`) were additionally confirmed against the live production database schema via authorized read-only access — this is disclosed individually on each such finding's row and is distinct from dynamic/black-box testing.

---

## 1. Summary

| Metric | Value |
|---|---|
| Total findings, confirmed and live | 338 |
| Critical | 4 |
| High | 59 |
| Medium | 133 |
| Low | 120 |
| Informational | 8 |
| Technical Debt | 5 |
| Inferred | 8 |
| Hypothesis | 1 |
| Findings with confirmed business impact | 189 of 338 (56%) |
| Findings requiring immediate action (Priority 1) | 70 |
| Overall risk rating | **CRITICAL** |

Detailed, prioritized findings: `../01_IMMEDIATE_ACTION/1a_ACT_NOW_CRITICAL_HIGH.md`, `../01_IMMEDIATE_ACTION/1b_ACT_NOW_MEDIUM.md`, `../01_IMMEDIATE_ACTION/1c_ACT_NOW_LOW.md` (Priority 1, split by severity), `../02_HIGH_GATED/2_HIGH_GATED.md` (Priority 2), `../03_SILENT_OPERATIONAL/3_SILENT_OPERATIONAL.md` (Priority 3), `../04_CONDITIONAL_LOW/4_CONDITIONAL_LOW.md` (Priority 4). Findings without confirmed business impact — real backlog, not noise — are split by risk in `../05_TECHNICAL_DEBT/5a_DEBT_ELEVATED_RISK.md` (dormant/gated, reverts to active risk if conditions change), `../05_TECHNICAL_DEBT/5b_DEBT_STRUCTURAL.md` (dead code / code-health), and `../05_TECHNICAL_DEBT/5c_DEBT_LOW_RISK.md` (verified inert, hygiene).

**Risk rating basis**: three live, zero-privilege paths to direct theft of funds or paid resources are confirmed by direct code reading — a one-cent purchase of a $490/year plan on any target merchant (`F-1.3-13`), unlimited free access to every resource on the Lightning x402 payment rail (`F-1.3-01`, extended to EVM and any labeled network by `REC-C-01`/`REC-C-02`), and diversion of a merchant's incoming payment to an attacker-controlled wallet (`NEW-04`). These coexist with fraud screening that covers 1 of 7 real card-charge sinks (`N-01`), an unauthenticated endpoint dumping every merchant's Lightning revenue (`W-07`), and a maintenance script that deletes legitimate customer wallets under normal documented use (`F5-L4-01`).

---

## 2. Anti-Patterns

These are not isolated bugs. Each pattern below recurs across independently-written modules, different phases of the codebase, and different authors/timeframes — meaning the underlying cause is systemic, not a one-off oversight. Fixing one instance without fixing the pattern will leave the others in place.

### 2.1 Strong guard, mostly bypassed

A correct, well-built validation function exists — and most of the code that should use it reads the raw value directly instead.

- `requireEncryptionKey()` (`src/lib/crypto/require-key.ts`) correctly rejects known-weak `ENCRYPTION_KEY` values (all-zero, all-`f`, sequential hex, `deadbeef` repeated). It protects **4 of 13** real encryption call sites. The other 9 — including the system wallet, escrow, and collection paths, the actual custody hot path — call `process.env.ENCRYPTION_KEY` directly and only check for non-empty (`F9-01`).
- The project's own test fixture value for `ENCRYPTION_KEY` is itself one of the four constants `requireEncryptionKey()` is built to reject. The guard exists, was clearly designed with this exact failure mode in mind, and is bypassed by the majority of its own consumers.
- No equivalent guard exists at all for `JWT_SECRET`, `INTERNAL_API_KEY`, or `MASTER_MNEMONIC` — the pattern isn't "guard is imperfect," it's "guard is built once, adopted selectively, and not replicated."

### 2.2 Fail-open by default

When a security check cannot complete — missing config, unexpected input, a downstream error — the default behavior is to allow the operation rather than deny it.

- `FR-01`: fraud screening (and its denylist) fails open.
- `LN_KEY_ENCRYPTION_KEY` (`CP-006`): falls back to storing the value in plaintext if the key fails validation, with only a `console.warn`.
- `webhooks/secret.ts`, `resolveWebhookSecret()`: returns the stored (possibly still-encrypted) secret unchanged if `ENCRYPTION_KEY`/`merchantId` is missing or `decrypt()` throws, instead of failing the delivery.
- `L-01`: `checkTransactionAllowed` fails open through two independent code paths.
- `NEW-16`: `monitor/status` compares `undefined !== undefined`, which is always false — the check passes when the comparison value is simply absent.
- `G-1.2-01`/`C-03`: capability checks that are missing fall back to the permissive `business.read` default rather than denying.

Six independent instances, five different subsystems (crypto, fraud, webhooks, wallet settings, admin auth, capability checks). None of these share code — this is a house style, not a shared bug.

### 2.3 Sibling asymmetry — the identical neighbor has the check, this one doesn't

The same operation is implemented twice (a primary route and a variant, or two branches of one route), and the security check present in one copy is silently absent from the other.

- `F-1.1-07`: `POST /api/payouts/create` has no `payouts:create` scope check; its declared sibling `payments/create` has it.
- `V-05`: the card-payment branch of `/api/payments/create` never calls `consumeTransactionQuota`; the crypto branch does.
- `WW-01` vs `WW-03`: `WW-01` re-verifies the payment recipient but not the amount at broadcast time; `WW-03` (a different chain set — BTC/BCH/SOL/USDC_SOL) verifies neither.
- `G-1.2-01`/`C-03`: `payment-methods/manual` omits the capability check that its sibling routes carry.
- `E-03`: six of seven Stripe payment-creation points apply the platform's `application_fee`; the seventh (subscriptions) has only a comment claiming it does.

Five instances. The failure mode is never "we forgot security entirely" — it's "we built it once, correctly, and didn't propagate it to the copy."

### 2.4 Self-verification — checking a claim against itself

A value that is supposed to prove something is instead validated using data supplied by the same party making the claim.

- `F-1.3-01`: the x402 Lightning payment proof is `sha256(x) = y` where both `x` and `y` originate from the payer. There is no external check against a real Lightning payment.
- `REC-C-01`: `scheme` and `network` on that same proof are independent, attacker-set fields — a proof labeled for one network settles via the self-certifying path regardless.
- `REC-C-02`: the EVM collection path never performs the documented `transferFrom` — it accepts a signature and serves the resource.
- `CP-005`: the settlement endpoint answers `settled: true` without confirming funds actually moved.
- `NEW-20`: the API requires the BIP-39 seed as a parameter on every request and never uses it for anything.

Five instances across the same payment-facilitator subsystem — this is the most concentrated pattern in the codebase, and it is the direct cause of two of the three Critical findings.

### 2.5 Documentation asserts a control the code doesn't have

Public-facing documentation (in the same public repository) states a security property as already implemented, in direct contradiction with confirmed code behavior.

- `docs/SECURITY_KEYS.md`: checklist item `[x] Audit logging for key operations` and `[x] Sensitive data cleared from memory after use` — `AUD-01` confirms no audit infrastructure exists anywhere in the codebase, and `clearSensitiveString` is confirmed dead code (`F1.4-L1-NEW-02`).
- `docs/SECURITY.md`: prose states "All payment state changes logged... Key access logged and monitored" — same contradiction (`F7-01`).
- `DOC-01`: site metadata claims "non-custodial" against the product's actual, differently-scoped custody policy.
- `BL-04`: a code comment promises a balance "floor" sanity check that the function does not perform.

Four instances, two of them in the security documentation itself — the exact place a partner, auditor, or engineer would go to verify the platform's posture before trusting it.

### 2.6 No rate limit on endpoints that enumerate or cost money to abuse

- `NEW-06`: no rate limit on any WebAuthn route; `login-options` enumerates registered users.
- `NEW-11`: CLI device-auth flow has no rate limit, and leaks a status oracle.
- `L7A-03`: `reputation/attest` has no rate limit and no proof the caller controls `attester_did` — the trust graph is forgeable at scale for free.
- `WW-02`: the address-derivation route has no rate limit, unlike its five sibling mutating routes (see §2.3).
- `REC-C-04`/`REC-C-05`: x402 verify/settle and the swap-quote endpoint have no rate limit or size cap — third-party API quota (ChangeNOW, Stripe) is exhaustible by an anonymous caller.

### 2.7 Cross-tenant boundary enforced by an identifier that's never actually checked

A route authenticates the caller, then trusts a tenant-scoping value (`business_id`, `merchant_id`) from the request instead of the authenticated session.

- `C-01`: four Stripe routes decode the JWT and never compare it against `business_id`.
- `C-02`: 8 of 16 routes under the `apiKeyBusinessId` contract let a business-A key act on business-B.
- `B-01`: `getStripeAccountId(businessId || authResult)` — the query-string value takes precedence over the authenticated user.
- `CP-010`, `NEW-13`, `G-1.2-13`: same shape, different routes (`usage/rates`, five Stripe Connect routes, `usage/rates`+`usage/history` again as a separate confirmed instance).

Six independently-discovered instances of the identical shape: **authenticate the user, then trust a tenant ID the user supplies.**

### 2.8 Money-moving writes with no compare-and-swap

Concurrent execution of the same write path is not just possible but unguarded — two callers reading the same state before either writes produce a double-write.

- `L5-01`: escrow address-derivation index has no CAS and doesn't coordinate with the normal-payment counter — deterministic address collision.
- `L-04`: business-collection forward-claim has no CAS.
- `H-R-04`: `monitorSeries` writes `periods_completed`/`next_charge_at` unconditioned on the state it read.
- `R4-DIN-08`: retry-queue claim is not exclusive, combined with an uncoordinated forward — double send of 100% of a payment under overlapping cron runs.
- `IA-001`, `F-1.1-09`: same shape, confirmed compensated downstream in these two specific cases — evidence the pattern is understood by the team in some places and not applied consistently everywhere.

### 2.9 Supply chain — mutable reference instead of a pin

- `W-01`: `public/install.sh` defaults to `COINPAY_REF=master` (a mutable branch), checksum verification is optional and only printed, and the auto-upgrade timer runs every 5 minutes. Anything merged to `master` reaches every installed machine within 5 minutes.
- `F6-01`: the one user-facing mitigation (pinning `COINPAY_REF`) is silently defeated by the same script — the auto-upgrade re-invocation doesn't propagate the pinned value, so it falls back to `master` anyway.
- `IA-013`: `plugins-ci.yml` pins its GitHub Actions by mutable tag (`@v5`, `@v2`) while every sibling workflow in the same repo pins by commit SHA — the discipline exists, this one file is the exception.

### 2.10 Silent failure — the error is swallowed and success is reported anyway

- `BL-01`: a transient RPC failure marks a fully-paid payment `expired`.
- `A-05`: a DB write failure during Boltz swap creation is swallowed; the response is `success: true` with no platform record of the swap that now exists live at the provider.
- `REC-D-02`: an FK violation on escrow webhook logging fails silently — 100% of escrow webhook audit records are lost, delivery itself is unaffected so nobody notices.
- `L4-NEW-02`: a status-update to `'failed'` violates the schema's own CHECK constraint; the failure is never checked by the caller, so the payment is left `pending` forever, invisible.

---

## 3. What the anti-patterns predict

Sections 2.1-2.10 are not a checklist of what already broke — they describe *where the next finding will be* if the same shape is left unaddressed. Any new endpoint built with the current review practice will plausibly repeat §2.3 (the sibling won't get the same check), §2.6 (no rate limit unless someone remembers), or §2.7 (tenant scoping from the request body, not the session) by default, because nothing in the codebase currently prevents it structurally — there is no shared middleware, lint rule, or code-review checklist artifact enforcing any of these ten patterns project-wide.

---

## 4. Standalone findings requiring a decision, not a code fix

- **`doppler.env`/`doppler.json`** — an encrypted local secrets cache from the Doppler CLI, committed to git, present in the audited HEAD. It was added in a dependency-update commit unrelated to secrets management, and no `.gitignore` pattern in the repository matches its filename. Permanently recoverable from git history regardless of later removal. Severity: High, Critical if the local Doppler passphrase is recoverable — not verifiable from the repository. Decision required: rotate the secrets it contained and purge the file from history, or accept the exposure.
- **`L-02`** — a Greenlight Lightning-node private key and certificate (`certs/gl-nobody.key`), CN `GL /users/b4569816-...`, issued February 14, 2026, removed from the working tree one day later on February 15, 2026 — permanently recoverable from git history regardless of the removal. The certificate's CN identifies a specific node, not the generic public test credential the filename suggests. Decision required: confirm whether this specific node credential is still active in production.

---

## 5. Sign-off

**Eduardo Camarillo**
Security Engineer

Report date: August 19, 2026
Audited commit: `f487631852cda525a6efbbe322066ba21a35b67e`
Document integrity: SHA-256 checksum published in `../CHECKSUMS.sha256`.

Full findings, prioritized and with exact file:line trace paths, are in the sibling folders of `../`.
