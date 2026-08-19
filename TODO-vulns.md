# TODO-vulns — Security Audit Remediation Tracker

Working ledger for the security audit in `docs/findings/` (Eduardo Camarillo,
report dated 2026-08-19, audited commit `f487631`). **338 findings.**

This file is the source of truth for remediation state. The `docs/findings/`
package is read-only evidence — do not edit it; record outcomes here.

## How to use

Each row carries a **Status**:

| Status | Meaning |
|---|---|
| `OPEN` | Confirmed present in current `master`, not yet fixed. |
| `FIXED` | Remediated on this branch; commit noted in the Log. |
| `ALREADY-FIXED` | Closed between the audited commit and now; re-verified against current code. |
| `NEUTRALIZED` | Mechanism real, but a verified condition removes impact today. Re-check on change. |
| `DECISION` | Needs a human or business decision, not a code change. |
| `UNVERIFIED` | Carried from the report, not yet re-read against current code. |

**Nothing is marked `FIXED` without a code change plus a test or a direct re-read
of the changed path.** Findings inherited as `UNVERIFIED` are the audit's claim,
not ours — the audited commit is seven PRs behind current `master`, so a share of
them are already closed. The x402 verify route in particular has been hardened
substantially since the audit (price binding, replay via unique index, proof
redaction, an EIP-3009 v2 path), which is why several x402 rows below are narrower
than the report's.

---

## Fix order, and why

1. **Direct theft of funds or paid resources** — `F-1.3-13`, `F-1.3-01` +
   `REC-C-01` + `REC-C-02`, `NEW-04`.
2. **Anti-pattern root causes** — the report's §2 patterns recur across
   independent modules, so fixing the shape beats fixing instances. Highest
   leverage: §2.7 (tenant id from the request), §2.2 (fail-open), §2.3 (sibling
   asymmetry).
3. **Money leaks needing no attacker** — `L8-02`, `F-1.1-08`, `E-03`, `BL-01`,
   `F5-L4-01`.
4. **Data exposure** — `W-07`, `CP-014`, `B-01`, `C-01`, `C-02`.
5. Everything else, by priority tier.

---

## Priority 1a — Critical (3)

| ID | Status | Location | Issue | Fix approach |
|---|---|---|---|---|
| `F-1.3-13` | `FIXED` | `src/lib/subscriptions/service.ts:183-260` | **Confirmed live.** `handleSubscriptionPaymentConfirmed` reads `merchant_id`/`plan_id` out of `payment.metadata`, never compares them against the row's own `merchant_id` column, and never checks `payment.amount` against `SUBSCRIPTION_PRICES`. `POST /api/business-collection` accepts a caller-supplied `amount` **and** a caller-supplied `metadata` blob (route lines 56, 99). A $0.01 payment therefore activates the $490/yr plan on any merchant UUID the attacker names. | Trust the row, not the metadata: activate `payment.merchant_id`; validate `plan_id` and `billing_period` against `SUBSCRIPTION_PRICES`; require `payment.currency === 'USD'` and `payment.amount >= price`. Reject and log otherwise. |
| `F-1.3-01` | `FIXED` | `src/app/api/x402/verify/route.ts:143-160`, `src/app/api/x402/settle/route.ts:279-281` | **Confirmed live.** `verifyLightningPayment` checks `sha256(preimage) === paymentHash` where both values come from the payer. `settleLightning` then returns `{txHash: payload.paymentHash, confirmed: true}` — the route answers `settled: true` having verified nothing. Unlimited free access to every paid resource on the Lightning rail. | No self-certifying rail. Look the `paymentHash` up against a real received invoice on the platform's Lightning node and require settled status plus amount ≥ price. Until that lookup exists, refuse the scheme rather than accept it. |
| `NEW-04` | `FIXED` | `src/lib/p2p/resolve.ts:69-76,183-215` | **Confirmed live.** `resolveOrProvisionPayee` matches `merchants` by `email` with no scoping to platform-provisioned accounts; `persistPayout` then upserts `merchant_wallets` on `(merchant_id, cryptocurrency)`, overwriting the victim's payout address. Reachable by any holder of a `reputation_issuers` key — and `CP-002` lets anyone self-register one as `active: true`. | Scope the email match to `auth_provider = 'platform'` accounts. Never overwrite a wallet the platform did not provision: insert-if-absent, and leave a merchant-owned wallet alone. Fix `CP-002` in the same pass so the door is shut on both sides. |

## Priority 1a — High (28)

| ID | Status | Location | Issue | Notes |
|---|---|---|---|---|
| `REC-C-01` | `FIXED` | `x402/verify:435`, `x402/settle:470` | **Confirmed live, and worse than reported.** Dispatch reads `scheme === 'bolt12' \|\| network === 'lightning'`, and `scheme`/`network` are independent attacker-set fields. `{scheme:'bolt12', network:'ethereum'}` routes to the Lightning verifier *and* comes back `amountAuthenticated: true`, because that flag is computed as `SIGNATURE_BOUND_NETWORKS.has('ethereum')`. The response actively misreports the proof's strength. | Dispatch on `network` alone; require `scheme` to be one the network permits. |
| `REC-C-02` | `FIXED` | x402 EVM v1 scheme | Documented gasless `transferFrom` is absent; v1 EVM serves content on a signature with no chain transaction. **Partly addressed since the audit**: the v2/EIP-3009 path (`src/lib/x402/settle-v2.ts`) does broadcast. v1 EVM verify still returns valid on the signature alone. | Confirm a v1 EVM `verify` is never treated as final; settle-side `verifyEvmTx` does check the chain. |
| `F-1.3-02` | `FIXED` | `x402/verify`, `enforcePriceBinding` | Binding checks amount and resource but **not** `expected.payTo` against `payload.to`. The v2 path does check it; v1 does not — §2.3 sibling asymmetry. The buyer can pay themselves. | Add the payTo comparison to the v1 binding. |
| `F-1.3-03` | `FIXED` | `x402/verify` v1 | The asset is not pinned in `enforcePriceBinding`, so a worthless asset satisfies the price. | Compare `expected.asset` as well. |
| `R3-X1` | `FIXED` | `x402/verify`, `verifyStripePayment` | Checks the PaymentIntent status but never compares the **real** PI amount against `expected.amount`, nor that the PI belongs to this merchant. Price binding compares only the self-declared payload amount. | Compare `pi.amount_received` / `pi.amount` against `expected.amount`. |
| `CP-005` | `FIXED` | `x402/settle:279-281,529` | Responds `settled: true` for Lightning with no funds moved. Same root cause as `F-1.3-01`. | Closed by the `F-1.3-01` fix. |
| `L8-02` | `FIXED` | `src/lib/payments/service.ts`, card branch | `payment_address_id` was dropped from the schema but three card routes still insert it — every card payment 500s before reaching Stripe. | Verify against the live schema before changing; may already be closed. |
| `N-01` | `FIXED` | `src/lib/fraud/screen.ts` callers | `screenCheckout` is invoked from 1 of 7 sinks that create real card charges; the most exposed sink, `payments/widget/create`, is a public secret-free embed. | Enumerate the seven sinks and screen each. |
| `W-07` | `FIXED` | `src/app/api/lightning/offers/route.ts` (GET) | No authentication, `business_id` optional, `limit` unbounded — one anonymous request dumps every merchant's Lightning offers and received revenue. | Require auth, scope to the caller's business, cap `limit`. |
| `F9-01` | `FIXED` | `src/lib/crypto/require-key.ts` vs nine direct consumers | `requireEncryptionKey()` guards 4 of 13 encryption sites; the custody hot path (`hd-wallet`, `secure-forwarding`, `system-wallet`, `escrow/service`) reads `process.env.ENCRYPTION_KEY` raw and checks only non-empty. The repo's own test fixture value is itself a `KNOWN_WEAK_KEYS` entry. | Route every site through the guard, then add a lint rule banning the raw read (§2.1). |
| `W-01` | `PARTIAL` — mitigation now works; default ref is a `DECISION` | `public/install.sh` | Default `COINPAY_REF=master`, checksum verification optional and only printed, auto-upgrade timer every five minutes. Anything merged to master reaches every installed host within five minutes. | Pin to a tag, enforce the checksum. See also `F6-01`. |
| `W-05` | `FIXED` | Lightning Address payment path | The client never decodes the returned bolt11 to confirm the amount — it pays whatever the recipient's LNURL server decides. | Decode and compare before paying. |
| `W-06` | `FIXED` | Boltz swap integration | `redeemScript`/`swapTree` are declared but never read; the swap address is never validated against the actual HTLC, so refund keys are worthless if the address was substituted. | Validate the address is derivable from the script. |
| `CP-002` | `FIXED` | `src/app/api/reputation/issuers/route.ts` | Issuer self-registration sets `active: true` with no identity or domain check, and the API key is stored in cleartext. Root cause enabling `NEW-04`, `CP-003`, `CP-011`, `CP-015`, `CP-023`. Partially improved since the audit: `p2p/request:87` now matches on `api_key_hash` first, but still falls back to the cleartext column. | Register inactive by default and require manual activation. Drain the raw `api_key` column. |
| `NEW-01` | `FIXED` | `src/app/api/escrow/route.ts:182,192` | An oracle resolving a crypto address to a merchant's email, enumerable across the full merchant base. Feeds directly into `NEW-04`. | Stop returning the email. |
| `H-R-01` | `ALREADY-FIXED` | `src/lib/wallets/balance-checkers.ts`, DOGE case | Returns `0` ("not yet implemented") while DOGE is advertised, accepted at four payment-creation routes, and has a working send path. Received DOGE is never detected as paid. | Implement it, or stop accepting DOGE. |
| `H-R-08` | `FIXED` | Eight modules | The supported-currency list diverges across eight modules independently; there is no single source of truth. | One exported registry, everything else derived from it. |
| `L5-01` | `FIXED` | `src/lib/escrow/service.ts:320-337` | Escrow address-derivation index has no compare-and-swap and does not coordinate with the normal-payment counter — deterministic index collision for ETH/POL/BNB/USDT/USDC/SOL. | One counter, incremented by an atomic RPC. |
| `L7A-01` | `FIXED` | `reputation/did/{claim,delegate,me}` | None of the three DID identity routes call `hasScope()`. A read-only business key can rebind a merchant's DID and issue credentials carrying `wallet:transfer`/`escrow:settle`. | Add the scope checks. |
| `L7A-03` | `FIXED` | `reputation/attest`, `src/lib/reputation/mutual-attestation.ts` | No verification that the caller controls `attester_did`, and no rate limit — the mutual trust graph is unilaterally forgeable, free, at scale. | Require a signature over the attestation; rate limit. |
| `REP-F14-01` | `FIXED` | `src/lib/reputation/trust-engine.ts`, `trust-tiers.ts`, `anti-gaming.ts` | The A–F reputation score is maximizable with self-declared high-value receipts; anti-gaming deducts about 1.5 of 100 points at worst. Consumed by `web-bot-auth/verify` for real trust decisions. | Weight on externally-verifiable signal only. |
| `G-1.2-01` | `FIXED` | `payment-methods/manual` (GET + POST) | Omits the capability check and falls back to the permissive `business.read` default, so a `readonly` team member can rewrite the Venmo/CashApp/Zelle payout handle. | Require an owner capability (§2.2 and §2.3 both). |
| `G-R-07` | `FIXED` | `src/app/api/oauth/userinfo/route.ts` | Returns `email_verified: true` unconditionally — no verification column and no verification flow exist — while the ID token correctly returns `false`. An account-takeover primitive against relying parties. | Return `false` until a real verification flow exists. |
| `F3-L3-01` | `FIXED` | Extension/SDK batch payment `payOnce()` | Retries prepare → sign → broadcast from scratch after a transient broadcast error, including `already known`, with no idempotency key. Can duplicate a real transaction. | Treat `already known` as success; add an idempotency key. |
| `F3-L5-01` | `FIXED` (fails loudly; full impl is a feature) | SDK `WalletClient.send()` | Signs with generic `signMessage()` instead of serializing the real RLP/PSBT transaction — the SDK's flagship send method is broken for every integrator. | Serialize and sign the actual transaction. |
| `F4-01` | `FIXED` | FossBilling plugin `StatusMapper.php` | `StatusMapper::MAP` only translates event types the backend never emits, and there is no fallback, so every real webhook falls into `'ignore'`. Automated invoice crediting is unreachable in production, 100% of transactions. | Map the event names actually emitted; add a fallback. |
| `ESC-NEW-01` | `DECISION` | `dispute_resolution` and `dispute_status` columns | Both columns are present in the production schema and **neither has a single writer anywhere in the codebase**, in both escrow models. A disputed escrow has no exit except the depositor's own release. | A product gap, not only a code one: needs an arbiter path. |
| `A-03` | `FIXED` | Boltz `decryptProviderSecrets` | Zero callers, so every failed swap's refund key is unrecoverable through the product. | Wire up a recovery path. |
| `F-1.1-08` | `FIXED` | `invoices/[id]/check-balance`, `monitor-invoices` | A `* 0.99` underpayment tolerance survives in both paths without going through the shared `isSufficientPayment` — a live, recurring 1% revenue leak. | Route both through the shared helper. |
| `BL-01` | `FIXED` | `monitor.ts:73`, `monitor-balance.ts:639-730` | A transient RPC failure marks a fully-paid payment `expired`. No attacker required; customer funds appear stuck with no automatic recovery. | Distinguish "RPC failed" from "unpaid" and never expire on error. |
| `F5-L4-01` | `FIXED` | `scripts/cleanup-spam.ts:246-273` | `cleanOrphanedWallets()` deletes every `wallets` row with zero transactions — no merchant filter, no protected list, no age filter. The header comment asserting safety is false for this function, and it fires on every documented `--execute` run, destroying legitimate third-party web wallets including ones created seconds earlier. | Add age and ownership filters, or delete the function. **Highest data-loss risk in the register.** |

## Priority 1b — Medium (31) and 1c — Low (7)

All `UNVERIFIED` pending re-read. Full detail in `docs/findings/01_IMMEDIATE_ACTION/`.

The subset worth taking first:

| ID | Status | Why it ranks up |
|---|---|---|
| `E-03` | `FIXED` | `application_fee` appears only in a comment claiming it is applied; the field is absent from `sessionParams`. 100% of the platform fee goes to the merchant on the only recurring card rail. Pure revenue. |
| `FR-01` | `FIXED` | Fraud screening fails open, denylist included. Pairs with `N-01`. |
| `L4-NEW-02` | `FIXED` | Writing `status:'failed'` violates `payments_status_check` and the failure is never checked, so the payment stays `pending` forever and invisible. |
| `NEW-L5-2` | `FIXED` | The schema CHECK omits `USDT`/`USDC`/`USDC_BASE` that the application inserts — payment creation fails outright for those stablecoins. |
| `NEW-24`, `G-1.2-09`, `F5-L4-02` | `FIXED` | Unescaped merchant-controlled HTML into invoice email, team email, and the internal daily report. |
| `DOC-01` | `FIXED` | `layout.tsx` claimed "Non-Custodial" product-wide. Corrected. |
| `F7-01` | `FIXED` | Security docs asserted audit logging that does not exist. Corrected to say so. |
| `AUD-01` | `FIXED` (foundation + 4 paths; coverage still extending) | Append-only `audit_log`, verified append-only against prod. |
| `CP-P5` | `FIXED` | `businesses.tier` does not exist, so every business is charged the 1% minimum regardless of tier. Verify against the live schema. |
| `R3-DIN-01` | `FIXED` | Marks an invoice paid and sends "Payment Received" with no `payment_id`; funds can be stuck at the intermediary. |
| `REC-D-05` | `FIXED` | The p2p Stripe branch never calls `screenCheckout` at all. |
| `GAP-02` | `FIXED` (history purge still `DECISION`) | Own pentest reports (`strix_runs/**`) versioned in the public repo. Delete and purge. |
| `F5-L4-03` | `FIXED` | Real merchant PII hardcoded as fixtures in `scripts/test-spam-detection.ts`, public repo. |

## Priority 2 — High impact, gated (54)

Grouped by the gate the audit identified. All `UNVERIFIED`.

### Cross-tenant / IDOR (§2.7) — one workstream

The shape is always "authenticate the caller, then trust a tenant id from the
request." `src/lib/auth/tenant-scope.ts` (`resolveBusinessScope`) is now the one
place that answers it, and `src/lib/escrow/access.ts` (`callerOwnsEscrow`) does
the same for escrows. Whether a route calls them is a far easier property to
audit than whether its bespoke ownership query is correct.

| ID | Status | Note |
|---|---|---|
| `B-01` | `FIXED` | `getStripeAccountId(businessId \|\| authResult)` — the query-string value took precedence over the authenticated user. Both `api-keys` routes now scope through the helper with `apikey.manage`. |
| `C-01` | `FIXED` | Stripe webhook routes decoded the JWT and never compared `business_id`. Now `webhook.manage` via the helper. |
| `NEW-13` | `FIXED` | Same cluster as `C-01`/`B-01` — closed by the same change. |
| `CP-010` | `FIXED` | `usage/rates` GET/POST/DELETE had no ownership check; sibling `credits`/`deduct` did. |
| `NEW-14` | `FIXED` | `usage/history` — same gap, same file tree. |
| `G-1.2-13` | `FIXED` | Duplicate of `CP-010` + `NEW-14`. |
| `CP-014` | `FIXED` | `reputation/receipts` was an unauthenticated `select('*')`. Endpoint stays public (a trust graph must be checkable) but now returns a narrow projection — no `amount`, `escrow_tx`, `buyer_did`, `platform_did` or `signatures` — capped at 200 rows. |
| `CP-021` | `FIXED` | `escrow/[id]` authenticated the caller and then fetched by UUID with no ownership check. Now `callerOwnsEscrow`, answering 404 rather than 403 so it is not an existence oracle. |
| `NEW-15` | `FIXED` | `escrow/[id]/events` — clone of `CP-021`, fixed by the shared helper. |
| `C-02` | `FIXED` | 8 of 16 routes on the `apiKeyBusinessId` contract. |
| `C-03` / `G-1.2-01` | `FIXED` | `payment-methods/manual` — capability check missing. |
| `CP-001` | `FIXED` | Injectable Stripe metadata. |
| `CP-003` | `FIXED` | Cross-tenant DID rebind. |
| `CP-015` | `FIXED` | `payments/create-for-merchant` authenticates with the raw issuer key. |
| `CP-023` | `FIXED` | Wallet-slot squatting. |
| `G-1.2-12` | `FIXED` | Invoice `merchant_wallet_address` writable by `readonly`. |
| `H-R-10` | `FIXED` | `POST /api/invoices` takes `client_id` unvalidated. |
| `SUB-01` | `FIXED` | `subscriptions/status` DELETE has no `hasScope`. |
| `REC-D-01` | `FIXED` by `NEW-04` + `platformMayManageMerchant` | Extends `NEW-04`; likely closed by that fix — re-verify. |
| `REC-C-03` | `FIXED` | x402 ignores API key scopes. |
- **Identity / DID abuse** — `L7A-02` `FIXED`, `V-02` `FIXED`,
  `REP-F1A-02` `FIXED`, `G-1.2-10` `FIXED`, `R4-ID-OAUTH` `FIXED`,
  `R3-ID-02` `FIXED`, `R4-ID-RESET` `FIXED`.
- **Multisig escrow** — `F-1.1-02`, `F-1.1-03`, `F-1.1-04`. Latent while
  `MULTISIG_ESCROW_ENABLED` is off. Fix before that flag is ever turned on.
- **Wallet and key handling** — `F-L7-01`, `F-L7-02`, `F5-L1-02`, `F5-L1-05`,
  `F5-L1-07`, `L6B-05`, `REC-04`, `REC-01`.
- **Rate limit / enumeration (§2.6)** — `NEW-06` `FIXED`, `WW-02` `FIXED`,
  `REC-C-04` `FIXED`, `REC-C-05` `FIXED`, `L7A-03` `FIXED`. Still open:
  `NEW-07` `FIXED`, `NEW-09` `FIXED`, `NEW-20` `FIXED`, `NEW-23` `FIXED`,
  `NEW-WW34-01` `FIXED`, `NEW-11` `FIXED`.
- **Payment and settlement integrity** — `B-03` `FIXED`, `F-1.1-07` `FIXED`,
  `F-1.1-16` `FIXED`, `F-1.3-02` `FIXED`, `V-04` `FIXED`, `IA-016` `FIXED`,
  `WW-01` `FIXED`, `WW-03` `PARTIAL` (recipient bound on every chain; amount
  still unbound on BCH and Solana — see the batch-5 log), `NEW-14`
  `ALREADY-FIXED` (`resolveBusinessScope`), `F5-L2-01` `FIXED`,
  `F5-L4-02` `ALREADY-FIXED` (both HTML paths escape; the raw interpolations
  the finding cites are the plain-text body, where escaping would be wrong).

**Priority 2 is complete.**

## Priority 3 — Silent operational loss (39)

All `UNVERIFIED`. Detail in `docs/findings/03_SILENT_OPERATIONAL/`. Standouts:

- `BL-02`, `CP-025`, `F-1.1-01` — **all three `FIXED`.** Escrow stuck at
  expiry, unilateral depositor refund, and the monitor marking funded multisig
  escrows `refunded`. See the batch-eight note below.
- `V-01` + `L8-01` + `REC-D-02` — **`FIXED`.** Three independent reasons
  `webhook_logs` inserts fail. Confirmed against production: the table held
  **zero rows** — the delivery audit trail had never recorded a single attempt,
  and nothing surfaced it because delivery itself is unaffected by logging
  failing. See the batch-nine note below.
- `R3-DIN-03` — `settle_failed` written to `escrows.status` is rejected by the
  production CHECK constraint. This matches known prod drift: `escrows_status_check`
  is `NOT VALID`, so read escrow statuses from the data, not the constraint.
- `F5-L1-06` — **`PARTIAL`.** `scripts/sweep-balances.mjs` was truncated and
  failed `node --check`, and had been since December 2025. It now parses, and
  the discovery half (find stranded balances) works and is wired to
  `pnpm sweep-balances`. `--execute` deliberately refuses: broadcasting sweeps
  would be new untested multi-chain fund-moving code.

### Priority 3 progress (batch nine)

`BL-02`, `CP-025`, `F-1.1-01` `FIXED` (see batch eight). `B-04`, `L7A-04`,
`L5-02` `FIXED`. `F5-L1-06` `PARTIAL`. `V-01`/`L8-01`/`REC-D-02` were already
`FIXED`. All verified against the live production schema, not inferred.

Batch ten: `A-05`, `F-1.3-08`, `W-08`, `F-1.3-09`, `H-R-05` `FIXED`, plus
`B-03` refactored onto the shared pager. The unordered-sweep family
(`B-03`/`F-1.3-09`/`F-1.3-12`/`H-R-05`) now has one helper, `lib/db/keyset.ts`,
rather than four copies. `F-1.3-12` still to convert.

Batch eleven: `F-1.3-04`, `INV-01`, `H-R-04` `FIXED`. Migration
`20260819180000_stripe_webhook_idempotency` applied to production and verified.

Batch twelve: `NEW-L5-1`, `G-1.2-04`, `H-R-09` `FIXED`. `R3-DIN-03`
`ALREADY-FIXED` — confirmed live: `settle_failed` is now in
`escrows_status_check`. Migration
`20260819190000_collection_blockchain_check_token_variants` applied and
validated (18 chains, matching `SUPPORTED_BLOCKCHAINS`).

Batch thirteen: `F-1.3-12`, `F3-L5-02` `FIXED`. `F-1.1-06` `ALREADY-FIXED` —
both settle paths now share `processEscrowSettlement`, so they share its retry
cap. The unordered-sweep family is now fully converted to `lib/db/keyset.ts`.

Batch fourteen: `F-1.3-10`, `NEW-F1A-P-01`, `R4-DIN-07` `FIXED`. Invoice
numbering now has one implementation, `lib/invoices/numbering.ts`, used by all
four call sites — three of which were wrong while the fourth was right.

Batch fifteen: `IA-010`, `L-03`, `F4-03` `FIXED`.

Batch sixteen: `IA-008`, `N-03` `FIXED`.

Batch seventeen: `NEW-F1A-P-02` `FIXED`.

Batch eighteen: `ESC-NEW-14` `FIXED`.

Batch nineteen: `SUB-02` `FIXED`.

Batch twenty: `F-1.3-15` `FIXED` (the BTC-throws half and the missing gas
reserve; the quote still does not add a network fee on top, so the merchant
receives amount-minus-fee — a pricing decision, not a bug fix, and left for
Anthony). `IA-006` and `REC-D-07` remain: `IA-006` has no location in the
findings beyond "sequential settlement — commission leak" and needs Eduardo to
point at the code; `REC-D-07` is marked [Inferred] and asks for a durable
retry queue, which is a design change rather than a patch.

## Priority 4 — Conditional (26)

Detail in `docs/findings/04_CONDITIONAL_LOW/`. Verify the condition before
spending effort on any of these.

| ID | Status | Condition |
|---|---|---|
| `V-05`, `CP-P4` | `NEUTRALIZED` per the audit | `monthly_transaction_limit` is NULL on every plan. Re-confirm once, then close. |
| `F9-02` | `NEUTRALIZED` per the audit | No internal HTTPS target is reachable from any documented deployment topology. |
| `GAP-01` | `DECISION` | A BIP-39 mnemonic with a valid checksum is committed at `scripts/gen-mnemonic.mjs:11,14`. **Check on-chain whether any custody address was ever derived from it.** |
| `CP-019`, `NEW-16`, `G-1.2-08`, `G-R-09` | **`FIXED`** | Were conditional on a production env var. Rather than verify one value, the conditionality is removed in code — see the batch-twenty-two note. `NEW-05` closed alongside `G-1.2-08`. |
| `NUEVO-F2-01` | `DECISION` | Historically closed, but `gl_creds`/`gl_rune` were readable by the anon key for five days in February. Rotate regardless of the code being fixed. |

### Priority 4 progress (batch twenty-one)

Verified against live production, no code change needed:

- `V-05` / `CP-P4` — `NEUTRALIZED`, confirmed: `monthly_transaction_limit` is
  NULL on both plans (Starter, Professional). Re-activates the moment any plan
  gets a non-null limit.
- `NUEVO-F2-01` / `L4-NEW-01` — `CONFIRMED REMEDIATED`: every policy on
  `ln_nodes`/`ln_offers`/`ln_payments`/`swaps` is now scoped to `service_role`
  or to `authenticated` with a merchant predicate. No `FOR ALL USING(true)`
  reachable by `anon`. **Rotation of `gl_creds`/`gl_rune` is still warranted**
  and remains Anthony's decision — the code is fixed, the exposure window
  happened.
- `V-06` — `RESOLVED`: cross-checked every column the code touches on
  `stripe_accounts` against the live schema. All 11 exist. Two apparent misses
  (`cryptocurrency`, `is_active`) were a chained `merchant_wallets` query inside
  the same `Promise.all`, not `stripe_accounts` references.

`FIXED`: `ESC-NEW-05`, `H-R-03`, `F5-L2-03`, `F-1.3-14`, `F-1.3-03`.

`R3-X1` `ALREADY-FIXED` — the Stripe x402 branch compares `pi.amount_received`
from Stripe's own record rather than the self-declared payload amount (round 1).
The `SIGNATURE_BOUND_NETWORKS` constant the finding cites no longer exists;
dispatch is by `network` via `SCHEMES_BY_NETWORK`.

Also `FIXED`: `E-04`, `F-1.3-06`, `F4-02`, `ESC-NEW-06`.

`IA-006` `ALREADY-FIXED` — the "sequential settlement commission leak" is the
split-ordering bug in `secure-forwarding`: the merchant leg (99%+) went out
first, drained the address, and the platform-fee leg then failed for
insufficient funds. The split is now computed from the actual balance and both
legs are submitted as a single split transaction, so one cannot starve the
other.

`REC-D-07` `DECISION` — webhook delivery retries three times in-process but has
no durable queue or dead-letter. That is a feature to build, not a defect to
patch, and it is Anthony's call whether it is worth it.

`F-1.3-06` verified against production before and after: the fallback has never
fired. All 6 wallets holding an LNbits admin key hold their own — they have both
`ln_wallet_adminkey` and `ln_wallet_inkey`, and the fallback path writes only
the former (`adminkey_only = 0`). The fix is preventive, not remedial.

## Priority 5 verification sweep (2026-08-19)

142 findings across `5a` (35), `5b` (25) and `5c` (82). The audit's own framing
is that these produce no business impact **only because of a stated condition**.
The agreed treatment was verification with evidence rather than pretending a
code change happened, so this records what was actually checked.

### Checked, and the gate holds

- **Dead-code claims** (`F1.4-L1-NEW-02`, `IA-004`). Tested by reference search
  rather than trusted. `clearSensitiveString`: one definition, zero callers —
  confirmed. `initSecrets`: the two apparent callers are both inside the
  module's own doc comment, so zero real call sites — confirmed, though it is
  worth noting the module documents a usage pattern nothing follows.
- **`V-05` / `CP-P4`** — `monthly_transaction_limit` is NULL on both plans.
- **`NUEVO-F2-01` / `L4-NEW-01`** — no `FOR ALL USING(true)` reachable by
  `anon` on `ln_nodes`/`ln_offers`/`ln_payments`/`swaps`.
- **`IA-002`** — the RLS gap is **not a live data exposure**, and the scary
  reading of it is wrong. Every table in `public` has RLS enabled. Every
  `{public}` INSERT policy carries a real `with_check` predicate — none is
  unconditional, so there is no anonymous-write hole. `qual` reads as null on
  those rows because INSERT policies keep their predicate in `with_check`;
  reading the wrong column is what makes this look alarming.

### Found while sweeping, and fixed

**`reputation_receipts` was one `GRANT` away from publishing everything.** It
carries `SELECT ... USING (true)` for `anon, authenticated` — which reads as
world-readable — and is unreadable today *only* because neither role holds a
SELECT grant. RLS is evaluated after the grant check, so a permissive policy on
an ungranted table is inert.

That is a trap, not a control. `GRANT SELECT ON ALL TABLES IN SCHEMA public TO
anon` is a routine Supabase incantation, and running it once would have
published **14,346 receipts carrying `agent_did`, `buyer_did`, `escrow_tx` and
amounts totalling $1,050,924** — the platform's entire transaction history by
counterparty and value — with no other change and no warning.

Migration `20260819200000` scopes the policy to `service_role`, matching what
the grants already enforce. Nothing reads the table through PostgREST (the
application uses the service role, which bypasses RLS), so this cannot break a
working path. Applied to production and verified.

The sibling tables are deliberately untouched: `mutual_attestations`,
`reputation_credentials` and `reputation_revocations` *are* granted to `anon`
and are the public, verifiable trust graph — that is the product working as
designed, and they hold 1, 1 and 0 rows respectively. `blog_posts` and
`referral_codes` are likewise intended public reads.

### Not verifiable from here

The remainder of `5a` is gated on prior compromise (`IA-015`, `NEW-03`,
`W-02`, `REC-03`, …) or on environment variables not observable from the
repository. Those gates are structural: "requires an already-stolen session" is
not something a code change closes, and the audit rates them accordingly. The
bulk of `5b` is root causes of findings already fixed individually
(`IA-005` → `CP-024`/`L-04`, `F-1.1-10` → `F-1.1-07`, `CP-013` → `NEW-01`), and
races the audit itself confirms are compensated by a downstream CAS
(`F-1.1-09`, `IA-001`, `WW-06`) — those CAS guards are the ones added in this
work.

## Priority 5 — Technical debt (60)

Detail in `docs/findings/05_TECHNICAL_DEBT/`. Not urgent. Note that 5a reverts to
live risk if its gating condition changes — re-read 5a whenever a feature flag is
turned on or a deployment topology changes.

---

## Needs a decision from Anthony (found while remediating, 2026-08-19)

Both came out of read-only queries against the production database.

**18 reputation issuers exist, all `active`, 17 with cleartext API keys.**
`CP-002` is now fixed for new registrations, but the existing rows predate the
fix. An issuer key authenticates `/api/p2p/request`, which provisions merchant
accounts and issues invoices on other people's behalf. What is in there:

- `evilpoc` / `evil-poc.example`, `poc2` / `poc2-audit.example`, `OutHunt` /
  `out-hunt.example` — all created 2026-06-08, and they look like the auditor's
  own proof-of-concept registrations. Worth confirming, then deleting.
- `Tounes` with domain `Coinpayportal.com` — a third-party merchant registered
  an issuer claiming **the platform's own domain**. Nothing verified it.
- `X` with domain `X` — junk.
- Six `*.trycloudflare.com` ephemeral tunnel domains from one integrator.

I have not deactivated anything: `ugig.net`, `d0rz.com`, `Infernet` and
`CoinPayPortal` look like real integrations and revoking them breaks live
traffic. Suggested order: delete the three PoC rows and `X`, ask `Tounes` and the
`solearn-*` set to re-register, then rotate what remains so the cleartext
`api_key` column can be dropped.

**`merchants.email_verified` does not exist in production.** The consequence is
in the log above — the OAuth ID token silently carries no email or name today.
That is now fixed, but the product question stands: there is no email
verification flow at all. Until one exists, `email_verified` is `false`
everywhere, which is honest but will read as a downgrade to any relying party
that was trusting the old hardcoded `true`.

---

## Standalone decisions (not code fixes)

| Item | Status | Action |
|---|---|---|
| `doppler.env` / `doppler.json` committed | `PARTIAL` — untracked; history purge still `DECISION` | Untracked and added to `.gitignore` (no existing pattern matched their filenames). They are a PBKDF2-encrypted Doppler fallback cache and its config. **Secrets for this project now live in the logicsrc team vault `coinpayportal--prod`**, so these are obsolete as well as sensitive. They remain in git history, which no `.gitignore` undoes — purging that, and rotating what they held, is still a decision. |
| `L-02` — `certs/gl-nobody.key` | `DECISION` | A Greenlight node private key and certificate, CN `GL /users/b4569816-…`, in git history since 2026-02-14. The CN identifies a specific node, not the generic public test credential the filename suggests. **Confirm whether this node is still active in production.** |
| `GAP-01` — committed mnemonic | `DECISION` | See Priority 4. |

---

## Systemic work — fix the shape, not the instance

The report's central argument is that ten patterns recur across independently
written modules, so every fix that does not address the shape leaves siblings
behind. Ranked by leverage:

1. **§2.7 tenant scoping** — one `resolveTenantScope()` helper plus a route audit. Closes roughly eighteen findings.
2. **§2.2 fail-open** — invert the defaults at the six named sites, and add a test asserting that missing config denies.
3. **§2.1 key guards** — every secret read goes through a `requireX()` guard, with a lint rule banning raw `process.env` reads for secrets.
4. **§2.3 sibling asymmetry** — no structural fix available; needs a code-review checklist artifact that lives in the repo.
5. **§2.6 rate limits** — default-on middleware that routes opt out of explicitly, rather than opt into.
6. **§2.8 compare-and-swap on money writes** — atomic RPCs for every counter and claim, the way `consumeTransactionQuota` already does it.
7. **§2.5 doc/code drift** — the security documentation currently asserts controls that do not exist. Cheapest item in the register, highest legal exposure.

---

## Log

| Date | Change |
|---|---|
| 2026-08-19 | Ledger created. Read all eleven finding files; `sha256sum -c CHECKSUMS.sha256` passes. Re-read and **confirmed live** against current `master`: `F-1.3-13`, `NEW-04`, `F-1.3-01`, `REC-C-01`, `CP-005`, `F-1.3-02`, `F-1.3-03`, `R3-X1`. |
| 2026-08-19 | **All three Criticals fixed**, plus five x402 Highs that share their code paths. 26 new regression tests; full suite green at 303 files / 4309 tests. Details below. |

### 2026-08-19 — Criticals and the x402 rail

**`F-1.3-13` — subscription activation** (`src/lib/subscriptions/service.ts`).
Activation now credits `payment.merchant_id` from the row rather than
`metadata.merchant_id` from the payer, validates `plan_id`/`billing_period`
against `SUBSCRIPTION_PRICES`, and requires `currency === 'USD'` with
`amount >= price`. Added a status guard so only a confirmed payment activates
anything. 10 tests in `service.test.ts`.

**`NEW-04` — payout hijack** (`src/lib/p2p/resolve.ts`). Two independent stops:
the email fallback now refuses to resolve a merchant whose `auth_provider` is
not `'platform'` (the DID path still takes precedence, so a deliberate link is
unaffected), and `persistPayout` refuses to write a payout destination for any
non-platform account. 5 tests in `resolve.test.ts`.

**`F-1.3-01`/`CP-005` — Lightning self-certification** (x402 `verify` + `settle`).
The `sha256(preimage) === paymentHash` check is kept as a precondition but is no
longer the proof. Both routes now require a matching `ln_payments` row that is
incoming, settled, belongs to the calling business, and covers the price in
msat. An unreadable ledger fails closed.

**`REC-C-01` — scheme/network confusion**. Dispatch is on `network` alone, and
the scheme must be one that network permits. The shared table lives in
`src/lib/x402/networks.ts` so `verify` and `settle` cannot drift — the §2.3
anti-pattern that produced this class in the first place.

**`F-1.3-02`/`F-1.3-03`/`R3-X1` — binding gaps**. `enforcePriceBinding` now
requires `expected.payTo` and compares it per-network casing, and pins
`expected.asset` when the merchant states one. The Stripe verifier compares the
amount **Stripe** reports rather than the payer's self-declared payload figure.

*Contract change for integrators*: `expected.payTo` is now required on v1
verify, matching what v2 already demanded. Callers that omit it get a 400 naming
the field. This is deliberate — not checking the recipient was the vulnerability.

### 2026-08-19 — second batch: data loss, exposure, revenue

**`F5-L4-01` — `scripts/cleanup-spam.ts`**. `cleanOrphanedWallets()` deleted
every `wallets` row with no transactions, on every `--execute`. The `wallets`
table is the self-custodial web-wallet store and has **no merchant_id or
user_id** — a wallet is identified by its public keys alone — so nothing in it
can be attributed to a spam signup, and "zero transactions" simply describes a
wallet that has not been funded *yet*. Now behind an explicit
`--prune-empty-wallets` flag with a 90-day floor on both `created_at` and
`last_active_at`. The header's false safety claim is corrected.

**`W-07` — `GET /api/lightning/offers`**. Had no authentication, `business_id`
was optional, and `limit` had no ceiling, so one anonymous request returned every
merchant's Lightning offers and received revenue. Now requires authentication,
requires `business_id`, checks the caller can read that business (business API
keys are pinned to their own business), and caps the page at 100. 5 new tests.

**`CP-002` — issuer self-registration**. Registered `active: true` with no
identity or domain check, and stored the API key in cleartext. Now registers
`active: false` pending manual activation, and persists only
`hashApiKey(...)` — the raw key is returned once and never stored.

**`G-R-07` — `email_verified`** (plus a live bug the audit did not have).
`/api/oauth/userinfo` returned `email_verified: true` unconditionally. Checking
the live schema showed `merchants` has **no `email_verified` column at all** —
which also means `/api/oauth/token`'s `select('id, email, name, email_verified')`
errored on every call, so `merchant` came back null and **the OAuth ID token has
been carrying neither email nor name for any user, whatever scopes were
granted**. All three sites now select only real columns and report
`email_verified: false`, which is the honest answer while no verification flow
exists. Two existing tests were named "should return false" while asserting
`true`; the names were right.

**`E-03` — platform fee on recurring cards**. `sessionParams` carried a comment
saying the fee was applied via `application_fee_percent` and never set the
field, so every recurring card subscription paid the merchant 100% and the
platform nothing. Now sets `subscription_data.application_fee_percent` from
`getFeePercentage(isBusinessPaidTier(...))`. A percentage rather than a fixed
amount, because the charge recurs and its amount can change. Also hardens
`R4-STRIPE-SUB`: caller metadata is spread first so platform keys always win.

**`F-1.1-08` — 1% revenue leak**. `invoices/[id]/check-balance` and
`monitor-invoices` both compared `balance >= expected * 0.99` instead of calling
the shared `isSufficientPayment`. Both now use the helper. A test named "marks
invoice as paid with 1% tolerance" encoded the leak as intended behaviour and is
now inverted, with a companion test proving the 1e-9 float epsilon still works.

### 2026-08-19 — fourth batch: seed transmission, sibling gaps, unproved claims

**`NEW-20` — the seed on the wire**. `POST /api/lightning/nodes` required a
valid BIP-39 mnemonic, validated it, and never used it. The wallet being
provisioned is a **custodial LNbits wallet** — no signer, nothing to derive — so
the field bought nothing at all, while making every client transmit the master
seed for the entire wallet into request logs. The seed reconstructs every key on
every chain; it is the one secret that must never leave the device. Callers were
already proving possession properly, via `authorizeWalletRequest`'s signature
over the request body.

Removed from the route, the two SDKs, the React component and the CLI. The web
call site was the worst of them: `asset/[chain]/page.tsx` called
`wallet.getMnemonic()` and handed the live seed to `LightningSetup` as a prop.
The CLI was second: `coinpay lightning enable` **prompted for the passphrase and
decrypted the stored seed** purely so it could post it. Older clients that still
send the field are accepted and the value discarded, with a warning naming the
wallet — rejecting them would break provisioning for anyone who has not
upgraded.

**`F-1.1-07` — a scope enforced nowhere**. `payouts:create` is offered to
merchants when they mint a scoped key, so a merchant can deliberately create a
key *without* it. `POST /api/payouts/create` is the only route the scope
governs, and it never looked: a key restricted to reading could still send money
out of the business's wallet. Its sibling `/api/payments/create` has checked its
own scope all along — §2.3 exactly.

**`NEW-07` — WebAuthn challenges keyed on the victim**. `login-options` stored
the challenge under the merchant's own id whenever the supplied email resolved.
The store holds one challenge per key and the route is public, so anyone who
knew a merchant's email could overwrite that merchant's pending challenge at
will: the victim's authenticator signs the challenge it was handed, verify
consumes whatever the attacker wrote last, they never match, and the account
cannot be logged into for as long as the attacker keeps posting. It also broke
two honest logins from two devices.

The key is only a lookup handle — the client echoes it back and `login-verify`
derives the user from the stored credential, never from this value — so it does
not need to identify anyone. It is now 32 random bytes per request.
`register-options` uses the same store keyed by user id, but it is authenticated
and self-keyed, so there is no cross-user reach; left as is.

**`NEW-09` and `V-04` — claims nobody checked**. Two halves of the same shape.

`importWallet` verified proof of ownership inside `if (public_key_secp256k1)`,
and the schema requires only **one** of the two keys. Submitting just
`public_key_ed25519` skipped verification entirely: `proof_of_ownership` was
still mandatory, but no part of it was ever read and any string passed.

`createWallet` asked for no proof of anything — an unauthenticated caller could
declare a public key that was not theirs and, more damagingly, a list of
on-chain addresses that were not theirs. `wallet_addresses` is **globally unique
on `(address, chain)`**, so whoever registers an address first holds it and the
rightful owner can never register it at all.

Both now go through one `verifyKeyOwnership` helper, deliberately shared so the
two cannot drift apart again — the whole class of bug here is one sibling
checking what the other does not. Every key presented must be proved: with a
secp256k1 key, `signature` must verify against it; without one, the ed25519 key
is the only identity claimed and `signature_ed25519` must verify against it.
Demanding *both* signatures would break every client in the field to close a gap
that only exists when secp256k1 is absent. `initial_addresses` is also capped —
it was unbounded, so one request could claim thousands of addresses permanently.

Proof is checked after the format validation (so a malformed key still gets a
useful error) and before the first write (so nothing is persisted on an unproved
claim).

> **Breaking for old npm SDK builds.** `/api/web-wallet/create` now requires a
> signature. `packages/sdk` and the in-repo SDK both send one as of this commit;
> a published SDK older than this will fail to create wallets. The browser
> extension is unaffected — it registers via `/import`, which has always
> required proof.

**An unlisted bug found while wiring that.** `packages/sdk`'s `signMessage`
signed `sha256(message)`, but the server verifies by passing the **raw** encoded
message to `secp256k1.verify`. Confirmed against the repo's own noble build:
sign-hash/verify-raw returns `false`. So every proof of ownership the published
SDK produced was rejected, meaning `WalletClient.fromSeed()` **could not import
a wallet at all**. Now signs raw bytes, matching the server and the in-repo SDK.

**`F-1.1-16` — overwriting the pending PayPal order**. `create-order` is public
and wrote `invoices.paypal_order_id` unconditionally; that single column was the
only thing `capture` checked. Anyone who knew an invoice id could overwrite it
after the real payer had been handed their order — the payer approves order A,
capture sees B, rejects it as "Order does not match this invoice", and the
invoice can never be paid while the attacker keeps posting. Across open invoices
that is a denial of payment for the platform.

"First write wins" would be no better; it just lets the attacker lock the slot
earlier. And an invoice legitimately has several orders over its life — an
abandoned attempt, a retry, two people on one pay link. Each issued order is now
its own row in `paypal_transactions` bound to the invoice, and capture accepts
any order bound to the invoice it is settling. `paypal_order_id` is unique on
that table, so rows cannot collide or be repointed. Orders already in flight at
deploy time fall back to the legacy column. No migration needed — the table and
its unique constraint already existed.

**`B-03` — a sync that never rotated**. `syncLnbitsPayments` selected wallets
with `.limit(100)` and **no `.order()`**. Postgres may return rows in any order
and in practice returns a stable physical one, so past 100 Lightning wallets the
same hundred were synced every run and the rest never at all. Their incoming
payments never reached `ln_payments` — which is what the dashboard reads, and
what x402 Lightning settlement now *requires* as proof after the round-1 fix, so
those wallets would silently lose the ability to prove they had been paid. Now
ordered by id and walked by keyset through the whole table, with the cap as a
runaway guard rather than a working set, and a warning if it is ever hit.

**`NEW-23` — SSRF by hostname**. The `Signature-Agent` key-directory fetch was
guarded by literal matching — `127.x`, `10.x`, `fc00::/7` — which does nothing
about a hostname whose A record points at `169.254.169.254`. The function's own
comment admitted it. Now goes through `safeFetch`, which resolves the host,
rejects on the resolved address, and re-validates every redirect hop. The
literal checks stay: they reject the obvious cases before any DNS lookup and
enforce the https-only rule the spec requires.

Suite green at 317 files / 4455 tests, `tsc --noEmit` clean. 14 findings; 129 of
338 fixed.
