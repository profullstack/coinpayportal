# lending-remittances specification

Source: `prd/0001-coinpay-lending-quickbooks-sync.md`. These proposed deltas preserve the PRD policy and add acceptance scenarios. They do not claim implemented behavior or live availability. Update the PRD, deltas and traceability together when requirements change.

## ADDED Requirements

### Requirement: R25 — Calculate revenue-share remittances from contract terms

The system SHALL enforce the following policy from PRD 0001 R25 [P0]:

For a simple capped RBF example, determine the day's obligation as `min(remaining contractual cap, round(eligible sales × remittance rate))`, with contract-specific rounding and lawful adjustments. Reserve in-flight collection amounts under a lock so parallel jobs cannot overcollect. Apply the cap to actual settled collections plus reservations; reverse reservations on a confirmed failed payment. Do not assume a fixed fee is an APR, a maturity date, or a guaranteed investor return.

#### Scenario: A01 — Illustrative daily remittance

- **GIVEN** fictional funding is $10,000, the fixed fee is $2,500, remittance is 10%, and eligible sales are $500
- **WHEN** the simple capped example assesses the day under its rounding policy
- **THEN** the initial cap is $12,500, assessed remittance is $50, and sales remainder is $450 before other expenses; the fee is not labeled APR or a guaranteed return

#### Scenario: A04 — Remaining cap limits a reservation

- **GIVEN** only $20 remains available under the cap after settled collections and in-flight reservations, while sales imply $50
- **WHEN** a new collection is reserved
- **THEN** at most $20 is reserved or collected and the full settled-plus-reserved total cannot exceed the contractual cap

#### Scenario: A05 — Concurrent workers share one collection identity

- **GIVEN** two workers attempt the same final $20 collection
- **WHEN** they contend for the agreement lock and durable assessment/reservation identity
- **THEN** only one reservation/outbox collection request survives; the second worker reuses the durable identity and no second debit occurs

### Requirement: R26 — Separate true zero sales from unknown sales

The system SHALL enforce the following policy from PRD 0001 R26 [P0]:

A verified zero-sales day in a product promising revenue-linked remittances produces zero sales-based remittance. Missing data creates a review/pending-calculation state, not a zero-revenue certification and not an automatic catch-up debit. Provider estimated-debit/reconciliation mechanisms, if any, require their own accurately disclosed product configuration and mandates. They must not be presented as the simple daily-percentage example.

#### Scenario: A02 — Verified zero sales

- **GIVEN** the same illustrative revenue-linked contract has a verified $0 eligible-sales day
- **WHEN** the daily assessment runs
- **THEN** sales-based remittance is $0 and the contract remains active unless the actual contract provides otherwise

#### Scenario: A03 — Missing data is unknown

- **GIVEN** the provider/account feed is unavailable and the day's sales cannot be established
- **WHEN** readiness or remittance calculation is requested
- **THEN** revenue is unknown and enters review/pending calculation; there is no fabricated zero, unsupported eligibility decision, default or automatic catch-up debit

