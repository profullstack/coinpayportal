# quickbooks-sync specification

Source: `prd/0001-coinpay-lending-quickbooks-sync.md`. These proposed deltas preserve the PRD policy and add acceptance scenarios. They do not claim implemented behavior or live availability. Update the PRD, deltas and traceability together when requirements change.

## ADDED Requirements

### Requirement: R13 — Build a first-party API connector

The system SHALL enforce the following policy from PRD 0001 R13 [P0]:

Use QuickBooks Online OAuth and its Accounting API for the durable sync engine. Store the company/realm binding and encrypted rotating credentials. Enforce local read/write permissions even where provider scopes are broad. Use production HTTPS callbacks and a browser-assisted authorization route that also works when the CLI runs over SSH. Intuit's official MCP implementation is a useful reference; running one local server per customer is not the production architecture.

#### Scenario: Remote-terminal OAuth and company binding

- **GIVEN** an authorized accounting administrator starts QuickBooks connection from an SSH terminal
- **WHEN** the connect operation runs with --no-browser
- **THEN** it supplies a public HTTPS browser-assisted authorization flow and validates the returned realm/entity binding while keeping rotating tokens encrypted and enforcing local read/write permissions

### Requirement: R14 — Preview before publishing

The system SHALL enforce the following policy from PRD 0001 R14 [P0]:

Produce an immutable, versioned posting plan with source events, destination company, accounts, record types, dates, amounts, fees, currencies, tax treatment, links, and classification confidence. The default is user/accountant review. Deterministic auto-posting may be enabled only by a specifically approved rule limited to named accounts and transaction types; lending acceptance is never included in that rule.

#### Scenario: Only the approved immutable plan may publish

- **GIVEN** an accountant approved a versioned posting plan and its source/mapping/company hash
- **WHEN** a mapping, source version or posting amount changes before execution
- **THEN** the previous approval cannot publish the changed plan; a new preview and approval or explicitly scoped approved rule is required

### Requirement: R15 — Publish accounting records, not a promised bank feed

The system SHALL enforce the following policy from PRD 0001 R15 [P0]:

Support validated entity mappings such as `Purchase`, `Deposit`, `Transfer`, `Invoice`, `Payment`, `BillPayment`, `SalesReceipt`, and exceptional accountant-approved `JournalEntry`. Treat creating records in QuickBooks as distinct from sending raw transactions to its bank-feed “For review” queue. Do not advertise native bank-feed delivery without a separately verified integration. Do not blindly convert every source transaction to a journal entry.

#### Scenario: Classified records are not a native bank feed

- **GIVEN** a reviewed source event maps to a supported QuickBooks entity
- **WHEN** the plan is rendered and published
- **THEN** the validated entity operation is used with its approved accounts; raw rows are not advertised as bank-feed For review delivery and ordinary events are not blindly converted to journal entries

### Requirement: R16 — Prevent duplicates within and across sources

The system SHALL enforce the following policy from PRD 0001 R16 [P0]:

Persist source identity, economic-event identity, company/realm, operation type, approved plan hash, external record ID, source version, and status under database uniqueness constraints. Match an invoice payment and later settlement to the same lifecycle. Inspect potential existing QuickBooks entries before new posting; ambiguous matches go to review. Similar date/amount/description alone is not sufficient proof of identity.

#### Scenario: A06 — One sale across invoice and settlement observations

- **GIVEN** an invoice, CoinPay payment and bank settlement have reviewed identity evidence for one $500 sale
- **WHEN** the economic event is reconciled and an accounting plan is prepared
- **THEN** qualifying sales are $500 once, not $1,000 or $1,500; fees reconcile separately and company/event/operation uniqueness prevents duplicate posting

### Requirement: R17 — Handle uncertain writes and external edits safely

The system SHALL enforce the following policy from PRD 0001 R17 [P0]:

Use a transactional outbox, provider-supported idempotency where available, serialized conflicting jobs, retry backoff, and reconciliation. After a timeout, determine whether the external write happened before issuing a new create. Store external concurrency/version tokens where supported. If an accountant edits a posted record, create a conflict/review item rather than overwriting it. A batch may be partially posted; show the successful records and resume only unresolved operations. Respect closed periods and do not automatically delete posted history.

#### Scenario: A08 — Reconcile a QuickBooks timeout after commit

- **GIVEN** QuickBooks committed a create but the response timed out
- **WHEN** the outbox worker resumes the unresolved item
- **THEN** it reconciles and links the existing external record before considering another create; an unknown outcome remains in review rather than blindly creating a duplicate

#### Scenario: A09 — Preserve a bookkeeper's external edit

- **GIVEN** a previously posted QuickBooks record has been edited by a bookkeeper
- **WHEN** the connector observes a changed external version or content
- **THEN** it creates ACCOUNTING_CONFLICT/review instead of overwriting; successful partial-batch items remain posted, unresolved work resumes separately, and closed history is not automatically deleted

### Requirement: R18 — Use financing-specific accounting policies

The system SHALL enforce the following policy from PRD 0001 R18 [P0]:

For a product legally/accountingly treated as borrowing, funding proceeds SHALL NOT be booked as sales; principal repayment SHALL NOT be booked wholly as an expense. Separate principal, financing charges, servicing fees, payment fees, and settlement differences under accountant-approved mappings. Receivables purchases/RBF may have different accounting treatment; require a reviewed product-specific template instead of assuming loan or sale treatment from marketing language. Corrections use reviewed adjustments with provenance.

#### Scenario: A07 — Funding proceeds are not sales

- **GIVEN** a $10,000 financing deposit arrives and the reviewed product policy treats it as borrowing
- **WHEN** the event is classified and an accounting plan is prepared
- **THEN** it is excluded from sales and mapped under the financing policy; principal, charges, fees and differences stay separate, and an RBF/receivables-purchase product requires its own reviewed template

### Requirement: R19 — Keep crypto subledgers separate from fiat bookkeeping

The system SHALL enforce the following policy from PRD 0001 R19 [P0]:

Record native asset quantity, chain, token contract, decimals, business base-currency value, valuation source/time, fees, and disposal/settlement events. Do not pretend QuickBooks has a native USDC currency or treat every token as exactly one USD. Publish an approved base-currency accounting representation with the asset subledger retained in CoinPay. Currency conversion and gain/loss policy require accounting review.

#### Scenario: Token value differs from one dollar

- **GIVEN** an approved stablecoin event has an explicit native quantity and a base-currency valuation different from its face quantity
- **WHEN** a QuickBooks plan is generated
- **THEN** the asset subledger retains chain, contract, decimals, quantity, valuation source/time and fees; the plan uses reviewed base-currency treatment without inventing a native USDC currency or assuming one token equals one USD

### Requirement: R20 — Keep financing independent of bookkeeping availability

The system SHALL enforce the following policy from PRD 0001 R20 [P0]:

A QuickBooks outage SHALL NOT re-trigger funding or cause a second debit. Mark `accounting_pending` and retry independently. An unapproved posting plan cannot serve as proof of revenue, a completed collection, or a binding financing obligation.

#### Scenario: A20 — OAuth expiry cannot repeat financing

- **GIVEN** a funded merchant's QuickBooks connection expires before an accounting job completes
- **WHEN** the accounting worker retries
- **THEN** the job waits for reauthorization with accounting_pending; financing/servicing status remains unchanged and no funding or debit is reissued

