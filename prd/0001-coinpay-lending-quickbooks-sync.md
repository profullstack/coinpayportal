---
openprd: "0.3"
id: "0001"
title: "Add partner-funded CoinPay Lending, crypto funding rails, and QuickBooks sync"
status: Draft
authors:
  - anthony@profullstack.com
owner: anthony@profullstack.com
repo: profullstack/coinpayportal
created: "2026-09-12"
updated: "2026-09-14"
tags: [coinpay, lending, revenue-based-financing, simplefin, quickbooks, crypto, p2p, api, cli, mcp, pwa, postgresql]
---

# CoinPay Lending + QuickBooks Accounting Sync

**Product:** CoinPay Lending, inside CoinPayPortal.  
**Public route:** `/lending`.  
**Release:** V1 accounting/data foundation and partner-financing workflow; gated stablecoin and permissioned P2P extensions.  
**Interfaces:** Mobile-first PWA/web, desktop-responsive web, CLI, public API, SDK, and MCP.  
**Status:** Product specification only. No code was changed or deployed, no partner agreement was executed, and no customer funds were moved in preparing this document.

This is a standalone **LogicSRC OpenPRD 0.3** document, accompanied by the **OpenSpec change bundle** at `openspec/changes/add-coinpay-lending-quickbooks-sync/`. The two formats are complementary. Repository number `0001` was allocated on September 14, 2026 after checking that no numbered PRD collection existed in this checkout; existing `PRD.md` and documents under `docs/` are preserved. Recheck numbering and update both formats together before committing if another PRD has been added in the meantime. [^openprd]

## Problem

CoinPay should connect a merchant's financial activity, bookkeeping, and business-funding workflow without requiring the merchant to assemble separate integrations or requiring CoinPay to supply the financing capital.

The requested experience combines SimpleFIN account data, approved accounting entries published to QuickBooks Online, a public CoinPay Lending page, partner-funded revenue-based financing, and eventually crypto-denominated or crypto-settled P2P financing. The capital must come from an external financing provider or independently qualified funders—not CoinPay's treasury, customer payment balances, or a newly invented token.

Three functions must remain separate:

| Function | Intended mechanism | Boundary |
|---|---|---|
| Read financial activity | Existing CoinPay SimpleFIN integration | Read-only; not authority to debit, lend, or open an account |
| Record approved accounting activity | QuickBooks Online Accounting API | Changes books; does not itself collect or send money |
| Fund and service financing | Approved capital provider and approved payment/settlement rail | Separate contracts, underwriting, authorization, and jurisdiction checks |

SimpleFIN describes read-only financial exchange; the currently published v2 page is explicitly a draft. Intuit's official MCP server documents accounting entities such as purchases, deposits, transfers, invoices, payments, and journal entries. Neither fact establishes an approved CoinPay financing program. [^simplefin] [^qbo-mcp]

YouLend's public API documentation establishes a plausible embedded-financing integration path, including applications and servicing information. It does **not** establish that CoinPay is an approved partner, that YouLend accepts CoinPay's SimpleFIN-derived data for underwriting, or that any resulting financing account meets CoinPay's mandatory SimpleFIN compatibility policy. [^youlend]

**Product decision:** Build CoinPay as the application, evidence, reporting, and integration layer. Launch real financing only when external capital, legal authority, account compatibility, servicing, and payment permissions are actually in place. A useful accounting product and honest financing waitlist can launch independently.

## Goals

Deliver reusable QuickBooks synchronization that works both for ordinary CoinPay/SimpleFIN activity and for approved financing-related accounting events. A merchant must be able to use accounting sync without applying for financing.

Offer a public `/lending` experience and a single business-finance workspace with an evidence-backed revenue profile, provider applications, offer comparison, remittance tracking, and accounting status.

Keep CoinPay outside the capital-provider role by product design: no required lending inventory, first-loss reserve, merchant-fund diversion, liquidity backstop, or platform repayment guarantee. Partner contracts must confirm the actual allocation of credit and operational risk.

Support crypto intentionally through asset-aware records and approved settlement adapters. Start any live crypto financing with one approved stablecoin/chain combination; do not launch an undifferentiated “all crypto” lending pool.

Preserve the user's non-negotiable requirement: **no verified SimpleFIN compatibility, no supported financial-account/product recommendation or account-opening workflow.** Apply it to bank, card, loan, and financing-obligation products, including crypto-related accounts offered through this feature. A blockchain explorer, a provider API, or a CSV is not proof of SimpleFIN compatibility. [^prior-formation]

Provide a credible permissioned P2P path, beginning with an external funder and legally reviewed origination/servicing arrangements. Multi-funder allocation is a later capability, not a prerequisite for the first funded business.

## Non-Goals

This change does not authorize CoinPay to become a bank, balance-sheet lender, securities intermediary, money transmitter, or unlicensed loan broker. It does not assume that non-custodial software, a DAO, a “fixed fee,” or the label “not a loan” removes applicable obligations.

V1 excludes public retail investment solicitation, anonymous lender pools, tradable loan tokens, a CoinPay investment token, pooled guaranteed-yield accounts, automated loan stacking, consumer/personal lending, unsecured lending based only on a wallet address, and new cross-chain bridge infrastructure.

The feature must not market collateral-backed crypto borrowing as equivalent to unsecured working capital for a merchant with no collateral. It must not turn a data-disconnection event into fabricated revenue, a retroactive remittance, or an automatic financing default.

The feature does not guarantee credit approval, funding availability, a particular remittance duration, investment returns, tax treatment, or error-free distributed execution. Its reliability goal is detectable, recoverable failure with controlled financial effects.

No migration to Turso, SQLite, or libSQL is included. No wholesale rewrite of existing CoinPay auth, payment, wallet, SDK, or database code is justified by this feature.

## Users

| User | Primary job | Authority limit |
|---|---|---|
| Business owner / authorized officer | Connect business data, review accounting, apply, accept an offer, track remittances | Must separately authorize binding contracts, guarantees, credit checks, and payment mandates |
| Accountant / bookkeeper | Approve ledger mappings, correct classifications, reconcile funding and settlements | Accounting access does not imply borrowing or wallet-signing authority |
| Capital provider / underwriter | Review consented evidence, make offers, supply capital | Provider retains actual credit decision and funding authority |
| Servicer / approved payment operator | Calculate or execute authorized collections and handle disputes | Bound by the financing contract and separate payment permissions |
| Qualified external funder | Consider a permitted funding opportunity and receive applicable reporting | Eligibility and offering rules apply; investment is not guaranteed |
| CoinPay operations / compliance | Maintain provider evidence, resolve failures, approve launch gates | Cannot fabricate compatibility, sign on behalf of a borrower, or silently override a contract |
| Authorized agent | Prepare drafts, explain discrepancies, request approvals, query status | Cannot create its own consent or autonomously accept debt or invest money |

## Requirements

P0 means mandatory for its applicable release capability; P1 and P2 are gated extensions. P0 crypto safeguards apply whenever crypto is enabled, even if the crypto capability is scheduled later. SHALL and SHALL NOT are normative product requirements. Except where explicitly sourced, design thresholds and workflows are proposed product policy.

### Product scope and capital sourcing

- R1 [P0] **Extend existing CoinPay domains.** Reuse merchant/organization identities, finance connections, account mapping, invoices, payment references, and the existing SDK/CLI. Link financing to the same legal business entity used by the finance workspace. Do not build a parallel bank-data store or duplicate SimpleFIN credentials in the lending subsystem.

- R2 [P0] **Separate independently releasable capabilities.** Provide independent gates for public discovery, accounting reads, accounting writes, financing applications, binding offer acceptance, fiat funding, stablecoin settlement, and permissioned P2P. A feature flag alone SHALL NOT activate a capability without all applicable evidence checks.

- R3 [P0] **Require an external capital source.** A live offer SHALL identify the legal provider, funding counterparty, product, servicer, applicable jurisdiction, and source of executable funding authority. Approval, a displayed wallet balance, and an unsigned funding commitment are not disbursement. CoinPay SHALL NOT fund the principal, guarantee funder returns, or supply a first-loss reserve in this product's approved business model.

- R4 [P0] **Keep a capability/evidence directory.** Store providers as `research_only`, `contracting`, `sandbox`, `verified`, `suspended`, or `retired`, with separate product/country/state/entity/currency/rail support. Default all researched providers to unavailable. Evidence SHALL cover contracts, provider permissions, SimpleFIN compatibility, data-use rights, funding/servicing behavior, support escalation, legal review, and commercial costs. YouLend is a research candidate, not a selected or verified provider. [^youlend]

- R5 [P0] **Reject treasury-risk obligations.** Partner procurement SHALL record reserves, prefunding, repurchase obligations, fraud indemnities, commission clawbacks, operational liabilities, and minimum-volume fees. Reject a program that requires CoinPay lending capital or credit-loss guarantees. Do not interpret “partner-funded” as “zero cost” or “zero liability”; budget approved non-credit operating exposure explicitly.

### SimpleFIN and business-data boundary

- R6 [P0] **Enforce product-level and account-level SimpleFIN qualification.** Before recommending or initiating an offered bank/card/financing account, verify the exact institution, product, business profile, geography, connection route, and required account data. After account creation, verify the customer's actual connection. Preserve verification date, test evidence, expiry/retest policy, and failure scope. The financed obligation itself requires qualification; a compatible repayment checking account alone does not qualify an otherwise unsupported loan product. [^prior-formation]

- R7 [P0] **Do not waive compatibility for crypto or referrals.** Direct lender APIs, on-chain visibility, QuickBooks records, uploaded statements, affiliate commissions, or an operator checkbox SHALL NOT bypass R6. An unverified crypto financing account remains unavailable. Do not create a superficial SimpleFIN wrapper around unverified data and call the upstream account verified. Any future protocol-serving adapter requires an independently reviewed authoritative data source and end-to-end compatibility tests; it is not a shortcut in this release.

- R8 [P0] **Use explicit SimpleFIN versions.** Extend the existing client with v2-first capability verification, explicit requested version, and version-specific fixtures. Record observed capabilities because the published v2 specification is a draft. Preserve supported v1 only under an explicit labeled compatibility policy; malformed v2 data SHALL NOT trigger a silent downgrade. Namespace source identities by tenant, provider connection, upstream connection, account, and transaction. [^simplefin]

- R9 [P0] **Secure financial credentials and URLs.** Claim setup tokens in the backend, encrypt access credentials, and avoid shell arguments or agent transcripts containing secrets. Apply HTTPS, allowed-origin, DNS/private-address, redirect, and SSRF checks to claim/access/institution/custom-currency URLs. No provider or funder receives the user's SimpleFIN Access URL. Revocation SHALL stop future authorized reads and downstream data sharing according to recorded consents.

- R10 [P0] **Map only authorized business accounts.** Require entity ownership/scope confirmation and separate accounting-company mapping. Personal accounts and another business's activity SHALL NOT be imported into this company's books or funding profile by default. Mapping changes invalidate affected drafts and approvals. One merchant may have several legal entities and several QuickBooks companies; do not infer that they are interchangeable.

- R11 [P0] **Make coverage part of every financial claim.** Store `as_of`, earliest retained record, requested period, account coverage, provider errors, pending status, and completeness. A revenue total for an incomplete period SHALL say “posted through [timestamp] across [available accounts]” beside the first total. Missing data is unknown, not zero. Do not manufacture three months of history from a shorter available feed; support continuing retention and reviewed supplemental evidence without treating it as a compatibility substitute.

- R12 [P0] **Separate all data-sharing consent.** Account linking, QuickBooks writing, lender underwriting disclosure, bureau access, recurring monitoring, public fundraising disclosure, and marketing are different permissions. Record purpose, recipient, fields, expiry, actor, and revocation behavior. Review the applicable Intuit, SimpleFIN/Bridge, and capital-provider terms before using connected data for underwriting or sending it to another party. No resale, unrelated advertising, or model training by default.

### QuickBooks connector

- R13 [P0] **Build a first-party API connector.** Use QuickBooks Online OAuth and its Accounting API for the durable sync engine. Store the company/realm binding and encrypted rotating credentials. Enforce local read/write permissions even where provider scopes are broad. Use production HTTPS callbacks and a browser-assisted authorization route that also works when the CLI runs over SSH. Intuit's official MCP implementation is a useful reference; running one local server per customer is not the production architecture. [^qbo-mcp]

- R14 [P0] **Preview before publishing.** Produce an immutable, versioned posting plan with source events, destination company, accounts, record types, dates, amounts, fees, currencies, tax treatment, links, and classification confidence. The default is user/accountant review. Deterministic auto-posting may be enabled only by a specifically approved rule limited to named accounts and transaction types; lending acceptance is never included in that rule.

- R15 [P0] **Publish accounting records, not a promised bank feed.** Support validated entity mappings such as `Purchase`, `Deposit`, `Transfer`, `Invoice`, `Payment`, `BillPayment`, `SalesReceipt`, and exceptional accountant-approved `JournalEntry`. Treat creating records in QuickBooks as distinct from sending raw transactions to its bank-feed “For review” queue. Do not advertise native bank-feed delivery without a separately verified integration. Do not blindly convert every source transaction to a journal entry. [^qbo-mcp]

- R16 [P0] **Prevent duplicates within and across sources.** Persist source identity, economic-event identity, company/realm, operation type, approved plan hash, external record ID, source version, and status under database uniqueness constraints. Match an invoice payment and later settlement to the same lifecycle. Inspect potential existing QuickBooks entries before new posting; ambiguous matches go to review. Similar date/amount/description alone is not sufficient proof of identity.

- R17 [P0] **Handle uncertain writes and external edits safely.** Use a transactional outbox, provider-supported idempotency where available, serialized conflicting jobs, retry backoff, and reconciliation. After a timeout, determine whether the external write happened before issuing a new create. Store external concurrency/version tokens where supported. If an accountant edits a posted record, create a conflict/review item rather than overwriting it. A batch may be partially posted; show the successful records and resume only unresolved operations. Respect closed periods and do not automatically delete posted history.

- R18 [P0] **Use financing-specific accounting policies.** For a product legally/accountingly treated as borrowing, funding proceeds SHALL NOT be booked as sales; principal repayment SHALL NOT be booked wholly as an expense. Separate principal, financing charges, servicing fees, payment fees, and settlement differences under accountant-approved mappings. Receivables purchases/RBF may have different accounting treatment; require a reviewed product-specific template instead of assuming loan or sale treatment from marketing language. Corrections use reviewed adjustments with provenance.

- R19 [P0] **Keep crypto subledgers separate from fiat bookkeeping.** Record native asset quantity, chain, token contract, decimals, business base-currency value, valuation source/time, fees, and disposal/settlement events. Do not pretend QuickBooks has a native USDC currency or treat every token as exactly one USD. Publish an approved base-currency accounting representation with the asset subledger retained in CoinPay. Currency conversion and gain/loss policy require accounting review.

- R20 [P0] **Keep financing independent of bookkeeping availability.** A QuickBooks outage SHALL NOT re-trigger funding or cause a second debit. Mark `accounting_pending` and retry independently. An unapproved posting plan cannot serve as proof of revenue, a completed collection, or a binding financing obligation.

### Revenue evidence and remittance calculations

- R21 [P0] **Build one economic-event reconciliation layer.** Reconcile SimpleFIN rows, CoinPay invoice/payment events, processor settlements, permitted QuickBooks records, and supported on-chain observations. Count a sale once, not once per data source. Exclude funding proceeds, inter-account transfers, owner capital, wallet self-transfers, test activity, and duplicated settlements from qualifying sales. Handle refunds, chargebacks, tax, tips, and processor fees according to the signed product's revenue definition. Net bank deposits SHALL NOT be silently relabeled gross sales.

- R22 [P0] **Normalize signs by source contract.** Preserve original signed decimal strings and explicit debit/credit direction. Native SimpleFIN specifies positive transaction amounts for deposits; the implementation SHALL test that convention rather than borrow an unrelated aggregator's sign rules. Use exact decimal or integer-minor-unit arithmetic, never floating-point financial accumulation. [^simplefin]

- R23 [P0] **Version the revenue profile.** Each underwriting/remittance snapshot SHALL include the selected legal entity, sources, period/timezone, gross/net basis, exclusions, coverage, reconciliation decisions, FX method, rule version, and lineage to source records. No snapshot is silently edited after an offer or collection uses it. A correction creates a new version and an explicit adjustment proposal. User-created QuickBooks sales entries alone are not independently verified cash receipts.

- R24 [P0] **Treat crypto receipts as evidence, not automatic sales.** Require invoice/customer/business-purpose linkage or another approved evidence path. A random wallet transfer, token swap, bridge transfer, loan draw, or circular transfer SHALL NOT automatically count as merchant revenue. Where justified by the provider, flag self-funding, wash activity, manipulated invoices, and large unexplained differences for human review. Minimize collection of unrelated wallet history.

- R25 [P0] **Calculate revenue-share remittances from contract terms.** For a simple capped RBF example, determine the day's obligation as `min(remaining contractual cap, round(eligible sales × remittance rate))`, with contract-specific rounding and lawful adjustments. Reserve in-flight collection amounts under a lock so parallel jobs cannot overcollect. Apply the cap to actual settled collections plus reservations; reverse reservations on a confirmed failed payment. Do not assume a fixed fee is an APR, a maturity date, or a guaranteed investor return.

- R26 [P0] **Separate true zero sales from unknown sales.** A verified zero-sales day in a product promising revenue-linked remittances produces zero sales-based remittance. Missing data creates a review/pending-calculation state, not a zero-revenue certification and not an automatic catch-up debit. Provider estimated-debit/reconciliation mechanisms, if any, require their own accurately disclosed product configuration and mandates. They must not be presented as the simple daily-percentage example.

### Applications, offers, and servicing

- R27 [P0] **Keep provider underwriting authoritative.** Store minimum trading history, eligible revenue, industry restrictions, credit criteria, and document needs in versioned provider/product configuration. Do not hardcode the pasted YouLend FAQ's eligibility criteria, country count, funding count, soft-check promise, or personal-guarantee policy as CoinPay facts. Low or zero revenue may mean no RBF offer; the UI SHALL not invent an offer or route to hidden debt products.

- R28 [P0] **Require explicit authority for consequential steps.** KYB/KYC information, application submission, hard credit pull, personal guarantee, offer acceptance, drawdown, bank-debit mandate, wallet allowance, and a funder's investment commitment require appropriate separate approvals. Where possible, identity documents and signatures go directly to the approved provider. A declined application SHALL NOT automatically trigger submissions to other lenders.

- R29 [P0] **Render complete, versioned offers.** An offer SHALL show the actual provider, legal product classification, nominal funding, net proceeds, fixed fee/interest where applicable, total cost/cap, remittance definition, estimates and assumptions, maturity if any, early-completion treatment, guarantees/liens, default terms, all CoinPay/provider/conversion/gas charges, currency, funding rail, expiry, and required jurisdiction disclosures. Never label a product “0% APR” merely because it has a fixed fee. No blanket “not a loan,” “no collateral,” or “no credit impact” copy.

- R30 [P0] **Use an explicit lifecycle.** Support draft, evidence-incomplete, ready-for-consent, submitted, under-review, action-required, declined, offered, expired, accepted, funding-pending, active, reconciliation-required, disputed, delinquency-review, completed, cancelled, and provider-unavailable states where applicable. Preserve each provider's original status. Acceptance is not funding; a transaction hash is not sufficient finality; no offer SHALL be marked funded without verified provider/rail evidence.

- R31 [P0] **Use a separately approved collection rail.** Bank collections require an approved provider/servicer and a valid mandate for this specific financing use. The existing CoinPay ACH purchase flow is not automatically approved for debt collection or investor distribution. SimpleFIN credentials and QuickBooks OAuth never authorize debits. Only the authorized collector originates a collection; CoinPay may request it only under a separately approved contractual and technical role. [^repo-ach]

- R32 [P0] **Provide servicing and dispute controls.** Show eligible sales, assessed obligation, pending/settled/returned collections, remaining cap, adjustments, provider reconciliation, and QuickBooks status separately. Support payment failures, overpayment refunds, duplicate-collection disputes, hardship/reconciliation requests, contact escalation, and provider outages. Authoritative contract/servicing records remain identifiable. A CoinPay outage SHALL NOT strand a borrower without an approved alternative servicing/payment route.

### Crypto and permissioned P2P extensions

- R33 [P1] **Add stablecoin settlement without an inventory requirement.** Model funding asset, denomination, remittance asset, settlement route, and destination as separate fields. Initial production scope is one approved native stablecoin on one provider-supported chain. An external funder/provider sends funds directly to the authorized merchant destination or through an appropriately approved third-party settlement arrangement. No CoinPay treasury-funded swaps or bridge loans. Fiat-to-crypto conversion is a separately accepted provider quote, not an automatic assumption that the financing partner supports crypto.

- R34 [P0] **Verify every enabled crypto rail.** Require asset/contract allowlists, correct chain and decimals, wallet-control proof, screened counterparties, signed intent/nonce/expiry, amount and fee limits, replay protection, chain-specific finality, reorg handling, supported refund procedures, and a depeg/freeze/outage policy. Revalidate quotes and destinations before execution. A wallet signature proves control, not legal identity or repayment ability. Testnet success is not production approval.

- R35 [P0] **Do not assume existing wallets/escrow are suitable custody boundaries.** Inspect forwarding keys, recovery authority, contract administrator powers, upgradeability, pause rights, and actual value flow before reusing a CoinPay payment primitive. CoinPay SHALL NOT pool lender capital or possess unrestricted spending authority over borrower wallets. Use bounded explicit mandates where lawful and supported, or merchant-signed payments. “Non-custodial” is a description requiring evidence, not a legal exemption. [^fincen]

- R36 [P2] **Start P2P with a legally reviewed external-funder workflow.** A qualified external lender or capital provider may fund one approved deal through a compliant origination/servicing structure. The funder must satisfy the requirements of that structure, including any applicable investor verification; a website checkbox declaring “accredited” is not a universal solution. No public deal solicitation or funding commitment is enabled until offering/intermediary/credit-law review is complete. P2P does not require a transferable token. [^sec-prosper]

- R37 [P2] **Add multi-funder allocation only after the single-funder route works.** Support per-deal commitments, allocations, funding deadlines, actual funding receipts, minimum funding conditions, and fair rounding. Unfunded commitments SHALL NOT count as cash. Underfunded deals expire/cancel according to their documents; unused funds are returned by the approved escrow/settlement operator. CoinPay never holds the pool. Smart-contract deployment requires separate legal/control review and an independent security audit before production.

- R38 [P2] **Distribute only realized collections.** Investor/funder reporting SHALL distinguish committed capital, deployed capital, principal returned, realized financing income, fees, unresolved arrears, losses, and illiquid remaining exposure. Allocation of a remittance follows the signed waterfall and exact ownership shares. No new borrower/funder deposit may be used to fake a prior investor's return. No guaranteed yield or on-demand redemption for an illiquid financing position.

- R39 [P0] **Acknowledge off-chain enforcement and data trust.** Revenue-based business financing requires business identity, enforceable agreements, trustworthy revenue evidence, and a servicing/default process. An on-chain contract cannot independently discover all a merchant's sales or compel repayment from an arbitrary wallet or external bank. Any signed revenue attestation SHALL identify the attestor, evidence version, rules, timestamp, challenge process, and authorized update rights. Do not market the proposed system as fully trustless.

- R40 [P0] **Keep sensitive information off-chain.** Bank rows, customer identities, documents, tax IDs, credit information, contracts, and raw underwriting inputs SHALL remain encrypted off-chain with purpose-limited access. Public addresses and amounts can reveal commercial information; obtain appropriate consent. Any commitment hash must be designed against guessing attacks on predictable sensitive data. A funder receives only the data authorized for its actual role and deal.

### Shared controls and operational readiness

- R41 [P0] **Use one service layer across interfaces.** CLI, SDK, public API, MCP, and PWA SHALL call the same policy-checked application services. Provide read, draft, preview, approval-request, status, and permitted execution operations. Do not duplicate the financing engine inside an MCP tool or run an LLM for each routine financial transaction.

- R42 [P0] **Prevent agent-created authority.** An agent cannot approve its own posting plan, sign a personal guarantee, accept borrowing, execute an investment commitment, expand a mandate, or mint its own approval artifact. High-impact operations require authenticated approval bound to entity, operation, amount/currency, recipient, plan/terms hash, and expiry. Read-only MCP tools are enabled by default; arbitrary provider API passthrough is prohibited.

- R43 [P0] **Keep decision support explainable and reviewable.** AI may summarize records and suggest classifications, not fabricate source facts or final credit decisions. Underwriters must be able to trace inputs and record provider decision reasons. Determine applicable fair-lending, credit-report, adverse-action, privacy, and recordkeeping requirements with qualified counsel for the actual role/product. Do not use protected characteristics as underwriting features or publish an opaque “AI credit score” as an official bureau score.

- R44 [P0] **Make asynchronous side effects auditable.** Use verified webhook signatures, inbox deduplication, version/order checks, an outbox, durable correlation IDs, tenant isolation, retry limits, and dead-letter/reconciliation queues. Record actor, decision/approval references, source hashes, external IDs, state changes, and outcomes without logging secrets. Append-only application permissions plus separately retained integrity evidence may be used; do not call an ordinary editable database table physically immutable.

- R45 [P0] **Limit operational spending and data retention.** Configure incremental hosting/provider budgets, per-tenant quotas, provider polling ceilings, cost alerts, and approval for paid checks. Reuse the existing retained ledger rather than rereading every account per page view. Set retention/access/deletion policies for financial data, identity evidence, contracts, and audit logs, including documented legal-hold exceptions. Customer-owned SimpleFIN access does not imply an unlimited reseller license.

- R46 [P0] **Gate launch by jurisdiction and actual activity.** Obtain qualified financial-services counsel's written assessment of CoinPay's role, provider licensing/exemptions, commercial financing disclosures, lending/brokering, servicing/collections, securities/offerings, custody/money transmission, sanctions, applicable digital-asset laws, privacy, and credit reporting. California's statute covers specified commercial receivables-purchase transactions in addition to loans; calling a product RBF does not by itself eliminate disclosure analysis. Legal applicability depends on the facts and exemptions, not this PRD. [^ca-disclosures] [^ca-license] [^fincen] [^ofac] [^sec-prosper]

- R47 [P0] **Keep public claims and product status synchronized.** Public pages, API capability responses, CLI output, agent descriptions, structured data, pricing, and emails SHALL use the same verified availability record. No invented partner logos, approvals, funded totals, guarantees, savings, or customer testimonials. Permissioned P2P remains an explicitly unavailable future capability until enabled; a generic “become a funding partner” intake is not a retail investment offer.

- R48 [P0] **Pass financial correctness and failure tests before activation.** Acceptance coverage SHALL include cross-source duplicates, FX/decimal errors, stale sources, partial periods, tenant collisions, expired consent, offer changes, OAuth expiry, external edits, unknown API commit, out-of-order webhooks, ACH returns, crypto reorgs, underfunded deals, rounding, zero sales, overcollection prevention, and loss/default reporting. Passing tests is a release criterion—not a promise that errors are impossible.

### Acceptance fixtures

All figures below are fictional test data. No fixture is an offer, accounting opinion, or investment return promise.

| ID | Scenario | Required result |
|---|---|---|
| A01 | $10,000 funding; $2,500 fixed fee; 10% remittance; $500 eligible sales | $50 assessed remittance, $450 sales remainder before other expenses; cap starts at $12,500 |
| A02 | Same contract, verified $0 eligible sales | $0 sales-based remittance; contract remains active unless the actual contract says otherwise |
| A03 | Provider/account feed unavailable | Revenue unknown; no fabricated zero, eligibility decision, or automatically generated debit |
| A04 | Only $20 remains under cap; sales imply $50 | At most $20 may be newly reserved/collected, considering existing in-flight amounts |
| A05 | Two workers attempt the final $20 collection | One durable collection/reservation identity; no second debit |
| A06 | An invoice/payment and bank settlement reflect one $500 sale | $500 qualifying sale once, not $1,000 or $1,500; fees reconcile separately |
| A07 | A $10,000 financing deposit arrives in the bank feed | Excluded from sales; financing-policy accounting, not a new sale |
| A08 | Posting request times out after QuickBooks committed it | Reconcile and link the committed record; never blindly create a duplicate |
| A09 | Bookkeeper edits a previously posted QuickBooks record | Conflict/review state; no automatic overwrite |
| A10 | Customer has 40 days of retained data; partner needs 90 | Insufficient evidence, with explicit coverage; no invented historical months |
| A11 | Loan provider has an API, but only the repayment bank is SimpleFIN-verified | Product unavailable; provider API and compatible checking do not waive financing-account qualification |
| A12 | On-chain deposit is a self-transfer or unrelated token swap | Not qualifying merchant sales without reviewed evidence |
| A13 | Funding transaction is reorged before required finality | Not active/finally funded; reconcile chain state and prevent dependent disbursements |
| A14 | Three funders own 50%, 30%, 20%; $50 distributable collection | $25, $15, $10 before separately contracted fees; one distribution event |
| A15 | Commitments total $10,000 but only $8,000 arrives before deadline | Not funded at $10,000; apply documented cancellation/underfunding process |
| A16 | Merchant applies through MCP without human borrowing authority | Draft/approval-required response; no acceptance, guarantee, or movement of funds |
| A17 | Provider agreement requires CoinPay to post a first-loss reserve | Program rejected under this product model until an explicit new business decision |
| A18 | SimpleFIN deposit amount is positive | Classified as an inflow candidate; revenue still requires economic classification |
| A19 | Fiat loan accounting sync is complete, stablecoin rail is unverified | Accounting remains usable; crypto funding stays disabled |
| A20 | A funded merchant's QuickBooks connection expires | Financing/servicing state unchanged; accounting job waits for reauthorization |

## UX Notes

### Public `/lending` page

Use CoinPay's existing visual identity, accessible shadcn-style components, responsive layout, and clear light/dark contrast. This is a business-finance product, not a casino/yield-farming landing page. Do not require a wallet to read the page or explore a funding-readiness profile.

**Before a verified financing program is live:**

> **CoinPay Lending**  
> Business funding, connected to your financial picture.  
> We're building a way to bring business activity, accounting, and financing applications together. Financing is not yet available. Join the waitlist for updates.

Primary CTA: **Join the lending waitlist**. Secondary CTA: **Connect business finances**, only if that independent feature is actually available. Optional B2B CTA: **Become a funding partner**, leading to a nonbinding institutional/provider inquiry form.

**After the relevant program passes all gates:**

> **Business funding that fits your cash flow.**  
> Connect supported business accounts, review financing options from available providers, and keep approved activity in sync with QuickBooks.

Primary CTA: **Check available financing**. Provider, product, jurisdiction, and credit-check disclosures appear before any application is submitted. Crypto choices appear only where the full route is verified; otherwise use a clear future/unavailable label without a transaction CTA.

Recommended page sections are an explanation of the flow, data connections, real availability, an educational remittance calculator, cost/risk explanation, FAQs, and funding-provider inquiry. No public lender return leaderboard. No “lend now” or “guaranteed APY” CTA.

### Calculator

Inputs: illustrative funding amount, fixed fee, remittance percentage, and an example sales day. Outputs: total contractual cap, example sales-based remittance, and sales remainder before other expenses. With the user's example, $10,000 + $2,500 = $12,500 and $500 × 10% = $50. A $0 sales day produces $0 only within that illustrated product model.

Label the fixed fee as a fee, not interest-free borrowing. A fee equal to 25% of funding is **not 25% APR**: payment timing and balances matter. Actual providers supply the required disclosures and estimation method. A hypothetical finish date, if shown later, must name its sales assumptions and must not appear as contractual maturity.

### Authenticated workspace

Proposed routes, to reconcile with existing routing before implementation:

| Route | Purpose |
|---|---|
| `/finances` | Existing financial activity workspace; preserve it |
| `/finances/integrations/quickbooks` | Connection, company/account mapping, approved rules, health |
| `/finances/accounting/review` | Posting plans, duplicates/conflicts, batch approval and history |
| `/dashboard/lending` | Funding readiness, availability, applications, active financing |
| `/dashboard/lending/applications/[id]` | Evidence coverage, consents, provider requests, offers |
| `/dashboard/lending/agreements/[id]` | Signed terms, funding evidence, remittance ledger, disputes |
| `/dashboard/lending/funders` | Restricted future funder workspace; disabled without program approval |

Show independent badges for **data freshness**, **accounting sync**, **application status**, **funding status**, and **collection status**. Do not collapse them into a single green “connected” checkmark.

User flow: select business → connect/map supported accounts → inspect data coverage → optionally connect QuickBooks → review accounting → check verified product availability → authorize named application → review provider offer and disclosures → separately accept/sign → separately authorize funding/payment route → track servicing and accounting independently.

### Proposed CLI and MCP

These are target interfaces, not commands verified as implemented:

```bash
coinpay quickbooks connect --no-browser
coinpay quickbooks accounts map --business BUSINESS_ID
coinpay quickbooks sync --dry-run --business BUSINESS_ID
coinpay quickbooks sync --approved-only --business BUSINESS_ID
coinpay lending eligibility --business BUSINESS_ID --json
coinpay lending apply --business BUSINESS_ID --draft
coinpay lending offers --application APPLICATION_ID --json
coinpay lending remittances --agreement AGREEMENT_ID --json
```

`--no-browser` provides a safe public HTTPS authorization flow for a remote terminal; it does not bypass OAuth. CLI secrets use hidden prompts or stdin, never literal setup tokens in command history.

MCP tools mirror `quickbooks_sync_preview`, `quickbooks_publish_approved`, `quickbooks_sync_status`, `lending_get_availability`, `lending_get_readiness`, `lending_draft_application`, `lending_request_application_approval`, `lending_list_offers`, and `lending_get_remittances`. More powerful tools remain separately gated and require bound approvals. Sensitive detail is omitted from broad tool discovery and unrelated contexts.

## Tech Stack

### Verified repository observations

A limited source inspection used `profullstack/coinpayportal` at commit `cd4cb3ad2b1939e16e4f04f3fe53bc19abeb86ff` on September 12, 2026. This was not a repository-wide audit, execution of its test suite, or verification of production deployment.

| Observed source | What it establishes | Implementation consequence |
|---|---|---|
| Root `package.json` | Next.js 16, React 19, TypeScript, ESM, pnpm; Vitest/Playwright; existing CoinPay/Profullstack packages | Extend the existing app and pinned dependencies, not a greenfield stack |
| `src/lib/finances/simplefin.ts` | Setup-token/client logic, account/transaction types, v1/v2 handling, host checks, error handling | Extend and test the existing adapter; do not create a second account-linking system |
| `docs/ACH.md` | Documents an ACH pay-in flow and explicitly says it was not exercised against a live ACH payment | Reuse only after reviewing code, provider permissions, and correct settlement semantics; do not infer lending-collection readiness |
| Earlier finance PRD | Describes finance routes, SDK/CLI, reports and statement-library direction | Preserve domain compatibility; earlier requirements are not proof that each feature has shipped |

Sources: [^repo-package] [^repo-simplefin] [^repo-ach] [^prior-finances]. The inspected package still contains Supabase client dependencies; that is not proof that the deployed datastore is already self-hosted. Confirm the current database/auth boundary before migrations.

### Target architecture

Use the existing Next.js/TypeScript application and SDK, with **self-hosted PostgreSQL as the authoritative transactional database**. Respect the current data-access/auth abstraction while adding compatible migrations. No Turso/SQLite/libSQL alternative for the financial write path. Keep ESM JavaScript compatibility where required by the published SDK rather than rewriting it unnecessarily. Prefer existing job infrastructure; add a PostgreSQL outbox and use an existing Redis/BullMQ deployment if available, not a new distributed platform merely for this feature.

```text
SimpleFIN             CoinPay invoices/payments       Authorized QBO reads
   |                            |                              |
   +------------ consented source observations ----------------+
                                |
                 Economic-event reconciliation
                 Coverage + exact-money normalization
                                |
                Versioned business revenue evidence
                       /                     \
              Posting plan               Funding application
                   |                      + provider decision
           Accountant approval                    |
                   |                     Owner acceptance
          QBO Accounting API                      |
                   |              Approved provider / qualified funder
          IDs + reconciliation                    |
                                    Approved funding/collection rail
                                                  |
                                      Servicing event reconciliation
                                                  |
                                       Financing posting plan
```

This is a logical boundary diagram, not a requirement for separate microservices. Start with web/API, a worker, PostgreSQL, and the existing encrypted document/secret/notification facilities. Reuse verified CoinPay payment, invoice, identity, and notification modules; do not assume an existing generic escrow contract supports financing.

Proposed modules: `src/lib/integrations/quickbooks/`, `src/lib/lending/`, and shared finance reconciliation/policy services. Reuse an existing equivalent module when discovered. Add SDK/CLI/MCP bindings in the actual installed entry point; the earlier inventory identified both a root CLI and a published SDK CLI, so installation routing must be tested. [^prior-finances]

### Persistent domain objects

| Object | Essential content |
|---|---|
| Provider product / compatibility evidence | Exact product/profile/region, contract status, tested SimpleFIN route, capability checks, reviewers, validity period |
| Data connection / consent / entity mapping | Existing source references, authorized business, purposes, recipients, expiry/revocation, coverage |
| Economic event / source observation link | Source identity/version, normalized direction/value, business purpose, duplicate/reconciliation evidence |
| Revenue snapshot | Period/timezone, selected sources, exclusions, eligible sales, coverage, rules/FX version, source lineage |
| QuickBooks connection / account mapping | Tenant/entity/company/realm binding, encrypted token reference, category/account rules |
| Posting plan / item / external link | Content hash, approval, typed entity operation, idempotency, external ID/version, conflict/error state |
| Application / offer / agreement | Provider references, terms/disclosures, decision source, expiry, signatures, funding/servicing status |
| Mandate / approved intent | Rail, authorized parties, amount/rate/cap, contract hash, approval, expiry/revocation, permitted actions |
| Remittance assessment / collection | Snapshot, assessed amount, reservation, pending/settled/returned amount, remaining cap, provider reference |
| Funding commitment / allocation / distribution | Future qualified funder, legal deal, actual receipts, ownership, realized collection waterfall, losses |
| Inbox / outbox / audit event | Deduplication, ordering/version, correlation, approved actor, evidence hashes, recovery status |

Use decimals or integer atomic units with explicit asset decimals; serialize financial values as strings. Fiat minor units, token atomic units, and base-currency values are different types. Store immutable contract versions and append-only financial events under application permissions; derive balances from the event history with reconciliation checks.

### Proposed API contracts

Paths are design proposals. Reconcile them with the repository's authentication, tenancy, pagination, API versioning, and naming before implementing.

| Endpoint | Action | Important restriction |
|---|---|---|
| `POST /api/integrations/quickbooks/connect` | Start OAuth | Authorized business/accounting administrator |
| `PUT /api/integrations/quickbooks/mappings` | Set account/rule mapping | Audited; invalidate dependent approvals |
| `POST /api/integrations/quickbooks/posting-plans` | Create preview | No write or money movement |
| `POST /api/integrations/quickbooks/posting-plans/{id}/publish` | Execute approved plan | Approval hash + permissions + idempotency |
| `GET /api/lending/availability` | Verified programs for profile | Unknown/unverified programs not available |
| `POST /api/lending/readiness-snapshots` | Produce evidence summary | Consent + explicit coverage; not credit approval |
| `POST /api/lending/applications` | Create draft | No external application by default |
| `POST /api/lending/applications/{id}/submit` | Submit to named provider | Explicit application consent + live provider gates |
| `GET /api/lending/applications/{id}/offers` | Read current offers | Provider-sourced, versioned, expiring |
| `POST /api/lending/offers/{id}/acceptance-intents` | Prepare signing/acceptance | Reauthentication; no autonomous agent acceptance |
| `GET /api/lending/agreements/{id}/remittances` | Read servicing record | Tenant/entity scope; coverage and settlement status |
| `POST /api/lending/agreements/{id}/disputes` | Open servicing case | No unilateral contract rewrite |
| `POST /api/lending/providers/{provider}/webhook` | Receive provider event | Verified signature, inbox deduplication, replay protection |

Standard errors include `PROVIDER_UNAVAILABLE`, `SIMPLEFIN_UNVERIFIED`, `SIMPLEFIN_STALE`, `INSUFFICIENT_HISTORY`, `CONSENT_REQUIRED`, `APPROVAL_REQUIRED`, `APPROVAL_EXPIRED`, `TERMS_CHANGED`, `JURISDICTION_UNSUPPORTED`, `IDEMPOTENCY_CONFLICT`, `EXTERNAL_COMMIT_UNKNOWN`, `ACCOUNTING_CONFLICT`, `PAYMENT_RECONCILING`, and `RAIL_UNSUPPORTED`.

### Rollout sequence

| Stage | Build/release | Conditions for live use |
|---|---|---|
| 0 — useful foundation | `/lending` waitlist, data coverage/reconciliation, QuickBooks sandbox, review queue, provider directory | Honest status/copy, data privacy/security checks; no live funding |
| 1 — accounting release | Approved QBO publishing through PWA/API/CLI/MCP | Intuit production access/terms, tenant/OAuth/retry tests, accountant-reviewed mappings |
| 2 — partner financing pilot | Named-provider application, offer/signing, servicing display | Contract + external capital + exact SimpleFIN qualification + legal/rail/servicing approval |
| 3 — stablecoin pilot | One approved native asset/chain, direct provider/funder route, asset subledger | All Stage 2 gates plus crypto-specific permissions, identity/sanctions, finality and security review |
| 4 — permissioned P2P | Qualified single-funder pilot, then reviewed multi-funder allocation | Offering/intermediary/origination/servicing structure, actual funders, compatibility, independent contract audit where applicable |

No calendar or cost commitment is attached to these stages. Partner procurement and legal/security readiness may dominate engineering time. Keep every unfinished task unchecked in the accompanying OpenSpec bundle.

## Monetization

Prefer a disclosed provider-paid referral/origination revenue share where the actual agreements and applicable law permit it. This is negotiated revenue, not a promised YouLend commission rate. Do not imply QuickBooks' commercial agreement applies to CoinPay.

Offer optional paid accounting automation, reconciliation, reporting, and API usage within CoinPay's existing entitlement model. Leave lending waitlist/readiness access independent from a promise of approval. Any borrower application charge, financing charge, servicing charge, conversion spread, gas charge, or expedited-service fee must be separately reviewed, configurable, visible, and accepted before it can be incurred.

For future permissioned P2P, any platform, origination, servicing, or transaction-based compensation requires review of the actual legal intermediary role. Do not charge an invented percentage merely because a smart contract can split the payment. Capital belongs to external funders; only contractually earned fees belong to CoinPay.

Avoid a token launch, reserve-funded “guaranteed” returns, or subsidized financing. No software subscription or higher commission waives SimpleFIN qualification or other launch conditions.

Track unit economics as **earned platform revenue minus contracted provider charges, onboarding/check costs, payment/chain costs, infrastructure, support, and approved liability/chargeback exposure**. Before procurement, obtain actual setup fees, monthly minimums, required reserves, credit-loss allocation, and clawbacks. Existing infrastructure reuse can reduce incremental engineering/hosting cost; it does not make legal work, partner access, auditing, or underwriting free.

## Success Metrics

The following are proposed acceptance targets, not measured results:

| Outcome | Measurement / launch target |
|---|---|
| Honest availability | 100% of live offerings have current product/profile/jurisdiction/rail/compatibility evidence |
| Zero CoinPay lending-capital exposure in this model | No principal-funded, first-loss, or return-guarantee commitment accepted by configuration or contract |
| Controlled accounting writes | 100% of published entries linked to an approved rule/plan and identified business/company |
| Duplicate and overcollection safety | No duplicate posting or collection in the specified concurrency/retry/timeout fault-injection fixtures |
| Reproducible evidence | 100% of eligibility/remittance snapshots carry as-of time, coverage, rule version, and source lineage |
| Recoverability | Every uncertain external action visible in a reconciliation queue with a documented owner/runbook |
| Privacy | No raw credentials or identity documents in logs, analytics, ordinary MCP responses, or public chain storage |
| Useful accounting adoption | Connected companies, plans reviewed, successful approved posts, conflicts caught, and reconciliation time |
| Financing-market fit | Consented applications, verified offers, accepted/funded conversions, funding time, user complaints and reconciliation disputes |
| Sustainable operations | Positive measured contribution margin after actual contracted costs; no hidden subsidy or unbudgeted provider spend |
| Future credit reporting integrity | Default/loss and realized-return metrics tied to actual serviced cash events, not projected yield |

Instrumentation SHALL exclude sensitive financial payloads and must distinguish research, sandbox/testnet, and live cohorts. Do not display internal test targets as public service guarantees.

## Risks & Open Questions

This is a product/engineering plan, not a legal opinion, credit recommendation, accounting opinion, or authorization to operate a financing program. Qualified financial-services counsel, a suitable accountant, and the actual providers must approve the relevant launch decisions.

| Open issue | Owner | Required decision/evidence |
|---|---|---|
| No qualifying live funding program has been verified | Business development + compliance | Executed partner agreement, actual capital, costs, geographic/product scope, servicing responsibilities |
| Mandatory SimpleFIN may exclude otherwise attractive providers | Integration + product | Exact offered account/obligation verification; accept unavailable status instead of a bypass |
| Provider may not accept SimpleFIN/QBO-derived underwriting evidence | Integration + privacy/legal | Written data-use permission, schema/provenance expectations, supplemental evidence policy |
| Crypto support may not exist at a fiat financing provider | Provider/rail lead | Approved direct stablecoin program or separately authorized conversion; no implicit support claim |
| RBF legal characterization and disclosures | Financial-services counsel | Product-specific reviewed contract and jurisdiction analysis; no reliance on a “not a loan” label |
| Brokering/servicing and digital-asset roles | Financial-services counsel | Licenses, exemptions, agreements, and operating restrictions for actual functions and current law |
| Permissioned P2P can still involve securities/intermediary obligations | Securities + lending counsel | Lawful offering/participant/compensation model before solicitation, funding, or public deal details |
| Off-chain sales diversion, fraud, poor coverage, or changed accounts | Provider underwriter/servicer | Evidence rules, challenge/reconciliation process, borrower rights, recovery plan |
| Personal guarantees and liens may differ by product | Provider + counsel | Accurate per-offer terms; no blanket unsecured/no-guarantee marketing |
| Failed/returned ACH and uncertain blockchain finality | Payment/security leads | Rail-specific authoritative lifecycle, dispute/refund/reorg procedures, tested reserves/locks |
| Smart-contract defects and real custody/control | Security + counsel | Audited scoped contracts, transparent authority, incident response, legal control review |
| Correct RBF/crypto accounting | Accountant + integration lead | Product-specific chart mappings, principal/fee policy, FX/asset subledger treatment |
| Provider insolvency or CoinPay outage | Servicing owner | Records portability, alternate payment/contact channel, backup servicing arrangements |
| Engineering/spec drift | Engineering owner | Fresh repository inventory, existing PRD/capability reconciliation, test report, migration plan |

### Primary-source and prior-work notes

Sources were reviewed on September 12, 2026. Government sources below establish issues for review, not a conclusion that a particular CoinPay model is lawful or unlawful. The 2008 SEC action is a historical example of marketplace notes treated as securities, not a claim that every P2P arrangement is identical. The FinCEN document is interpretive guidance; evaluate current applicable law and facts before launch. No source below verifies SimpleFIN compatibility for YouLend or any crypto-financing product.

[^openprd]: LogicSRC, OpenPRD 0.3 overview and linked front-matter schema. `https://logicsrc.com/openprd` and `https://github.com/profullstack/logicsrc/blob/master/packages/schemas/schemas/openprd-prd.schema.json`.
[^simplefin]: SimpleFIN protocol, published as version 2.0.0-draft, including read-only purpose, explicit versioning, account/transaction identities, decimal amounts, sign convention, and error/coverage fields. `https://www.simplefin.org/protocol.html`.
[^qbo-mcp]: Intuit's official QuickBooks Online MCP repository, documenting OAuth, accounting entities, and read/write controls. `https://github.com/intuit/quickbooks-online-mcp-server`. Validate each Accounting API operation, production entitlement, and data-use permission against current Intuit documentation during implementation; an MCP tool does not grant extra underlying API rights.
[^youlend]: YouLend, Introduction to APIs. `https://docs.youlend.com/reference/introduction`. Establishes embedded-finance API capability, not CoinPay's partner status, commercial terms, crypto support, or SimpleFIN compatibility.
[^ca-disclosures]: California Financial Code §22800, including the commercial-financing definition and receivables-purchase transactions. `https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=FIN&sectionNum=22800.`. Counsel must review the complete applicable disclosure framework, current regulations, geography, thresholds, and exemptions.
[^ca-license]: California Financial Code §22100. `https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=FIN&sectionNum=22100.`. The statute addresses finance-lender/broker licensing; exact applicability and exemptions require legal analysis.
[^fincen]: FinCEN, FIN-2019-G001, especially the facts-and-circumstances approach and §4.4 on decentralized applications. `https://www.fincen.gov/resources/statutes-regulations/guidance/application-fincens-regulations-certain-business-models` and `https://www.fincen.gov/system/files/2019-05/FinCEN%20Guidance%20CVC%20FINAL%20508.pdf`.
[^ofac]: OFAC FAQ 560: sanctions obligations apply to digital currency as well as traditional fiat currency. `https://ofac.treasury.gov/faqs/560`.
[^sec-prosper]: SEC, In the Matter of Prosper Marketplace, Inc., Securities Act Release No. 8984, November 24, 2008. `https://www.sec.gov/files/litigation/admin/2008/33-8984.pdf`.
[^repo-package]: Inspected CoinPay dependency/entry-point baseline. `https://github.com/profullstack/coinpayportal/blob/cd4cb3ad2b1939e16e4f04f3fe53bc19abeb86ff/package.json`.
[^repo-simplefin]: Inspected CoinPay SimpleFIN client. `https://github.com/profullstack/coinpayportal/blob/cd4cb3ad2b1939e16e4f04f3fe53bc19abeb86ff/src/lib/finances/simplefin.ts`.
[^repo-ach]: Inspected CoinPay ACH implementation notes; the document explicitly reports no live ACH exercise. `https://github.com/profullstack/coinpayportal/blob/cd4cb3ad2b1939e16e4f04f3fe53bc19abeb86ff/docs/ACH.md`. Treat other operational/legal statements in repository notes as claims to verify, not regulatory authority.
[^prior-formation]: Prior user Library document `0001-automate-entity-formation-simplefin-banking.md`, September 12, 2026, especially the mandatory compatibility rule, partner-led financing requirements, separate approvals, and no-waiver policy. This PRD carries those constraints forward; it adds a separately gated future financing/settlement scope rather than retroactively enabling entity-formation drawdowns.
[^prior-finances]: Prior user Library document `coinpay-finances-statements-openprd-v1.md`, September 12, 2026. Preserve the existing finance/SDK/CLI integration boundary and report/statement distinction; recheck implementation status.
