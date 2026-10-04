# lending-programs specification

Source: `prd/0001-coinpay-lending-quickbooks-sync.md`. These proposed deltas preserve the PRD policy and add acceptance scenarios. They do not claim implemented behavior or live availability. Update the PRD, deltas and traceability together when requirements change.

## ADDED Requirements

### Requirement: R2 — Separate independently releasable capabilities

The system SHALL enforce the following policy from PRD 0001 R2 [P0]:

Provide independent gates for public discovery, accounting reads, accounting writes, financing applications, binding offer acceptance, fiat funding, stablecoin settlement, and permissioned P2P. A feature flag alone SHALL NOT activate a capability without all applicable evidence checks.

#### Scenario: A19 — Accounting available while crypto is unverified

- **GIVEN** fiat financing accounting is qualified and usable but the stablecoin rail is unverified
- **WHEN** the user requests available capabilities
- **THEN** accounting remains usable and stablecoin funding remains disabled even if its feature flag is set

### Requirement: R3 — Require an external capital source

The system SHALL enforce the following policy from PRD 0001 R3 [P0]:

A live offer SHALL identify the legal provider, funding counterparty, product, servicer, applicable jurisdiction, and source of executable funding authority. Approval, a displayed wallet balance, and an unsigned funding commitment are not disbursement. CoinPay SHALL NOT fund the principal, guarantee funder returns, or supply a first-loss reserve in this product's approved business model.

#### Scenario: Acceptance and commitments do not establish funding

- **GIVEN** an externally sourced offer has been accepted but no verified settlement evidence exists
- **WHEN** the funding status is evaluated
- **THEN** the agreement remains funding-pending; a wallet balance, approval or unsigned commitment does not establish disbursement and CoinPay supplies no principal

### Requirement: R4 — Keep a capability/evidence directory

The system SHALL enforce the following policy from PRD 0001 R4 [P0]:

Store providers as `research_only`, `contracting`, `sandbox`, `verified`, `suspended`, or `retired`, with separate product/country/state/entity/currency/rail support. Default all researched providers to unavailable. Evidence SHALL cover contracts, provider permissions, SimpleFIN compatibility, data-use rights, funding/servicing behavior, support escalation, legal review, and commercial costs. YouLend is a research candidate, not a selected or verified provider.

#### Scenario: A research provider cannot serve live applications

- **GIVEN** a YouLend candidate record is research_only and has public API documentation but no approved program evidence
- **WHEN** a live application is requested
- **THEN** the provider is unavailable and no external application is submitted; status changes alone cannot waive missing product/profile/region/rail evidence

### Requirement: R5 — Reject treasury-risk obligations

The system SHALL enforce the following policy from PRD 0001 R5 [P0]:

Partner procurement SHALL record reserves, prefunding, repurchase obligations, fraud indemnities, commission clawbacks, operational liabilities, and minimum-volume fees. Reject a program that requires CoinPay lending capital or credit-loss guarantees. Do not interpret “partner-funded” as “zero cost” or “zero liability”; budget approved non-credit operating exposure explicitly.

#### Scenario: A17 — Reject a first-loss reserve

- **GIVEN** a proposed partner agreement requires CoinPay to post a first-loss reserve
- **WHEN** procurement evaluates the program
- **THEN** the program is rejected under this product model; operating costs and other liabilities remain separately recorded and budgeted

### Requirement: R27 — Keep provider underwriting authoritative

The system SHALL enforce the following policy from PRD 0001 R27 [P0]:

Store minimum trading history, eligible revenue, industry restrictions, credit criteria, and document needs in versioned provider/product configuration. Do not hardcode the pasted YouLend FAQ's eligibility criteria, country count, funding count, soft-check promise, or personal-guarantee policy as CoinPay facts. Low or zero revenue may mean no RBF offer; the UI SHALL not invent an offer or route to hidden debt products.

#### Scenario: A provider's real criteria govern readiness

- **GIVEN** the versioned provider configuration requires more trading history or eligible revenue than the business has
- **WHEN** the business checks financing readiness
- **THEN** the result identifies insufficient evidence or unavailable offers without inventing terms, hardcoding candidate-provider marketing claims or routing to hidden debt products

### Requirement: R28 — Require explicit authority for consequential steps

The system SHALL enforce the following policy from PRD 0001 R28 [P0]:

KYB/KYC information, application submission, hard credit pull, personal guarantee, offer acceptance, drawdown, bank-debit mandate, wallet allowance, and a funder's investment commitment require appropriate separate approvals. Where possible, identity documents and signatures go directly to the approved provider. A declined application SHALL NOT automatically trigger submissions to other lenders.

#### Scenario: A decline does not authorize another application

- **GIVEN** a borrower separately consented to submit only to one named provider and that provider declined
- **WHEN** the workflow advances or an agent tries another provider
- **THEN** no new lender submission, hard pull, guarantee, drawdown, acceptance, payment mandate or investment commitment occurs without its own appropriate approval

### Requirement: R29 — Render complete, versioned offers

The system SHALL enforce the following policy from PRD 0001 R29 [P0]:

An offer SHALL show the actual provider, legal product classification, nominal funding, net proceeds, fixed fee/interest where applicable, total cost/cap, remittance definition, estimates and assumptions, maturity if any, early-completion treatment, guarantees/liens, default terms, all CoinPay/provider/conversion/gas charges, currency, funding rail, expiry, and required jurisdiction disclosures. Never label a product “0% APR” merely because it has a fixed fee. No blanket “not a loan,” “no collateral,” or “no credit impact” copy.

#### Scenario: Changed offer terms invalidate prior authority

- **GIVEN** a provider replaces an offer with different net proceeds, charges, remittance terms or guarantees
- **WHEN** the user opens or attempts to accept the offer
- **THEN** the current version displays all required terms, fees, rail, expiry and disclosures; acceptance of an old hash fails with TERMS_CHANGED and no fixed fee is marketed as 0% APR

### Requirement: R30 — Use an explicit lifecycle

The system SHALL enforce the following policy from PRD 0001 R30 [P0]:

Support draft, evidence-incomplete, ready-for-consent, submitted, under-review, action-required, declined, offered, expired, accepted, funding-pending, active, reconciliation-required, disputed, delinquency-review, completed, cancelled, and provider-unavailable states where applicable. Preserve each provider's original status. Acceptance is not funding; a transaction hash is not sufficient finality; no offer SHALL be marked funded without verified provider/rail evidence.

#### Scenario: Provider status is distinct from verified settlement

- **GIVEN** a provider reports accepted or sends a funding transaction hash without sufficient rail evidence
- **WHEN** the application lifecycle is updated
- **THEN** the original provider status is preserved but the agreement remains funding-pending; only verified provider/rail evidence can mark funding active

### Requirement: R31 — Use a separately approved collection rail

The system SHALL enforce the following policy from PRD 0001 R31 [P0]:

Bank collections require an approved provider/servicer and a valid mandate for this specific financing use. The existing CoinPay ACH purchase flow is not automatically approved for debt collection or investor distribution. SimpleFIN credentials and QuickBooks OAuth never authorize debits. Only the authorized collector originates a collection; CoinPay may request it only under a separately approved contractual and technical role.

#### Scenario: Purchase ACH permissions cannot authorize collection

- **GIVEN** a merchant has SimpleFIN credentials, QuickBooks OAuth and an existing CoinPay ACH purchase flow
- **WHEN** a financing collection is requested without a financing-specific mandate and approved collector role
- **THEN** the collection is rejected; only the separately authorized collector may originate the debit under the approved contract and rail

### Requirement: R32 — Provide servicing and dispute controls

The system SHALL enforce the following policy from PRD 0001 R32 [P0]:

Show eligible sales, assessed obligation, pending/settled/returned collections, remaining cap, adjustments, provider reconciliation, and QuickBooks status separately. Support payment failures, overpayment refunds, duplicate-collection disputes, hardship/reconciliation requests, contact escalation, and provider outages. Authoritative contract/servicing records remain identifiable. A CoinPay outage SHALL NOT strand a borrower without an approved alternative servicing/payment route.

#### Scenario: Borrowers retain a servicing path during an outage

- **GIVEN** a merchant has active financing and CoinPay or a provider integration is unavailable
- **WHEN** the merchant needs payment status, a duplicate-collection dispute or hardship/reconciliation support
- **THEN** the interface preserves separate assessment, settlement and accounting status and exposes the approved alternative servicing/payment/contact route without rewriting the contract

### Requirement: R47 — Keep public claims and product status synchronized

The system SHALL enforce the following policy from PRD 0001 R47 [P0]:

Public pages, API capability responses, CLI output, agent descriptions, structured data, pricing, and emails SHALL use the same verified availability record. No invented partner logos, approvals, funded totals, guarantees, savings, or customer testimonials. Permissioned P2P remains an explicitly unavailable future capability until enabled; a generic “become a funding partner” intake is not a retail investment offer.

#### Scenario: Public copy follows suspended availability

- **GIVEN** a program's qualification expires or its provider becomes suspended
- **WHEN** web pages, pricing, structured data, CLI/API responses or MCP descriptions render availability
- **THEN** each uses the same unavailable record, removes live transaction CTAs and avoids invented approvals, totals, guarantees or P2P retail investment claims

