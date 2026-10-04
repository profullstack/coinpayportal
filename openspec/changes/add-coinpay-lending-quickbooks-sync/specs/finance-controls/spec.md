# finance-controls specification

Source: `prd/0001-coinpay-lending-quickbooks-sync.md`. These proposed deltas preserve the PRD policy and add acceptance scenarios. They do not claim implemented behavior or live availability. Update the PRD, deltas and traceability together when requirements change.

## ADDED Requirements

### Requirement: R41 — Use one service layer across interfaces

The system SHALL enforce the following policy from PRD 0001 R41 [P0]:

CLI, SDK, public API, MCP, and PWA SHALL call the same policy-checked application services. Provide read, draft, preview, approval-request, status, and permitted execution operations. Do not duplicate the financing engine inside an MCP tool or run an LLM for each routine financial transaction.

#### Scenario: All interfaces enforce the same service policy

- **GIVEN** the same merchant/entity requests a readiness draft or approved accounting action through PWA, API, SDK, CLI or MCP
- **WHEN** the application service evaluates the operation
- **THEN** authorization, evidence gates, error codes and financial effects are consistent across interfaces; no separate MCP financing engine or routine per-transaction LLM is used

### Requirement: R42 — Prevent agent-created authority

The system SHALL enforce the following policy from PRD 0001 R42 [P0]:

An agent cannot approve its own posting plan, sign a personal guarantee, accept borrowing, execute an investment commitment, expand a mandate, or mint its own approval artifact. High-impact operations require authenticated approval bound to entity, operation, amount/currency, recipient, plan/terms hash, and expiry. Read-only MCP tools are enabled by default; arbitrary provider API passthrough is prohibited.

#### Scenario: A16 — An agent cannot create borrowing authority

- **GIVEN** a merchant agent invokes lending through MCP without authenticated human borrowing authority
- **WHEN** it requests application acceptance, a guarantee or movement of funds
- **THEN** the result is draft/APPROVAL_REQUIRED only; the agent cannot mint, approve or expand its own approval artifact and high-impact execution requires a current entity/operation/amount/recipient/hash-bound human approval

### Requirement: R43 — Keep decision support explainable and reviewable

The system SHALL enforce the following policy from PRD 0001 R43 [P0]:

AI may summarize records and suggest classifications, not fabricate source facts or final credit decisions. Underwriters must be able to trace inputs and record provider decision reasons. Determine applicable fair-lending, credit-report, adverse-action, privacy, and recordkeeping requirements with qualified counsel for the actual role/product. Do not use protected characteristics as underwriting features or publish an opaque “AI credit score” as an official bureau score.

#### Scenario: AI suggestions preserve source and decision provenance

- **GIVEN** an assistant suggests classifications or summarizes underwriting evidence
- **WHEN** a provider underwriter reviews the suggestion
- **THEN** source facts and discrepancies are traceable and provider decisions/reasons remain authoritative; protected characteristics and fabricated bureau scores are not used as underwriting features

### Requirement: R44 — Make asynchronous side effects auditable

The system SHALL enforce the following policy from PRD 0001 R44 [P0]:

Use verified webhook signatures, inbox deduplication, version/order checks, an outbox, durable correlation IDs, tenant isolation, retry limits, and dead-letter/reconciliation queues. Record actor, decision/approval references, source hashes, external IDs, state changes, and outcomes without logging secrets. Append-only application permissions plus separately retained integrity evidence may be used; do not call an ordinary editable database table physically immutable.

#### Scenario: Duplicate and out-of-order webhooks cannot repeat effects

- **GIVEN** an external event has already been processed and an older event or replay arrives
- **WHEN** the webhook inbox verifies signature, identity and version/order
- **THEN** the replay or stale transition cannot produce another side effect; correlated audit/outbox records remain tenant-scoped and unresolved failures enter bounded retry or reconciliation queues without secrets

### Requirement: R45 — Limit operational spending and data retention

The system SHALL enforce the following policy from PRD 0001 R45 [P0]:

Configure incremental hosting/provider budgets, per-tenant quotas, provider polling ceilings, cost alerts, and approval for paid checks. Reuse the existing retained ledger rather than rereading every account per page view. Set retention/access/deletion policies for financial data, identity evidence, contracts, and audit logs, including documented legal-hold exceptions. Customer-owned SimpleFIN access does not imply an unlimited reseller license.

#### Scenario: Page views do not create unbounded provider spend

- **GIVEN** a tenant has retained financial observations and a configured provider polling/check budget
- **WHEN** the user repeatedly opens financial pages or an automation attempts a paid check
- **THEN** pages reuse retained evidence, quotas and polling ceilings apply, paid checks need recorded approval, and retention/deletion follows the approved purpose and legal-hold policy

### Requirement: R46 — Gate launch by jurisdiction and actual activity

The system SHALL enforce the following policy from PRD 0001 R46 [P0]:

Obtain qualified financial-services counsel's written assessment of CoinPay's role, provider licensing/exemptions, commercial financing disclosures, lending/brokering, servicing/collections, securities/offerings, custody/money transmission, sanctions, applicable digital-asset laws, privacy, and credit reporting. California's statute covers specified commercial receivables-purchase transactions in addition to loans; calling a product RBF does not by itself eliminate disclosure analysis. Legal applicability depends on the facts and exemptions, not this PRD.

#### Scenario: A feature flag cannot replace jurisdiction review

- **GIVEN** engineering tests passed but written legal assessment or provider licensing/disclosure/rail evidence is missing for the requested jurisdiction and activity
- **WHEN** an operator sets a live financing feature flag
- **THEN** the affected capability remains unavailable until qualified counsel and actual provider evidence cover the activity; product naming cannot waive the review

### Requirement: R48 — Pass financial correctness and failure tests before activation

The system SHALL enforce the following policy from PRD 0001 R48 [P0]:

Acceptance coverage SHALL include cross-source duplicates, FX/decimal errors, stale sources, partial periods, tenant collisions, expired consent, offer changes, OAuth expiry, external edits, unknown API commit, out-of-order webhooks, ACH returns, crypto reorgs, underfunded deals, rounding, zero sales, overcollection prevention, and loss/default reporting. Passing tests is a release criterion—not a promise that errors are impossible.

#### Scenario: Passing document validation is not release evidence

- **GIVEN** the PRD and OpenSpec documents validate but applicable financial fault fixtures have not passed
- **WHEN** an operator attempts to activate a release capability
- **THEN** activation remains blocked pending actual applicable correctness and failure-test evidence, including duplicates, exact values, consent, uncertain commits, ordering, returns, reorgs, underfunding and losses

