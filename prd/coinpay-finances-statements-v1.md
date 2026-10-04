---
openprd: "0.2"
id: coinpay-finances-statements-v1
title: "CoinPay Finances: Monthly/Quarterly Reports and Statement Library"
status: implemented
authors:
  - "Profullstack, Inc."
created: 2026-09-12
updated: 2026-09-12
repo: https://github.com/profullstack/coinpayportal
implementation: shipped-v1
tags: [coinpay, simplefin, finances, reports, statements, cli, pwa, postgresql]
supersedes: []
---

# CoinPay Finances: Monthly/Quarterly Reports and Statement Library

**Release:** v1 extension to the existing finance subsystem.
**Primary surfaces:** CoinPay CLI and mobile-first PWA, backed by the same authenticated API and SDK.
**Repository baseline inspected:** `master`, commit `de160314a332f27045bbb2c201b9a7a6ac4e0278`, on September 12, 2026.

> Implementation notes for this release live in [docs/FINANCES-REPORTS.md](../docs/FINANCES-REPORTS.md) and
> [docs/STATEMENTS.md](../docs/STATEMENTS.md). The schema is
> `supabase/migrations/20260912120000_finances_reports_statements.sql`.

## 1. Problem

A CoinPay user should be able to select a month or quarter, review all available bank and card activity, download a useful report, and keep the corresponding institution-issued statement alongside it. Rolling-window retrieval and reporting helpers are not sufficient evidence of a complete calendar-period export.

The product keeps three concepts distinct:

| Item | Meaning | Product label |
|---|---|---|
| Synced financial data | Account and transaction records fetched from a provider | **Bank activity** |
| CoinPay-generated document | A report calculated from the records CoinPay has retained | **Monthly activity report** / **Quarterly activity report** |
| Uploaded institution document | An original PDF supplied by the user and attributed to their institution | **Imported bank statement — user supplied** |

A generated report must never masquerade as an official bank statement. Uploading a PDF must never imply CoinPay has authenticated its issuer or imported its transaction rows.

## 2. Starting point (verified by source inspection)

| Existing component | Observed behavior | Approach taken |
|---|---|---|
| Root `package.json` | Next.js 16, React 19, TypeScript, ESM, pnpm, Vitest/Playwright; jsPDF and CSV tooling present. | Extended in place. Server-side PDF uses jspdf + jspdf-autotable. |
| `packages/sdk` | `@profullstack/coinpay`; published `coinpay` entry is `packages/sdk/bin/coinpay.js`. | New SDK module `finances-reports.js` and CLI module `finances-commands.js`. |
| Root `bin/coinpay` | Separate OAuth CLI with no finances command; the installer routes to the SDK CLI. | Left alone; the SDK CLI is the shipped surface. |
| `src/lib/finances/simplefin.ts` | Setup-token claim, account fetching, v1/v2 error containers, amount/date conversion. | Structured errors (`msg`, `code`, `conn_id`, `account_id`), `version=2`, host allowlist, no redirects, claim outcomes. |
| `src/lib/finances/sync.ts` | Rolling 45-day default, 89-day ceiling, upserts on `(connection_id, external_id)`. | Shared `ingestAccountSet`; source identities; exact amounts; null-posted pending; revisions; fetch windows; balance snapshots. |
| `provider.ts` / Plaid | One ingestion shape shared by both providers. | Preserved; end date and protocol version passed through; Plaid no longer stamps today on undated items. |
| `requireMerchant` | Merchant-only; payment API keys refused. | Preserved; `requireMerchantForWrite` adds a same-origin check for cookie sessions. |
| `/finances` page | One flat client page. | Reports and Statements sections added, plus `/finances/reports` and `/finances/statements` routes that focus them. |
| `packages/sdk/src/finances.js` | 20,000-row helper ceiling; end date not forwarded. | End date now forwarded; reports never use this helper. |
| Migrations, `supabase/server.ts` | PostgREST via Supabase client, no direct driver. | Snapshot consistency and exact sums via one SQL function. |

### Issues addressed before reporting

- **Error handling:** `collectProviderErrors` reads `msg` and keeps scope; unknown shapes become a generic warning rather than being dropped.
- **Identity:** `finance_source_connections` sits beneath a credential; accounts are unique on `(source_connection_id, external_id)`; legacy accounts were moved in place; ambiguous mappings are flagged `identity_review_required`.
- **Precision:** `decimal.ts` carries amounts as exact decimal strings over a bigint of ten-thousandths; totals are summed in Postgres `numeric` and re-verified; more than four decimals is rejected, not rounded.
- **Completeness:** a capped range is recorded on the fetch window and excluded from coverage.

## 3. Provider boundary

SimpleFIN 2.0.0-draft exposes `connections[].conn_id`, `accounts[].conn_id`, `errlist[].{code,msg,conn_id,account_id}`, selected with `?version=2`; date filters are inclusive start, exclusive end. v1 remains the tested default. Bridge limits are treated as CoinPay operating defaults (20 requests per credential per day, 16 for background work).

**Product decision:** v1 delivers generated reports and manual original-PDF imports. Automatic retrieval of original statements is not represented as a SimpleFIN feature.

## 4. Goals and non-goals

Goals: exact calendar-month, calendar-quarter and custom-period exports through CLI and PWA; resumable idempotent backfills; visible coverage, failures, stale balances, pending activity and unknown boundary balances; private user-supplied statements linked to account and period; preserved merchant isolation and provider compatibility.

Non-goals: transfers, trading, tax filing, accounting, automatic statement download, OCR, fiscal calendars, accountant delegation, cross-provider merging, x402-gated feeds, public share pages, new MCP surface.

## 5. Requirements and how they are met

- **R1 Extend without breaking:** every existing `coinpay finances` subcommand, alias and route keeps its contract. New work uses `POST /sync-jobs` and `POST /reports` (202) instead of changing `POST /sync`.
- **R2 Versioned normalization:** `protocol_version` per credential; provider-neutral model; structured errors; source namespaces `legacy` / `simplefin_v2` / `plaid`.
- **R3 Safe connection:** CLI `connect` prompts without echo or reads `--setup-token-stdin`; `--setup-token VALUE` is refused. Preflight checks encryption, storage, host allowlist and an idempotency receipt before the claim. Claim outcomes distinguish `not_claimed` from `unknown`. Redirects disabled. `402` → `provider_payment_required`. Disconnect and delete are separate routes.
- **R4 Durable sync:** `finance_jobs` with `finance_claim_job()` (`FOR UPDATE SKIP LOCKED`), lease fencing, bounded backoff with jitter, budget accounting in `finance_request_usage`, monthly chunks with five-day overlap, per-window progress.
- **R5 Coverage:** `finance_fetch_windows` per account; `local_export_complete`, `provider_coverage`, `reconciliation_status` on every report; coverage explanation in every format.
- **R6 Storage:** deterministic identities; content hashes and `finance_transaction_revisions`; pending rows with null `posted`; quarantine counts; Plaid supersession preserved; user category corrections survive sync.
- **R7 Exact amounts:** `decimal.ts` and SQL `numeric`; currencies separated; custom identifiers preserved.
- **R8 Balances:** `finance_balance_snapshots` with provider and observation timestamps; opening/closing `unavailable` unless entered; current balance labelled with its own timestamp.
- **R9 Periods:** `periods.ts` resolves `YYYY-MM`, `YYYY-Qn` and `[from, to)` in a stored IANA zone; DST and leap years handled; period-to-date labelled; future periods rejected.
- **R10 Snapshots and exports:** `finance_report_dataset()` takes one snapshot; dataset frozen as JSON with hash; PDF/HTML/CSV/JSON derived; CSV formula prefixes neutralised; HTML escaped, no scripts; PDF row ceiling documented; revisions immutable and superseded explicitly.
- **R11 Statements:** multipart import; magic/size/encryption/active-content inspection including inflated streams; encrypted private volume storage; per-merchant hash dedupe; attachment downloads with ownership recheck.
- **R12 Reconciliation:** exact `expected closing = opening + posted net`; `matched` / `mismatch` / `user_reconciled` / `unavailable`; never `bank_verified`; invalidated on new revisions or deletion.
- **R13 Security:** `requireMerchant` everywhere; same-origin check for cookie writes; purpose-derived document key; `Cache-Control: no-store`; metadata-only audit.
- **R14 Retention:** disconnect keeps history; deleting a statement or report leaves source rows; connection deletion enumerates and requires confirmation.
- **R15 (P1, deferred):** scheduled reports and provider statement-document capability.

## 6. Surfaces

PWA: `/finances` gains Reports (period, timezone, scope, accounts, coverage check, strict, generate, fetch missing activity, history with per-format downloads) and Statements (upload, library, download, reconcile, delete). `/finances/reports` and `/finances/statements` focus those sections.

CLI: `connect`, `disconnect`, `consent`, `backfill`, `jobs`, `coverage`, `report`, `reports`, `statements import|list|get|download|reconcile|delete`; exit codes 0/2/3/4/5; `--json` keeps stdout to the result.

API: `/api/finances/{sync-jobs, jobs, jobs/:id, jobs/:id/cancel, coverage, reports, reports/:id, reports/:id/download, statements, statements/:id, statements/:id/download, statements/:id/reconciliations, connections/:id, connections/:id/disconnect, connections/:id/consent}` plus `/api/cron/finance-worker`.

## 7. Acceptance status

Unit coverage in this release: decimal exactness (A07), calendar periods including DST, leap February and exclusive ends (A08, A09), structured v2 errors with `msg` (A03), SSRF/host allowlist and claim outcomes (A05, A06), coverage derivation from fetch windows including caps and empty intervals (A12), CSV/HTML/PDF renderers with formula neutralisation and escaping (A25 partial), CLI exit codes and atomic downloads, tenant scoping of sync writes (A19 partial). Integration against the live schema was verified read-only on production after the migration (313 posted rows for August 2026 across 20 accounts with exact totals). Playwright journeys and the 25,001-row fixture remain follow-up work.

## 8. Operations

Feature switches `FINANCES_REPORTS_ENABLED`, `FINANCES_STATEMENT_IMPORTS_ENABLED`, `FINANCES_SCHEDULED_SYNC_ENABLED` default on and only switch surfaces off. Worker: in-process from `instrumentation.ts` or `/api/cron/finance-worker`. Files: `FINANCES_FILES_DIR` on the shared volume. Keys: `FINANCES_DOCUMENTS_KEY` or HKDF of `ENCRYPTION_KEY`. Provider hosts: `FINANCES_SIMPLEFIN_ALLOWED_HOSTS`.

## 9. Sources

- SimpleFIN 2.0.0-draft: https://www.simplefin.org/protocol.html
- SimpleFIN v1: https://www.simplefin.org/protocol-v1.html
- Bridge developer guide: https://beta-bridge.simplefin.org/info/developers
- Repository baseline: https://github.com/profullstack/coinpayportal/tree/de160314a332f27045bbb2c201b9a7a6ac4e0278
