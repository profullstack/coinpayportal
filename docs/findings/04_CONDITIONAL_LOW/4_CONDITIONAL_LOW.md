# Priority 4 — Conditional / May Be Zero Impact (26 findings)

**Target**: CoinPay Portal (`github.com/profullstack/coinpayportal`)
**Audited commit**: `f487631852cda525a6efbbe322066ba21a35b67e` (PR #262, merged 2026-08-15)
**Report date**: August 19, 2026
**Prepared by**: Eduardo Camarillo, Security Engineer
**Classification**: Confidential

**Business impact tier**: real mechanism confirmed, but impact depends on an environment variable or configuration state not observable from the repository, or is already neutralized today by a documented product decision. Verify the condition before prioritizing.

**How to use this document**: each row is one finding. `Location` is where to start reading in the target repository to trace and confirm the mechanism described.

---

| ID | Sev. | Location | Issue | Condition to verify |
|---|---|---|---|---|
| `V-05` | High | `/api/payments/create`, card branch | Never invokes `consumeTransactionQuota` on the no-crypto branch. | **Confirmed neutralized**: `monthly_transaction_limit=NULL` for every plan (migration `20260624113709`) — no quota exists to bypass today. Re-activates instantly if any plan gets a non-null limit. |
| `CP-P4` | Medium | Card rail | Does not consume the monthly quota. | Same condition as `V-05` — neutralized today. |
| `GAP-01` | High | `scripts/gen-mnemonic.mjs:11,14` | BIP-39 mnemonic with a **valid checksum** committed in the public repo, labeled `SYSTEM_MNEMONIC_ETH`. | Verify on-chain whether any custody address was ever derived from it. |
| `CP-019` | High | `lib/reputation/crypto.ts:9` | Fallback HMAC secret `'cpr-dev-secret'`. | Only exploitable if `REPUTATION_SIGNING_SECRET` is unset in production. |
| `NEW-16` | High | `monitor/status/route.ts:15,41` | Fail-open via `undefined !== undefined`. | Only exploitable if `INTERNAL_API_KEY` is unset in production. |
| `G-1.2-08` | Medium | WebAuthn config | Asymmetric `WEBAUTHN_RP_ID`/`WEBAUTHN_ORIGIN` lets a subdomain-controlling attacker decouple `expectedOrigin`/`expectedRPID`. | Verify both variables are set and consistent in production — severity escalates to High if the asymmetry is confirmed live. |
| `G-R-09` | Medium (conditional) | `oauth/jwks` | Public `kid` = SHA-256(signing secret) truncated to 64 bits. | Exploitable only if `JWT_SECRET` is guessable/weak. |
| `H-R-03` | Low | `cron/monitor-payments/webhook.ts` | Raw `fetch()`, no `safeFetch`, no scheme/metadata-host restriction. | SSRF impact depends on internal network topology reachable from this cron. |
| `F9-02` | Low | `web-bot-auth/directory.ts:88-118` | `assertSafeDirectoryUrl()` is a weaker, ad-hoc SSRF filter than the already-used `src/lib/security/ssrf.ts`. | **Confirmed neutralized today**: no internal HTTPS target is reachable from any of the 3 documented deployment topologies. Re-opens if that topology changes. |
| `L-02` | Medium | `certs/gl-nobody.key` (git history) | Private key + certificate for a Greenlight node, CN `GL /users/b4569816-...`, issued 2026-02-14, removed from the working tree 2026-02-15 — permanently recoverable from git history. The CN identifies a specific node, not the generic public test credential the filename suggests. | Confirm whether this specific node credential is still active in production or already rotated. |
| `F5-L2-03` | Low | `.dockerignore` (root + `docker/`) | Does not exclude `.env*`. | Only affects a local build of the root `Dockerfile`, which is single-stage — not the documented deployment path (Railway via git). |
| `CP-004` | Medium | `monitor-payments:400` (Deno edge fn) | Blind SSRF. | Edge runtime egress CIDR is `UNKNOWN` from the repo. |
| `E-04` | Medium | Webhook management script | `REQUIRED_EVENTS` omits 3 of 10 events the handler actually processes; `--apply` unsubscribes disputes and refunds. | Impact depends on whether `--apply` has been run against the live webhook config. |
| `ESC-NEW-05` | Medium | `selectEscrowModel` | Dead code — the advertised `multisig_default` is never applied; partially mitigated client-side by the UI. | — |
| `ESC-NEW-06` | Low (downgraded from Medium) | Background monitor | Cannot create series (401 on `INTERNAL_API_KEY`); the primary cron creates them fine. | Only matters if the primary cron is ever down. |
| `F-1.3-03` | Medium | x402 proof | Doesn't pin the paid asset; single-network pairing fallback lets a worthless asset pass. | — |
| `F-1.3-06` | Medium | LNbits backup | Copies `LNBITS_ADMIN_KEY` (platform key) into a user row; 4 reads fall back to it. | — |
| `F-1.3-14` | Medium | Collections derivation index | `hash % 10^6` with no uniqueness check — a collision confirms a charge against another party's funds. | Probability depends on collection volume. |
| `F4-02` | Medium | FossBilling `processTransaction()` | No dedup by `event_id`/`transid`; only checks `invoice['status'] === 'paid'` (non-atomic check-then-act). | — |
| `IA-018` | Medium | KYC | Layering without KYC. | Regulatory posture decision, not a code defect. |
| `L4-NEW-01` | Medium (historical, closed) | `20260206143000_create_swaps_table.sql` | Extends the blast radius of `NUEVO-F2-01` — a `DO` block's `ELSE` branch created a PUBLIC `FOR ALL USING(true)` policy. | Already closed; listed for completeness of the historical exposure window. |
| `NEW-05` | Low | WebAuthn | RP-ID/origin derived from the `Host` header. | — |
| `NUEVO-F2-01` | Critical (historical, closed) | `ln_nodes`/`ln_offers`/`ln_payments` RLS | `FOR ALL USING(true)` with no `TO` clause (Feb 14-19, 5-day window) exposed `gl_creds`/`gl_rune` to the public `anon` key, unauthenticated. | Already remediated. If `gl_creds`/`gl_rune` were read during the window, rotation is warranted regardless of code status. |
| `R3-X1` | Medium | Stripe analog of `F-1.3-01` | `verify` compares the self-declared `amount`; Stripe is absent from `SIGNATURE_BOUND_NETWORKS`. | Depends on whether any integrator advertises the Stripe rail via x402. |
| `REC-06` | Low | Wallet backup encryption | PBKDF2-600k/AES-GCM (localStorage) vs. OpenPGP S2K (`.gpg` backup) for the same password — relative strength not independently verifiable from the repo. | — |
| `V-06` | Medium | `stripe_accounts` | The 4 core columns cited by call sites (`business_id`, `charges_enabled`, `payouts_enabled`, `stripe_account_id`) are confirmed present in the production schema. Whether all 9 files that reference this table use only columns that exist has not been cross-checked line-by-line against the live schema. | Verify the remaining column-level cross-check; the base premise (missing schema) does not hold for the 4 core columns already checked. |

---

**Total: 26 findings.** (`R3-DIN-03` was confirmed live against the production schema and moved to `../03_SILENT_OPERATIONAL/3_SILENT_OPERATIONAL.md`. `G-1.2-14` is not listed separately — it was formally retracted as a standalone finding and folded into `IA-019`, listed in `../05_TECHNICAL_DEBT/5c_DEBT_LOW_RISK.md`, which now also carries the OAuth-scope angle `G-1.2-14` contributed.) Two of the highest-value items to resolve first: `V-05`/`CP-P4` and `F9-02` are already confirmed neutralized by a specific, observable condition — worth a single verification pass each to close them out with certainty rather than re-litigating.

---

## Sign-off

**Eduardo Camarillo**
Security Engineer

Report date: August 19, 2026
Audited commit: `f487631852cda525a6efbbe322066ba21a35b67e`
Document integrity: SHA-256 checksum published in `../CHECKSUMS.sha256`.
Parent report: `../06_REPORTS/SECURITY_AUDIT_REPORT.md`

