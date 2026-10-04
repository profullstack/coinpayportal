# finance-evidence specification

Source: `prd/0001-coinpay-lending-quickbooks-sync.md`. These proposed deltas preserve the PRD policy and add acceptance scenarios. They do not claim implemented behavior or live availability. Update the PRD, deltas and traceability together when requirements change.

## ADDED Requirements

### Requirement: R1 — Extend existing CoinPay domains

The system SHALL enforce the following policy from PRD 0001 R1 [P0]:

Reuse merchant/organization identities, finance connections, account mapping, invoices, payment references, and the existing SDK/CLI. Link financing to the same legal business entity used by the finance workspace. Do not build a parallel bank-data store or duplicate SimpleFIN credentials in the lending subsystem.

#### Scenario: Reuse an existing finance connection

- **GIVEN** a merchant has an authorized business finance connection and retained transactions
- **WHEN** the business creates a lending readiness draft
- **THEN** the draft references that legal entity and existing connection; no second SimpleFIN credential or parallel bank-data store is created

### Requirement: R6 — Enforce product-level and account-level SimpleFIN qualification

The system SHALL enforce the following policy from PRD 0001 R6 [P0]:

Before recommending or initiating an offered bank/card/financing account, verify the exact institution, product, business profile, geography, connection route, and required account data. After account creation, verify the customer's actual connection. Preserve verification date, test evidence, expiry/retest policy, and failure scope. The financed obligation itself requires qualification; a compatible repayment checking account alone does not qualify an otherwise unsupported loan product.

#### Scenario: A11 — A compatible repayment bank does not qualify the obligation

- **GIVEN** the financing provider has an API and the repayment checking account is SimpleFIN-verified, but the financing obligation is unverified
- **WHEN** the user requests a recommendation or account-opening workflow
- **THEN** the product is unavailable with SIMPLEFIN_UNVERIFIED; verify the exact product/profile/route before opening and the customer's actual account after creation

### Requirement: R7 — Do not waive compatibility for crypto or referrals

The system SHALL enforce the following policy from PRD 0001 R7 [P0]:

Direct lender APIs, on-chain visibility, QuickBooks records, uploaded statements, affiliate commissions, or an operator checkbox SHALL NOT bypass R6. An unverified crypto financing account remains unavailable. Do not create a superficial SimpleFIN wrapper around unverified data and call the upstream account verified. Any future protocol-serving adapter requires an independently reviewed authoritative data source and end-to-end compatibility tests; it is not a shortcut in this release.

#### Scenario: No crypto or referral compatibility waiver

- **GIVEN** an unverified crypto financing account has an explorer, provider API, uploaded statements and an affiliate fee
- **WHEN** an operator attempts to enable the product or a superficial protocol wrapper
- **THEN** the product remains unavailable; none of those substitutes establishes product/account SimpleFIN compatibility

### Requirement: R8 — Use explicit SimpleFIN versions

The system SHALL enforce the following policy from PRD 0001 R8 [P0]:

Extend the existing client with v2-first capability verification, explicit requested version, and version-specific fixtures. Record observed capabilities because the published v2 specification is a draft. Preserve supported v1 only under an explicit labeled compatibility policy; malformed v2 data SHALL NOT trigger a silent downgrade. Namespace source identities by tenant, provider connection, upstream connection, account, and transaction.

#### Scenario: Malformed v2 data cannot trigger silent downgrade

- **GIVEN** the client explicitly requested SimpleFIN v2 under a recorded capability policy
- **WHEN** the response is malformed or inconsistent with its version fixture
- **THEN** the error and coverage failure are recorded; the client does not silently retry as v1 or merge colliding upstream transaction identities

### Requirement: R9 — Secure financial credentials and URLs

The system SHALL enforce the following policy from PRD 0001 R9 [P0]:

Claim setup tokens in the backend, encrypt access credentials, and avoid shell arguments or agent transcripts containing secrets. Apply HTTPS, allowed-origin, DNS/private-address, redirect, and SSRF checks to claim/access/institution/custom-currency URLs. No provider or funder receives the user's SimpleFIN Access URL. Revocation SHALL stop future authorized reads and downstream data sharing according to recorded consents.

#### Scenario: Unsafe claim URLs and revoked access are blocked

- **GIVEN** a setup token resolves to a private address, redirects outside approved origins, or an existing read consent is revoked
- **WHEN** a backend financial source request is attempted
- **THEN** the unsafe request or revoked future read/sharing is blocked; Access URLs and credentials never appear in provider payloads, shell arguments, logs or agent transcripts

### Requirement: R10 — Map only authorized business accounts

The system SHALL enforce the following policy from PRD 0001 R10 [P0]:

Require entity ownership/scope confirmation and separate accounting-company mapping. Personal accounts and another business's activity SHALL NOT be imported into this company's books or funding profile by default. Mapping changes invalidate affected drafts and approvals. One merchant may have several legal entities and several QuickBooks companies; do not infer that they are interchangeable.

#### Scenario: Entity mapping changes invalidate approval

- **GIVEN** a merchant has accounts for two legal businesses and a posting plan approved for one company
- **WHEN** an account is remapped to another entity or QuickBooks company
- **THEN** the affected drafts and approvals become invalid; the old plan cannot post another business's or personal activity

### Requirement: R11 — Make coverage part of every financial claim

The system SHALL enforce the following policy from PRD 0001 R11 [P0]:

Store `as_of`, earliest retained record, requested period, account coverage, provider errors, pending status, and completeness. A revenue total for an incomplete period SHALL say “posted through [timestamp] across [available accounts]” beside the first total. Missing data is unknown, not zero. Do not manufacture three months of history from a shorter available feed; support continuing retention and reviewed supplemental evidence without treating it as a compatibility substitute.

#### Scenario: A10 — Forty days are not ninety days of evidence

- **GIVEN** a business has forty retained days and the provider requires ninety days
- **WHEN** a readiness total is displayed or eligibility evidence is prepared
- **THEN** the result is insufficient history with explicit requested period, earliest retained date, as_of, accounts and completeness; the first total states posted-through coverage without inventing missing months

### Requirement: R12 — Separate all data-sharing consent

The system SHALL enforce the following policy from PRD 0001 R12 [P0]:

Account linking, QuickBooks writing, lender underwriting disclosure, bureau access, recurring monitoring, public fundraising disclosure, and marketing are different permissions. Record purpose, recipient, fields, expiry, actor, and revocation behavior. Review the applicable Intuit, SimpleFIN/Bridge, and capital-provider terms before using connected data for underwriting or sending it to another party. No resale, unrelated advertising, or model training by default.

#### Scenario: Account linking is not underwriting consent

- **GIVEN** a business authorized account linking but not disclosure to a named lender
- **WHEN** an application draft attempts to share financial fields
- **THEN** sharing is blocked with CONSENT_REQUIRED until purpose, named recipient, fields, expiry and actor are authorized; separate accounting, bureau, monitoring, fundraising and marketing consent remains independent

### Requirement: R21 — Build one economic-event reconciliation layer

The system SHALL enforce the following policy from PRD 0001 R21 [P0]:

Reconcile SimpleFIN rows, CoinPay invoice/payment events, processor settlements, permitted QuickBooks records, and supported on-chain observations. Count a sale once, not once per data source. Exclude funding proceeds, inter-account transfers, owner capital, wallet self-transfers, test activity, and duplicated settlements from qualifying sales. Handle refunds, chargebacks, tax, tips, and processor fees according to the signed product's revenue definition. Net bank deposits SHALL NOT be silently relabeled gross sales.

#### Scenario: A net settlement is not gross sales

- **GIVEN** a processor settlement includes fees, refunds and a transfer from another owned account
- **WHEN** a revenue snapshot is calculated
- **THEN** only reconciled qualifying sales under the signed revenue definition contribute; gross/net basis, exclusions and fees remain explicit and net deposits are not silently relabeled gross sales

### Requirement: R22 — Normalize signs by source contract

The system SHALL enforce the following policy from PRD 0001 R22 [P0]:

Preserve original signed decimal strings and explicit debit/credit direction. Native SimpleFIN specifies positive transaction amounts for deposits; the implementation SHALL test that convention rather than borrow an unrelated aggregator's sign rules. Use exact decimal or integer-minor-unit arithmetic, never floating-point financial accumulation.

#### Scenario: A18 — Native SimpleFIN deposits are positive

- **GIVEN** a native SimpleFIN transaction has a positive signed decimal amount
- **WHEN** normalization processes the version-specific fixture
- **THEN** it preserves the original decimal text and treats the row as an inflow candidate using exact arithmetic; revenue still requires economic classification

### Requirement: R23 — Version the revenue profile

The system SHALL enforce the following policy from PRD 0001 R23 [P0]:

Each underwriting/remittance snapshot SHALL include the selected legal entity, sources, period/timezone, gross/net basis, exclusions, coverage, reconciliation decisions, FX method, rule version, and lineage to source records. No snapshot is silently edited after an offer or collection uses it. A correction creates a new version and an explicit adjustment proposal. User-created QuickBooks sales entries alone are not independently verified cash receipts.

#### Scenario: Corrected evidence creates a new snapshot

- **GIVEN** a versioned revenue snapshot has already supported an offer or remittance
- **WHEN** new evidence changes an exclusion, FX method or source record
- **THEN** the old snapshot and lineage remain intact; a new version identifies the rule, coverage, reconciliation and source change and creates an explicit adjustment proposal

### Requirement: R24 — Treat crypto receipts as evidence, not automatic sales

The system SHALL enforce the following policy from PRD 0001 R24 [P0]:

Require invoice/customer/business-purpose linkage or another approved evidence path. A random wallet transfer, token swap, bridge transfer, loan draw, or circular transfer SHALL NOT automatically count as merchant revenue. Where justified by the provider, flag self-funding, wash activity, manipulated invoices, and large unexplained differences for human review. Minimize collection of unrelated wallet history.

#### Scenario: A12 — Wallet movements are not automatically sales

- **GIVEN** an observed on-chain deposit is a self-transfer or unrelated token swap without approved business-purpose evidence
- **WHEN** the revenue profile evaluates the receipt
- **THEN** the receipt contributes no qualifying merchant sales; any reviewed inclusion must have invoice/customer/business-purpose or another approved evidence path

