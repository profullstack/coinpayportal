# CoinPay Lending and QuickBooks sync design

## Context and status

Source: `prd/0001-coinpay-lending-quickbooks-sync.md`. All decisions below are proposed. No runtime changes, database migrations, provider onboarding, paid checks, deployment, or financial execution are part of this documentation delivery.

The supplied PRD preserves a September 12 inspection at `cd4cb3ad2b1939e16e4f04f3fe53bc19abeb86ff`. A limited local inventory for this bundle on September 14, 2026 used checkout HEAD `8dde009aefc3ccf3cabb2af0d4230cc7165c3e69` on `cfo-report`. These observations are not a production audit or test result:

| Local source | Observed boundary | Implementation follow-up |
|---|---|---|
| `package.json` | Next.js 16, React 19, TypeScript, pnpm, ESM, Vitest/Playwright | Extend the pinned application; validate changes through its existing tools |
| `src/lib/finances/simplefin.ts` | Backend claim/access client, decimal strings, v1/v2 error types | Verify explicit requested protocol version, capability recording, URL security, and version fixtures before relying on it |
| `src/lib/finances/provider.ts`, `sync.ts`, `src/app/api/finances/` | Existing finance sources and API surface | Reuse connection identities and retention; inspect reconciliation and legal-entity scope |
| `src/lib/supabase/server.ts` | Supabase client factory, lazy admin client and user client | Preserve the abstraction; establish actual self-hosted PostgreSQL/auth deployment and migration procedure before implementation |
| `supabase/migrations/20260819220000_finances_per_merchant.sql` | Merchant ownership on finance connections | Merchant ownership alone does not establish which legal business may use an account for bookkeeping or underwriting |
| Root `bin/coinpay` and `packages/sdk/bin/coinpay.js` | Distinct installed command targets | Verify both package install paths; expose the same service policy in both |
| `packages/sdk/package.json` | Published ESM package with JavaScript and declaration exports | Preserve consumer compatibility; add declarations and entry-point coverage with new bindings |
| Root CLI OAuth code | Existing browser-assisted remote-terminal flow | Reuse the approach only after reviewing security and Intuit-specific callback requirements |
| `docs/ACH.md` | Purchase pay-in notes explicitly report no live exercise | Do not treat it as financing-collection authorization or verified settlement semantics |
| `src/lib/webhooks/retry-queue.ts` | Existing webhook retry code | Evaluate reuse; do not assume it is a transactional financial outbox |

No existing `/lending` or QuickBooks module was found in the targeted inventory. A complete routing, MCP, worker, permission, deployment, and finance-scope inventory remains an implementation prerequisite. The two earlier Library documents named by the PRD were not supplied as repository files; their inherited constraints are captured in this PRD, and their implementation claims still require reconciliation.

## Goals and non-goals

Make accounting independently useful, keep source evidence reproducible, and prevent a UI toggle or agent from creating financial authority. Preserve external capital funding and mandatory product/account SimpleFIN qualification across all rails.

Do not create separate SimpleFIN credential storage, redesign existing auth, assume wallet/escrow suitability, offer public retail investing, or use CoinPay principal, first-loss reserves, treasury swaps, pooled funder balances, or guarantees.

## Capability evaluation

Store capability activation separately from provider lifecycle and evidence validity. An evaluator takes tenant/legal entity, product, geography, currency/asset, rail, requested operation, actor authority, and current evidence versions. It returns available/unavailable, applicable reason codes, evidence references and expiry, and allowed next actions. All interfaces consume this evaluator; cached public responses must expire with their evidence and be invalidated on suspension.

Provider lifecycle is `research_only`, `contracting`, `sandbox`, `verified`, `suspended`, or `retired`. `verified` alone does not enable an operation. Missing, expired, revoked, or mismatched evidence fails closed for that operation. Program flags cannot waive contracts, funding authority, legal approval, exact SimpleFIN qualification, or rail/servicing approval. Suspension prevents new consequential actions while preserving authorized servicing, support, reconciliation, and access to existing agreements.

| Capability | Minimum operation-specific conditions |
|---|---|
| Public discovery | Honest waitlist/future copy, privacy and accessible UI; no assertion of live financing |
| Accounting reads | Authorized entity/realm mapping, permitted data-use purpose, valid OAuth and local read authority |
| Accounting writes | Read conditions plus production entitlement when live, approved mappings/plan or scoped rule, local write authority, duplicate/conflict checks |
| Financing applications | Named live provider/product, executed program agreement, external capital authority, exact pre-opening qualification, jurisdiction/data-use/servicing/rail evidence, explicit named-recipient application consent |
| Binding acceptance | Live program conditions plus current complete offer, verified actor authority, reauthentication and separately bound signing/acceptance approval |
| Fiat funding/collection | Applicable program conditions, actual customer account qualification after opening, separate rail mandate and contractual execution authority; funding/collection evidence determines status |
| Stablecoin settlement | Applicable financing conditions plus one approved native asset/chain, control/identity screening, quote/destination/intent validation, finality, refunds, incident policy and custody review |
| Permissioned P2P | Applicable financing and rail conditions plus reviewed offering/origination/servicing/intermediary structure, verified participants and actual external funding; multi-funder and smart-contract conditions are additional |

Post-creation account qualification cannot logically precede account creation. Require exact product/profile/route qualification before recommending or initiating opening, then verify the actual customer's account before using it as a supported financing account. Failure returns to unavailable/review with an approved support path; a compatible repayment bank cannot substitute for the obligation itself.

## Domain and storage

Use self-hosted PostgreSQL as the authoritative transactional store through compatible migrations and the existing access/auth boundary. Confirm the actual deployment before migration. Reuse finance connections and source observations; add references and policy metadata rather than a second bank-data pipeline. No SQLite, Turso, or libSQL financial write path.

Key records are provider products and scoped compatibility evidence; entity/account/realm mappings; separate data-use consents; economic events and observation links; versioned revenue snapshots; QuickBooks connections and posting plans/items/external links; applications/offers/agreements; mandates and bound intents; remittance assessments/reservations/collections; future funder commitments/allocations/distributions; inbox/outbox and audit events.

Scope keys and foreign keys to tenant and legal entity. Preserve upstream identity as tenant + provider connection + upstream connection + account + transaction + source version. Keep original signed decimal text and source debit/credit meaning. Use exact decimal or integer units for computations; serialize money as strings with explicit currency/asset and decimals. Fiat minor units, token atomic units, and base-currency valuations are separate representations.

Enforce uniqueness for source identity/version, approved posting operation, provider inbox event, collection/reservation identity, and distribution identity in the database. Tenant and entity authorization must precede every read or mutation even when an admin database client is used. Financial-event append-only permissions do not imply physical database immutability; retain separate integrity evidence.

## Evidence and revenue

Ingest only authorized observations. Record requested period, earliest retained record, `as_of`, available accounts, provider errors, pending rows, and completeness. Explicit v2 requests and v2-specific validation must not silently downgrade malformed data; approved v1 support is labeled.

Reconcile invoice/payment/settlement lifecycles using evidence of identity, not date/amount similarity alone. A matched sale contributes once. Exclude financing deposits, transfers, owner capital, tests and duplicated settlements; evaluate refunds, taxes, tips, fees and chargebacks under the signed revenue definition. Crypto deposits require approved business-purpose evidence. QuickBooks entries alone are not verified cash receipts.

Each snapshot binds source versions, entity, period/timezone, gross/net basis, exclusions, coverage, reconciliation decisions, FX and rule version. Used snapshots are never edited in place. Corrections create a new version and a reviewed adjustment proposal. Unknown history must remain unknown beside the first displayed total.

## QuickBooks posting and recovery

Use first-party OAuth and the Accounting API, with encrypted rotating credentials and tenant/entity/realm binding. Keep local read and write permissions separate. Browser-assisted HTTPS authorization must work over SSH without secrets in command history. Provider requests and supported entity operations must be verified against current Intuit documentation before implementation.

Preview resolves source economic events into typed `Purchase`, `Deposit`, `Transfer`, `Invoice`, `Payment`, `BillPayment`, `SalesReceipt`, or exceptional accountant-approved `JournalEntry` operations. Each immutable plan binds company, mappings and their versions, accounts, amount/currency, dates, fees/tax, record type, source versions, confidence, and links into a content hash. Mapping/source/terms changes invalidate dependent approval. No bank-feed delivery claim is implied.

At publish, recheck permission, current consent, hash-bound approval or specifically approved deterministic rule, period restrictions, and evidence. Check known and possible existing QuickBooks records; ambiguous identity enters review. Commit accepted work and outbox rows in one database transaction, then serialize conflicting operations.

Proposed operation states: `draft`, `approval_required`, `approved`, `queued`, `publishing`, `posted`, `external_commit_unknown`, `conflict`, `reauthorization_required`, and `failed_review`. After a timeout, enter `external_commit_unknown`; reconcile with supported external identifiers/idempotency and permitted reads before any further create. Never assume a missing immediate response means no write. If the outcome cannot be established, keep it in review. Persist external ID and version/concurrency tokens. External edits and closed periods require reviewed resolution, not overwrite or history deletion. Partial batches expose each item's outcome and resume unresolved items only.

For borrowing, funding is not sales and principal is not wholly expense. Require accountant-reviewed templates for legal/accounting product treatment, including receivables purchase/RBF. Keep asset quantity, valuation, fees and realized disposal differences in an independent crypto subledger; publish approved base-currency entries without inventing a native QuickBooks USDC currency.

Accounting retries reference already-recorded financing events. They cannot invoke funding, collection, or acceptance. OAuth expiry produces `accounting_pending`/reauthorization status while servicing remains independent.

## Financing lifecycle and approvals

Use the PRD lifecycle from draft/evidence-incomplete through submitted/provider review, offered, accepted, funding-pending, active, reconciliation/dispute/delinquency review, and completed/cancelled/expired/provider-unavailable. Retain original provider status and version alongside the normalized status. Preserve separate data, application, funding, collection, and accounting health indicators.

Bind explicit approvals to tenant/entity, operation, amount/currency, recipient, plan/terms hash, actor, expiry and one-time use where appropriate. Consent to link an account cannot authorize underwriting, credit pulls, signing, guarantees, a mandate, investment or marketing. An agent may prepare drafts and request approval but cannot approve itself. Offer changes and expired approvals require renewed authority. Provider decisions remain authoritative; a declined application is never automatically sent elsewhere.

Acceptance alone leaves funding pending. An actual approved provider/rail event establishes settlement; a transaction hash or commitment is insufficient. Only the contractually authorized collector originates collections under a specific financing mandate. The existing purchase ACH integration must not be treated as that mandate or servicing role.

## Remittance reservations and event handling

Assess the simple capped example only from a complete, approved, versioned sales snapshot under the signed contract's definition and rounding. Unknown data produces pending calculation/review; verified zero sales produces a zero sales-based assessment. Provider estimated-debit mechanisms require separate configuration and disclosures.

For an assessment, start a transaction and lock the agreement/cap ledger. Check the unique agreement/assessment/version identity. Compute available cap as contractual cap minus settled collections and active reservations under the contract's adjustment policy. Reserve at most `min(available cap, round(eligible sales × rate))`, persist the assessment and outbox request atomically, and send only through an authorized collector. A concurrent worker observes the existing reservation rather than creating a second debit.

Reconcile provider settlement/return events under the same lock and unique inbox identity. Unknown outcomes retain their reservation; only authoritative failure/return evidence permits its release or a reviewed adjustment. Accounting success is never settlement evidence. Late returns, overpayments, disputes and corrections remain explicit ledger events with reconciliation and provider support, never silent cap resets or catch-up debits.

## Crypto and permissioned P2P

Model denomination, funding asset, repayment asset, destination and settlement rail separately. Start only one approved native stablecoin on one supported chain. Record authoritative contract address and decimals, wallet-control proof, counterparty screening, nonce/expiry-bound intent, limits, quote and destination revalidation, chain-specific finality and reorg handling. Testnet evidence cannot approve production. Direct external funding or an approved third-party operator supplies capital/conversion; CoinPay supplies no treasury inventory.

Review keys, forwarding/recovery powers, admins, upgrades and pause rights before reusing wallets/escrow. Use lawful bounded mandates or merchant-signed payments without unrestricted wallet authority. Sensitive records remain encrypted off-chain; minimize public commercial disclosure and review commitments against guessing attacks. Revenue attestations identify evidence, attestor, version, timestamp, rules, challenge path and update authority; do not claim trustless discovery or enforcement of off-chain sales.

Permissioned P2P begins with one qualified external funder through the reviewed legal structure. Later per-deal allocations distinguish commitments from actual receipts, enforce deadlines/minimums, and have an approved operator return unused funds. Reviewed exact-share rounding and signed waterfalls distribute realized collections once, report losses and illiquid exposure, and never substitute new deposits for returns. Smart contracts require separate legal/control review and an independent audit before production.

## Interfaces and operations

PWA, API, SDK, both CLIs, and MCP are thin clients of the same policy-checked services. Preserve the PRD's proposed commands, routes and error codes while reconciling actual routing/versioning. Read-only MCP tools are the default; preview and approval-request tools expose minimal scoped data. No arbitrary provider API passthrough or per-transaction LLM is required.

Use verified webhook signatures, event deduplication, ordering/version checks, durable correlation IDs, bounded retries, outbox processing and dead-letter/reconciliation queues. Invalid signatures or older events cannot advance state. Secret-free audit records identify decisions, actor approvals, evidence hashes, provider references, outcome and recovery ownership.

Set per-tenant/provider budgets, polling ceilings, quotas, incremental infrastructure limits, paid-check approval, retention/deletion rules and legal holds. Instrument research, sandbox/testnet and live cohorts separately. Reuse retained data rather than refetching accounts on page views. Keep an alternative approved servicing/contact/payment route available during CoinPay or provider outages.

## Delivery and validation

The task list is staged and entirely unchecked. Financial behavior tests, including A01–A20 and the additional R48 failure cases, are future activation criteria. Document validation does not establish those behaviors.

Keep later gates disabled when earlier stages release. Roll back a capability by disabling new operations, preserving financial history, continuing reconciliation of uncertain existing effects, and communicating approved servicing alternatives. No rollback may replay a debit, erase posted bookkeeping, or abandon an active borrower.

Before live activation, attach applicable Intuit/data-use evidence, provider contracts/costs/capital authority, exact SimpleFIN qualification, accountant-approved templates, legal/jurisdiction reviews, rail authority, security assessment, test results and recovery runbooks. Unresolved prerequisites keep the relevant capability unavailable while independently qualified accounting remains usable.
