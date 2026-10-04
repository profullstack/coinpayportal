# Add CoinPay Lending and QuickBooks accounting sync

## Why

Merchants need connected financial evidence, approved bookkeeping, and a financing application workflow without CoinPay supplying lending capital. Accounting must deliver value while financing providers and rails remain unverified.

Source: `prd/0001-coinpay-lending-quickbooks-sync.md`, OpenPRD 0.3, status Draft. This proposal preserves all R1–R48 requirements and A01–A20 fixtures. It is a specification, not implementation or launch approval.

## What Changes

- Add a mobile-first public `/lending` waitlist and an educational remittance calculator, with availability shared across web, API, CLI, SDK, and MCP.
- Extend existing finance identities, connections, and retained observations with exact-money normalization, economic-event reconciliation, purpose-specific consent, entity mappings, coverage, and versioned revenue evidence.
- Add first-party QuickBooks OAuth, account/company mappings, reviewed posting plans, approved publishing, duplicate detection, and recovery from uncertain writes and external edits. Accounting use is independent of borrowing.
- Add a provider/product evidence directory and separately gated applications, offers, acceptance, funding, collection, and servicing. No verified SimpleFIN qualification for the exact offered account/obligation means no supported recommendation or opening workflow.
- Specify a later stablecoin pilot with one approved asset/chain and a later permissioned P2P route starting with one qualified external funder. Neither is available by default.
- Add shared policy services, bound human approvals, auditable asynchronous work, quotas, retention policies, and release evidence requirements.

No treasury lending, first-loss reserve, return guarantee, pooled CoinPay funder balances, public retail investment solicitation, invented token, generic provider passthrough, or automatic borrowing authority is included. No database/auth/SDK rewrite or Turso/SQLite/libSQL migration is included.

## Capabilities

### New Capabilities

- `finance-evidence`: Extend the current finance domain with qualification, secure source handling, coverage, exact values, consent, reconciliation, and versioned revenue snapshots.
- `quickbooks-sync`: Connect companies, review typed posting plans, publish approved records, and reconcile accounting independently of financing.
- `lending-programs`: Evaluate program evidence and public availability; support authorized applications, provider offers, funding status, and servicing.
- `lending-remittances`: Assess contract-defined revenue shares with exact rounding, cap reservations, and explicit unknown-sales handling.
- `crypto-p2p-financing`: Gate asset-aware stablecoin settlement and permissioned external-funder workflows, including finality, custody review, allocations, and realized distributions.
- `finance-controls`: Apply shared service authorization, human approvals, explainability, durable events, operational budgets, retention, and release checks.

### Modified Capabilities

None are declared against an existing OpenSpec baseline because this checkout has no baseline specs. The new deltas explicitly extend existing CoinPay source domains; they do not propose parallel finance storage or credentials.

## Impact

Expected implementation surfaces include `src/lib/finances/`, finance API routes and `/finances`, new QuickBooks/lending services and pages, PostgreSQL-compatible migrations through the current data-access boundary, a worker/outbox, and bindings in both CLI entry points and the ESM SDK. Find and verify any existing MCP host before choosing its integration point.

External dependencies remain unapproved until evidenced: Intuit production access and data-use rights, exact SimpleFIN product/account qualification, a capital provider and legal agreements, collection/settlement permissions, and qualified legal/accounting/security review. YouLend remains a research candidate. Live crypto and P2P require additional gates.

The PRD's stage sequence governs release: Stage 0 foundation and sandbox, Stage 1 approved accounting, Stage 2 partner financing, Stage 3 stablecoin pilot, Stage 4 permissioned single-funder then multi-funder P2P. No date, provider cost, credit approval, funding availability, or investment return is promised.
