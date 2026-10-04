# Requirements and acceptance traceability

Source: `prd/0001-coinpay-lending-quickbooks-sync.md`. This maps proposed requirements to OpenSpec deltas and unfinished tasks. None of these rows is an implementation or test-pass claim. The PRD retains the full A01–A20 fictional fixture inputs and expected results.

## Requirements

Every R1–R48 requirement appears once under `## ADDED Requirements` in the capability named below, with at least one `#### Scenario:`. Paths are relative to this change bundle. Task references resolve to `tasks.md`. Stage applicability follows the PRD; crypto-related P0 controls are mandatory whenever crypto is enabled.

| PRD requirement | Capability delta | Implementation / activation tasks | Scenario count |
|---|---|---|---|
| R1 | `specs/finance-evidence/spec.md` | 1.1 | 1 |
| R2 | `specs/lending-programs/spec.md` | 1.2, 1.9, 3.3, 5.7, 7.6, 8.4, 8.5 | 1 |
| R3 | `specs/lending-programs/spec.md` | 1.2, 4.4, 5.1, 7.2 | 1 |
| R4 | `specs/lending-programs/spec.md` | 1.2, 5.1, 5.4 | 1 |
| R5 | `specs/lending-programs/spec.md` | 5.2, 8.3 | 1 |
| R6 | `specs/finance-evidence/spec.md` | 1.2, 5.3, 6.1, 7.2 | 1 |
| R7 | `specs/finance-evidence/spec.md` | 1.2, 5.3, 6.1 | 1 |
| R8 | `specs/finance-evidence/spec.md` | 1.4 | 1 |
| R9 | `specs/finance-evidence/spec.md` | 1.3, 1.5 | 1 |
| R10 | `specs/finance-evidence/spec.md` | 1.3, 2.2 | 1 |
| R11 | `specs/finance-evidence/spec.md` | 1.6, 4.1 | 1 |
| R12 | `specs/finance-evidence/spec.md` | 1.3, 2.1, 3.2, 4.2, 5.4, 8.3 | 1 |
| R13 | `specs/quickbooks-sync/spec.md` | 2.1, 2.8, 3.1, 3.2 | 1 |
| R14 | `specs/quickbooks-sync/spec.md` | 2.2, 2.5, 2.8, 3.1, 3.2 | 1 |
| R15 | `specs/quickbooks-sync/spec.md` | 2.3, 2.8, 3.2 | 1 |
| R16 | `specs/quickbooks-sync/spec.md` | 2.4, 2.6, 2.8, 3.3 | 1 |
| R17 | `specs/quickbooks-sync/spec.md` | 2.5, 2.6, 2.8, 3.3, 8.5 | 2 |
| R18 | `specs/quickbooks-sync/spec.md` | 2.7, 2.8, 3.2, 3.3, 5.6 | 1 |
| R19 | `specs/quickbooks-sync/spec.md` | 2.8, 3.3, 6.2, 6.7 | 1 |
| R20 | `specs/quickbooks-sync/spec.md` | 2.5, 2.8, 3.3, 4.8, 8.5 | 1 |
| R21 | `specs/finance-evidence/spec.md` | 1.7 | 1 |
| R22 | `specs/finance-evidence/spec.md` | 1.4, 1.6, 6.2 | 1 |
| R23 | `specs/finance-evidence/spec.md` | 1.8, 4.1, 5.4 | 1 |
| R24 | `specs/finance-evidence/spec.md` | 1.7, 6.6 | 1 |
| R25 | `specs/lending-remittances/spec.md` | 1.9, 4.6 | 3 |
| R26 | `specs/lending-remittances/spec.md` | 1.6, 1.9, 4.6 | 2 |
| R27 | `specs/lending-programs/spec.md` | 4.1 | 1 |
| R28 | `specs/lending-programs/spec.md` | 4.2, 4.3, 4.9, 5.5, 7.2 | 1 |
| R29 | `specs/lending-programs/spec.md` | 4.3, 5.5, 8.3 | 1 |
| R30 | `specs/lending-programs/spec.md` | 4.4, 4.5, 4.8, 5.7, 6.5 | 1 |
| R31 | `specs/lending-programs/spec.md` | 4.7, 5.6 | 1 |
| R32 | `specs/lending-programs/spec.md` | 4.7, 4.8, 5.1, 5.6, 8.2, 8.5 | 1 |
| R33 | `specs/crypto-p2p-financing/spec.md` | 6.1, 6.2 | 1 |
| R34 | `specs/crypto-p2p-financing/spec.md` | 6.3, 6.5, 6.7 | 1 |
| R35 | `specs/crypto-p2p-financing/spec.md` | 6.4, 6.7, 7.5 | 1 |
| R36 | `specs/crypto-p2p-financing/spec.md` | 7.1, 7.2, 7.5, 7.6 | 1 |
| R37 | `specs/crypto-p2p-financing/spec.md` | 7.3, 7.5 | 1 |
| R38 | `specs/crypto-p2p-financing/spec.md` | 7.4, 7.5 | 1 |
| R39 | `specs/crypto-p2p-financing/spec.md` | 1.8, 6.6, 7.5 | 1 |
| R40 | `specs/crypto-p2p-financing/spec.md` | 1.5, 6.3, 6.6, 6.7, 7.5, 8.2 | 1 |
| R41 | `specs/finance-controls/spec.md` | 1.1, 3.1, 4.2, 4.9 | 1 |
| R42 | `specs/finance-controls/spec.md` | 1.3, 2.2, 2.8, 3.1, 4.2, 4.3, 4.9, 6.3, 7.2 | 1 |
| R43 | `specs/finance-controls/spec.md` | 1.8, 4.1, 5.5 | 1 |
| R44 | `specs/finance-controls/spec.md` | 1.3, 1.5, 2.6, 2.8, 3.3, 4.5, 4.7, 5.7, 8.2 | 1 |
| R45 | `specs/finance-controls/spec.md` | 1.9, 1.10, 3.2, 5.2, 8.3 | 1 |
| R46 | `specs/finance-controls/spec.md` | 5.5, 6.7, 7.1, 7.5, 8.3, 8.5 | 1 |
| R47 | `specs/lending-programs/spec.md` | 1.2, 1.9, 5.7, 7.6, 8.4 | 1 |
| R48 | `specs/finance-controls/spec.md` | 1.10, 2.8, 3.3, 4.5, 4.7, 5.7, 6.5, 6.7, 7.5, 8.1, 8.5 | 1 |

## Acceptance fixtures

Each fixture has a scenario with its A-number in the delta, so it can be found without relying on a requirement-title anchor. Execute it only in an appropriate controlled test environment when the corresponding implementation exists.

| Fixture | Requirement | Capability delta | Required outcome |
|---|---|---|---|
| A01 | R25 | `specs/lending-remittances/spec.md` | the initial cap is $12,500, assessed remittance is $50, and sales remainder is $450 before other expenses; the fee is not labeled APR or a guaranteed return |
| A02 | R26 | `specs/lending-remittances/spec.md` | sales-based remittance is $0 and the contract remains active unless the actual contract provides otherwise |
| A03 | R26 | `specs/lending-remittances/spec.md` | revenue is unknown and enters review/pending calculation; there is no fabricated zero, unsupported eligibility decision, default or automatic catch-up debit |
| A04 | R25 | `specs/lending-remittances/spec.md` | at most $20 is reserved or collected and the full settled-plus-reserved total cannot exceed the contractual cap |
| A05 | R25 | `specs/lending-remittances/spec.md` | only one reservation/outbox collection request survives; the second worker reuses the durable identity and no second debit occurs |
| A06 | R16 | `specs/quickbooks-sync/spec.md` | qualifying sales are $500 once, not $1,000 or $1,500; fees reconcile separately and company/event/operation uniqueness prevents duplicate posting |
| A07 | R18 | `specs/quickbooks-sync/spec.md` | it is excluded from sales and mapped under the financing policy; principal, charges, fees and differences stay separate, and an RBF/receivables-purchase product requires its own reviewed template |
| A08 | R17 | `specs/quickbooks-sync/spec.md` | it reconciles and links the existing external record before considering another create; an unknown outcome remains in review rather than blindly creating a duplicate |
| A09 | R17 | `specs/quickbooks-sync/spec.md` | it creates ACCOUNTING_CONFLICT/review instead of overwriting; successful partial-batch items remain posted, unresolved work resumes separately, and closed history is not automatically deleted |
| A10 | R11 | `specs/finance-evidence/spec.md` | the result is insufficient history with explicit requested period, earliest retained date, as_of, accounts and completeness; the first total states posted-through coverage without inventing missing months |
| A11 | R6 | `specs/finance-evidence/spec.md` | the product is unavailable with SIMPLEFIN_UNVERIFIED; verify the exact product/profile/route before opening and the customer's actual account after creation |
| A12 | R24 | `specs/finance-evidence/spec.md` | the receipt contributes no qualifying merchant sales; any reviewed inclusion must have invoice/customer/business-purpose or another approved evidence path |
| A13 | R34 | `specs/crypto-p2p-financing/spec.md` | funding is not active/final; chain state is reconciled and dependent disbursements are prevented while nonce, destination, asset, limits and expiry protections remain enforced |
| A14 | R38 | `specs/crypto-p2p-financing/spec.md` | allocations are $25, $15 and $10 before separately contracted fees, with one durable distribution event; reports distinguish realized amounts, remaining exposure, arrears and losses |
| A15 | R37 | `specs/crypto-p2p-financing/spec.md` | the deal is not treated as funded at $10,000; documented underfunding/cancellation rules apply and the approved operator returns unused funds without CoinPay holding the pool |
| A16 | R42 | `specs/finance-controls/spec.md` | the result is draft/APPROVAL_REQUIRED only; the agent cannot mint, approve or expand its own approval artifact and high-impact execution requires a current entity/operation/amount/recipient/hash-bound human approval |
| A17 | R5 | `specs/lending-programs/spec.md` | the program is rejected under this product model; operating costs and other liabilities remain separately recorded and budgeted |
| A18 | R22 | `specs/finance-evidence/spec.md` | it preserves the original decimal text and treats the row as an inflow candidate using exact arithmetic; revenue still requires economic classification |
| A19 | R2 | `specs/lending-programs/spec.md` | accounting remains usable and stablecoin funding remains disabled even if its feature flag is set |
| A20 | R20 | `specs/quickbooks-sync/spec.md` | the job waits for reauthorization with accounting_pending; financing/servicing status remains unchanged and no funding or debit is reissued |

## Additional release coverage

A01–A20 are a minimum fixture set. R48 also requires explicit evidence for FX/decimal errors, stale and partial sources, tenant collisions, expired/revoked consent, changed mappings/offers, OAuth expiry, external edits, partial batches and unknown commits, webhook ordering, ACH returns, crypto reorgs, underfunding, fair rounding, overcollection and loss/default reporting. Tasks 2.8, 3.3, 4.5–4.7, 5.7, 6.7, 7.5 and 8.1 carry the applicable failure coverage.

External approvals, actual provider/account qualification, legal/accounting review and production rail readiness remain separately required even after tests pass.

