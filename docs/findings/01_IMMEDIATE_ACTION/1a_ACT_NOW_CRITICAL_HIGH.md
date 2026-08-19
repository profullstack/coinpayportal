# Priority 1a — Act Now: Critical & High (31 findings)

**Target**: CoinPay Portal (`github.com/profullstack/coinpayportal`)
**Audited commit**: `f487631852cda525a6efbbe322066ba21a35b67e` (PR #262, merged 2026-08-15)
**Report date**: August 19, 2026
**Prepared by**: Eduardo Camarillo, Security Engineer
**Classification**: Confidential

**Business impact tier**: real, exploitable or self-triggering today, no attacker required or a single direct action suffices. No config assumptions, no chained prerequisites. This file: the Critical and High severity subset — the highest-risk 31 of the 70 Priority-1 findings.

**How to use this document**: each row is one finding. `Location` is where to start reading in the target repository (`coinpayportal`) to trace and confirm the mechanism described.

---

## Critical (3)

| ID | Location | Issue |
|---|---|---|
| `F-1.3-13` | `src/lib/subscriptions/service.ts:211-213` | Subscription activation trusts `merchant_id`/`plan_id` from the payer's own metadata instead of `payment.merchant_id`, and never compares the amount paid against `SUBSCRIPTION_PRICES`. A $0.01 payment activates the $490/yr plan on any `merchant_id` the attacker names. |
| `F-1.3-01` | x402 facilitator, Lightning scheme — verify/settle path | The Lightning payment proof is checked against itself (`sha256(x)=y` where both `x` and `y` come from the payer). No external verification against a real Lightning payment occurs. Unlimited free access to every paid resource on this rail. |
| `NEW-04` | `src/lib/p2p/resolve.ts` (`resolveOrProvisionPayee`/`persistPayout`) | Payee resolution matches by `merchants.email` without platform scoping; payout `upsert` uses `onConflict:'merchant_id,cryptocurrency'`, overwriting any existing merchant's payout wallet whose email matches. Diverts a merchant's incoming payment. |

## High (28)

| ID | Location | Issue |
|---|---|---|
| `REC-C-01` | x402 facilitator, `verify`/`settle` | `scheme` and `network` are independent, attacker-controlled fields; a proof tagged `bolt12`/`ethereum` still settles via the self-certifying Lightning path. Extends `F-1.3-01` beyond the Lightning scheme. |
| `REC-C-02` | x402 facilitator, EVM scheme | Documented gasless `transferFrom` collection does not exist in code; `verify`/`settle` serve content on a single EIP-712 signature with zero on-chain transaction. |
| `L8-02` | `src/lib/payments/service.ts` — `INSERT INTO payments` (card branch) | `payment_address_id` was dropped from schema (Nov 2025 migration) but 3 live card-payment routes still insert it. Every card payment fails with a 500 before reaching Stripe. |
| `N-01` | `src/lib/fraud/screen.ts` callers | `screenCheckout` is invoked from 1 of 7 sinks that create real card charges. The most exposed sink (`payments/widget/create`) is a public, secret-free embed. |
| `W-07` | `src/app/api/lightning/offers/route.ts` (GET) | No authentication; `business_id` optional; `limit` has no `max`. Anonymous request dumps every merchant's Lightning offers and received revenue in one call. |
| `F9-01` | `src/lib/crypto/require-key.ts` vs. 9 direct `process.env.ENCRYPTION_KEY` consumers | `requireEncryptionKey()` rejects `KNOWN_WEAK_KEYS` but is used by only 4 of 13 real encryption call sites. The 9 unprotected sites (`src/lib/wallets/hd-wallet.ts:551`, `secure-forwarding.ts:129`, `system-wallet.ts:824,962`, `escrow/service.ts:344`, others) only check non-empty. The repo's own test fixture value is itself a `KNOWN_WEAK_KEYS` entry. |
| `W-01` | `public/install.sh` | Default `COINPAY_REF=master` (mutable branch); checksum verification is optional and only printed, never enforced; auto-upgrade timer runs every 5 minutes. Any code merged to `master` reaches every installed machine within 5 minutes. |
| `W-05` | Lightning Address payment path | The client never decodes the returned bolt11 invoice to confirm the amount. Paying a Lightning Address pays whatever amount the recipient's LNURL server decides. |
| `W-06` | Boltz swap integration | `redeemScript`/`swapTree` are declared but never read; the swap address is never validated against the actual HTLC. Refund keys are worthless if the address was substituted. |
| `CP-002` | `src/app/api/reputation/issuers/route.ts:28-78` | Issuer self-registration sets `active:true` with no identity/domain check; API key stored in cleartext. Root cause enabling 4 other High findings (`NEW-04`, `CP-003`, `CP-011`, `CP-015`, `CP-023`). |
| `CP-005` | `src/app/api/x402/settle/route.ts:470-492` | Responds `settled: true` without the funds having moved; consumers cannot distinguish a real settlement from this false-positive response. |
| `NEW-01` | `src/app/api/escrow/route.ts:182,192`, `src/lib/escrow/service.ts:133-173,77-84` | Oracle resolves a crypto address to a merchant's email, enumerable across the full merchant base. Feeds directly into `NEW-04`. |
| `H-R-01` | `src/lib/wallets/balance-checkers.ts`, DOGE case | Returns `0` for Dogecoin ("not yet implemented") while DOGE is advertised, accepted at 4 payment-creation routes, and has a working send path. Received DOGE is never detected as paid. |
| `H-R-08` | 8 modules (currency name list, balance checker, fee estimator, `SETTLEABLE_CHAINS`, address validator) | The supported-currency list diverges across these 8 modules independently — no single source of truth. |
| `L5-01` | `src/lib/escrow/service.ts:320-337` vs `src/lib/wallets/derivation-family.ts` | Escrow address-derivation index has no CAS and does not coordinate with the normal-payment-flow counter — deterministic index collision for ETH/POL/BNB/USDT/USDC/SOL. |
| `L7A-01` | `src/app/api/reputation/did/{claim,delegate,me}/route.ts` | None of the 3 DID identity routes call `hasScope()`. A minimal-scope (read-only) business API key can rebind a merchant's DID and issue `DelegatedAuthority` credentials with `wallet:transfer`/`escrow:settle` scope. |
| `L7A-03` | `src/app/api/reputation/attest/route.ts`, `src/lib/reputation/mutual-attestation.ts` | No verification that the caller controls `attester_did`; no rate limit. The mutual trust graph is unilaterally forgeable, free, at scale. |
| `REP-F14-01` | `src/lib/reputation/trust-engine.ts`, `trust-tiers.ts`, `anti-gaming.ts` | Tier A-F reputation score is maximizable with self-declared high-value receipts; anti-gaming deducts ~1.5 of 100 points worst case. Consumed by `web-bot-auth/verify` for real trust decisions. |
| `G-1.2-01` | `src/app/api/.../payment-methods/manual/route.ts` (GET+POST) | Omits capability check, falls back to the permissive `business.read` default. A `readonly` team member can rewrite the Venmo/CashApp/Zelle payout handle. |
| `G-R-07` | `src/app/api/oauth/userinfo/route.ts` | Returns `email_verified: true` unconditionally — no verification column, no verification flow exists — contradicting the ID token, which correctly returns `false`. Account-takeover primitive against relying parties. |
| `F3-L3-01` | Extension/SDK batch payment retry (`payOnce()`) | Retries `prepareTx → sign → broadcast` from scratch after a transient `broadcast()` error (including `already known`), with no idempotency key. Can duplicate a real transaction. |
| `F3-L5-01` | SDK `WalletClient.send()` | Signs with generic `signMessage()` instead of serializing the real RLP/PSBT transaction. The SDK's flagship send method is broken for every integrator. |
| `F4-01` (`F-P4-01`) | FossBilling plugin, `StatusMapper.php` | `StatusMapper::MAP` only translates `payment.completed`/`payment.overpaid`, event types the backend never emits; no fallback. Every real webhook falls into `'ignore'`. Automated invoice crediting is unreachable in production, 100% of transactions. |
| `ESC-NEW-01` | `dispute_resolution` (custodial escrow) and `dispute_status` (multisig escrow) columns | Both columns are real, present in the production schema — and neither has a single writer anywhere in the codebase, confirmed via authorized read-only production access. A disputed escrow has no exit except the depositor's own release, in **both** escrow models. Funds frozen indefinitely. |
| `A-03` | Boltz provider-secret handling | Refund keys are encrypted on write; `decryptProviderSecrets` has zero callers. No client ever recovers them — every failed swap's HTLC funds are unrecoverable through the product. |
| `F-1.1-08` | `src/app/api/invoices/[id]/check-balance/route.ts`, `monitor-invoices` | A `* 0.99` underpayment tolerance survives in these two paths without going through the shared `isSufficientPayment` — live, recurring 1% revenue leak. |
| `BL-01` | `monitor.ts:73`, `monitor-balance.ts:639-730` | A transient RPC failure marks a fully-paid payment `expired`. No attacker required — customer funds appear stuck with no automatic recovery path. |
| `F5-L4-01` | `scripts/cleanup-spam.ts`, `cleanOrphanedWallets()` (lines 246-273) | Deletes every `wallets` row with zero transactions — no filter by merchant, protected list, or age. Header comment ("Safe: only deletes merchants with zero wallet transactions and bot-like patterns") is false for this function. Fires on every documented `--execute` run, destroying legitimate third-party web-wallets, including ones created seconds earlier. |

---

**Total: 31 findings** (3 Critical, 28 High).

---

## Sign-off

**Eduardo Camarillo**
Security Engineer

Report date: August 19, 2026
Audited commit: `f487631852cda525a6efbbe322066ba21a35b67e`
Document integrity: SHA-256 checksum published in `../CHECKSUMS.sha256`.
Parent report: `../06_REPORTS/SECURITY_AUDIT_REPORT.md`

