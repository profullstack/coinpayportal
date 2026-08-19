# Priority 2 — High Impact, Gated (54 findings)

**Target**: CoinPay Portal (`github.com/profullstack/coinpayportal`)
**Audited commit**: `f487631852cda525a6efbbe322066ba21a35b67e` (PR #262, merged 2026-08-15)
**Report date**: August 19, 2026
**Prepared by**: Eduardo Camarillo, Security Engineer
**Classification**: Confidential

**Business impact tier**: real impact confirmed, but exploitation requires a non-public identifier (UUID, business_id, email of a specific victim) or chaining with another finding. Not self-triggering.

**Format**: `ID | Severity | Location | Issue`. Findings are grouped by the shared prerequisite that gates them (a non-public identifier, an API key scope, a feature flag).

---

## Cross-tenant / IDOR / authorization gap (business_id, DID, API key scope)

| ID | Sev. | Location | Issue |
|---|---|---|---|
| `B-01` | High | `stripe/api-keys`, `getStripeAccountId(businessId \|\| authResult)` | The query-string `business_id` takes precedence over the authenticated `userId` — total IDOR over any business's Stripe API keys. |
| `C-01` | High | 4 legacy Stripe routes | Decode JWT without comparing `business_id`; POST creates a webhook on the victim's Connect account pointing at the attacker's URL and returns the signing secret. |
| `C-02` | High | 8 of 16 routes using the `apiKeyBusinessId` contract | A business-A key acts on business-B's data within the same merchant account. |
| `C-03` | High | `payment-methods/manual` | Calls `verifyBusinessAccess` without a capability check, falling back to the permissive `business.read` — a `readonly` member rewrites the manual payout handle. |
| `CP-001` | High | `stripe/payments/create:123-129`, `stripe/webhook:224-253,788-802` | Injectable Stripe metadata lets a caller mark another merchant's payments/invoices as paid. |
| `CP-003` | High | `reputation/did/override/route.ts:91-127` | Cross-tenant DID rebind without proof of consent. |
| `CP-010` | High | `businesses/[id]/usage/rates/route.ts:39-157` | GET/POST/DELETE with no ownership check — overwrite another business's rates (e.g. zero out `cost_usd`). |
| `CP-014` | High | `reputation/receipts/route.ts:9-29` | Unauthenticated `select('*')` — amounts, `escrow_tx`, metadata for any DID. |
| `CP-015` | High | `payments/create-for-merchant/route.ts:84-91` | Authenticates with the raw issuer key — create payments on behalf of other merchants. |
| `CP-021` | High | `escrow/[id]/route.ts:40-67`, `lib/escrow/service.ts:399-413` | IDOR — counterparty emails, amounts, hashes, dispute reasons. |
| `CP-023` | High | `reputation/merchant-wallet/route.ts:56-149` | Wallet-slot squatting — unconfigured-crypto charges route to the attacker. |
| `G-1.2-12` | High | Invoice `merchant_wallet_address`, `payments/create` `payee_override` | Writable by `writer` and even `readonly` (permissive default) against the "funds movement is OWNER-ONLY" invariant. |
| `NEW-13` | High | `stripe/{api-keys,balance,webhooks}/**` (5 routes) | Cross-tenant cluster — creates webhooks on the victim's Connect account, returns its signing secret. Requires the non-public `business_id`. |
| `NEW-15` | Medium | `escrow/[id]/events` | IDOR, clone of `CP-021`. |
| `H-R-10` | Medium | `POST /api/invoices` | Accepts `client_id` from the body without checking `clients.business_id === resolvedBusinessId`. |
| `SUB-01` | Medium | `subscriptions/status` (DELETE), `checkout` | No `hasScope` check — a read-only API key can cancel the Professional subscription. |
| `REC-D-01` | Medium | Payee resolution (extends `NEW-04`) | Cross-merchant payout-wallet hijack by email; attacker's DID becomes the victim's principal. |
| `REC-C-03` | Medium | x402 | Ignores API key scopes — a `wallet:read` key can capture and settle Stripe PaymentIntents. |

## Identity / DID / account-linkage abuse

| ID | Sev. | Location | Issue |
|---|---|---|---|
| `L7A-02` | High | `did/register` | Plants a hostile DID on a victim's account before they claim their own. |
| `V-02` | Medium | `reputation/did/register` | Links an arbitrary DID to a victim merchant resolved by email, marked `verified:true`. |
| `REP-F1A-02` | Medium | `did/register`, email-linkage | Hijacks the victim's principal DID (`verified:true` without proof of possession), blocking their legitimate claim. |
| `G-1.2-10` | Medium (reinstated) | CLI device-auth flow | Anonymous session starts with a spoofed `client_name`; a pre-filled `verification_uri_complete` phishes a one-click approval from the authenticated victim. |
| `R4-ID-OAUTH` | Medium | `GET /api/oauth/authorize` | Login-CSRF — optional `state` + `sameSite=lax` session cookie lets one victim click link their account to the attacker's client. |
| `R3-ID-02` | Low | `auth/service.ts`, `register/route.ts` | Distinctive "Email already exists" response — email enumeration oracle. |
| `R4-ID-RESET` | Low | `password_reset:${email}` key | Global per-email key; attacker requests overwrite the pending reset token and exhaust the target's rate-limit bucket. |

## Multisig escrow (feature-gated by `MULTISIG_ESCROW_ENABLED`, live in the UI)

| ID | Sev. | Location | Issue |
|---|---|---|---|
| `F-1.1-02` | Medium [latent] | Multisig `propose`/`dispute` | Authenticates by comparing the raw pubkey — no signature required. |
| `F-1.1-03` | Medium [latent] | `GET /api/escrow/multisig?id=` | Unauthenticated — exposes pubkeys, amount, address, `business_id`. |
| `F-1.1-04` | Medium [latent] | `requireMultisigAuth` / `createMultisigEscrow` | Resolved identity is discarded; the body's `business_id` is persisted without ownership check. |

## Wallet / key material handling

| ID | Sev. | Location | Issue |
|---|---|---|---|
| `F-L7-01` | Medium | CLI, `saveEncryptedWallet()` | GPG output file has no `mode: 0o600` (unlike sibling outputs in the same CLI) — readable by other local users. |
| `F-L7-02` | Low | CLI | `--password`/`--token`/`--api-key` as CLI args — visible via `ps`/`/proc` to any local user. |
| `F5-L1-02` | Medium | `bin/coinpay`, `.coinpay-wallet.gpg` | Same mechanism as `F-L7-01`, sibling file. |
| `F5-L1-05` | Medium | `scripts/generate-hd-wallets.mjs:629` | System custody backup protected by an 8-char minimum with no complexity requirement. Chained: requires the `.enc` file first; complex passwords resist brute force for years per benchmark. |
| `F5-L1-07` | Medium | `bin/coinpay`, wallet GPG backup | No password minimum at all; GPG's KDF is ~3,766× faster to attack by GPU than the scrypt used in the sibling backup. |
| `L6B-05` | Low | `wallet-sdk/wallet.ts::exportEncryptedBackup`, `backup.ts::encryptSeedPhrase` | Password accepted with zero strength check. |
| `REC-04` | Medium | `wallet-sdk/wallet.ts::send()` | Signs the server-prepared `unsignedTx` without decoding it to confirm `to`/`amount` match the request. |
| `REC-01` | Medium | Web-wallet UI, `settings/page.tsx:904-916` (`handleDownloadBackup`) | `create`/`import` pages correctly gate the password (`length≥8 && score≥2`); the GPG backup-download flow uses the same `backupPassword` field but only checks it's non-empty — no strength requirement on the password protecting the exported `.gpg` file. |

## Rate-limit / enumeration gaps

| ID | Sev. | Location | Issue |
|---|---|---|---|
| `NEW-07` | Medium | WebAuthn challenges | Indexed by the victim's `user_id`. |
| `NEW-09` | Medium | `web-wallet/import`, ed25519 branch | Skips proof-of-ownership. |
| `NEW-11` | Low | CLI device-flow | No rate limit, status oracle. |
| `NEW-20` | High | Lightning nodes/invoices/payments routes | API requires the BIP-39 seed on every request and never uses it — transmits the master-derivation credential on every call for no functional reason. |
| `NEW-23` | Low | `web-bot-auth` directory fetch | SSRF via `Signature-Agent`, limited to HTTPS. |
| `NEW-WW34-01` | Low | `settings.ts`, `checkTransactionAllowed` | Receives `chain` but never uses it — daily spend limit sums raw amounts across all chains unnormalized. |

## Payment/settlement integrity

| ID | Sev. | Location | Issue |
|---|---|---|---|
| `B-03` | Medium | LNbits wallet sync | `.limit(100)` with no `.order()` on `wallets` — the processed set never rotates. |
| `F-1.1-07` | High | `POST /api/payouts/create` | Missing the `payouts:create` scope check present on its sibling `payments/create`. |
| `F-1.1-16` | Low | Invoice `paypal_order_id` | Overwritable without authentication by anyone who knows the invoice UUID. |
| `F-1.3-02` | High | x402 `verify`/`settle` | Never compare the announced `payTo` against the real recipient — the buyer can pay themselves. |
| `IA-016` | Medium | Escrow/swap payee | No fee-wallet validation. |
| `WW-01` | Medium | Web-wallet broadcast | Amount is not re-verified against the prepared transaction at broadcast time (only recipient is); daily spend limit is enforced at `prepare`, not `broadcast`. |
| `WW-03` | High | Web-wallet broadcast, BTC/BCH/SOL/USDC_SOL | No destination/amount verification at all (worse than `WW-01`'s partial gap). |
| `NEW-14` | Medium | `usage/history` | No ownership check. |
| `F5-L2-01` | High | `.github/workflows/deploy-lnbits-droplet.yml`, `ENV_FILE` load step | Individual secrets extracted from the `ENV_FILE` blob are never masked. Chained with the organization's accepted-risk continuous-deployment policy (push access to `master` triggers an unreviewed deploy): the same privilege lets an attacker add a trivial `echo` to persistently exfiltrate the production SSH key and LNbits admin key into a durable public log — survives revocation of the attacker's access. |
| `F5-L4-02` | Medium | `scripts/daily-stats-email.ts:293,331` | Unescaped HTML in the daily internal report — phishing vector into the operations team's inbox, triggered by public signup with no friction. |
| `V-04` | Medium | `POST /api/web-wallet/create` | Permits squatting any on-chain address with no authentication and no proof of ownership. |

---

**Total: 54 findings** (53 itemized above; `G-1.2-13` is a confirmed duplicate of `CP-010`+`NEW-14` and is counted in the Priority 2 total without a separate row).

---

## Sign-off

**Eduardo Camarillo**
Security Engineer

Report date: August 19, 2026
Audited commit: `f487631852cda525a6efbbe322066ba21a35b67e`
Document integrity: SHA-256 checksum published in `../CHECKSUMS.sha256`.
Parent report: `../06_REPORTS/SECURITY_AUDIT_REPORT.md`

