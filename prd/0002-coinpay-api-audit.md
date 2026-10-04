---
openprd: "0.3"
id: "0002"
title: Integrate OpenAPI contract auditing into CoinPay
status: Draft
authors:
  - anthony@profullstack.com
owner: anthony@profullstack.com
repo: profullstack/coinpayportal
created: "2026-09-12"
updated: "2026-09-14"
discussion: null
implementation: null
tags: [coinpay, openapi, api-audit, x402, cli, mcp, github, pwa]
supersedes: null
superseded-by: null
---

# CoinPay API Audit — Product Requirements v1

**Decision:** Adapt the MIT-licensed Contract Lens comparison engine into CoinPay. Keep local execution free and open source; provide optional CoinPay-billed hosted execution. Reuse CoinPay's application, identity, SDK, payment integrations, and GitHub integration rather than deploying a second standalone product.

**Target file:** `prd/0002-coinpay-api-audit.md`. On import on September 14, 2026, `0001` was already used by the CoinPay Lending + QuickBooks Accounting Sync proposal, so this PRD was allocated the next sequential ID. The original proposal requested `0001` with renumbering when occupied.

**Implementation status:** Specification only. Repository files were inspected, but no code was changed, no audit test suite was executed, and no production payment was made. Names, paths, schemas, quotas, and prices described as proposed below are requirements, not claims that these features already exist.

**Import inventory:** The September 14, 2026 G0 inspection, pinned upstream commit, current integration map, baseline differences, and validation evidence are recorded in [docs/api-audit-g0.md](../docs/api-audit-g0.md). This proposal remains Draft; the inventory does not mark feature requirements complete.

## Problem

CoinPay should give developers and AI agents a useful service they can run locally or purchase through CoinPay: comparing two API definitions before an application change breaks its consumers. A developer should be able to inspect a change from the terminal, an agent should receive structured findings, and a reviewer should see those findings on a pull request.

The external project **Contract Lens Nano** provides an appropriately small starting point. Its `lib/audit.ts` compares OpenAPI documents without an LLM dependency. However, its hosted billing implementation uses Nano-specific invoices, a receiving-address pool, and Cloudflare D1. Its README explicitly distinguishes its custom HTTP 402 invoice protocol from standard x402 interoperability. Importing the entire application would duplicate CoinPay infrastructure and introduce the wrong payment and persistence architecture. [S1–S4]

The product must also avoid implying more assurance than the engine provides. This is an **API definition change review**, not a legal-contract reviewer, blockchain smart-contract auditor, runtime penetration test, or proof that two API implementations are compatible.

### Inspected baseline

| Evidence | Observed fact | Integration consequence |
|---|---|---|
| Upstream `LICENSE` | MIT; copyright 2026 Roman Vinogradov. | Preserve the complete notice with copied code and distributed artifacts. [S2] |
| Upstream `lib/audit.ts` | Standalone TypeScript comparison logic, local-reference handling, bounded traversal, and three finding levels. | Extract and test the engine, not the whole hosting application. [S3] |
| Upstream README and service | Custom Nano billing, D1, and retries recomputed using the currently deployed engine. | Replace billing/storage; make report versions and replay behavior explicit. [S1, S4] |
| CoinPay `package.json` | Next.js/React, ESM, pnpm, Vitest, Playwright, `@profullstack/coinpay`, `@profullstack/stack`, `@profullstack/throttle`, and `@profullstack/x402-gateway`. | Extend the existing project and verify actual package exports before writing adapters. [S5] |
| CoinPay SDK | `packages/sdk/src/x402-v2.js` provides v2-related structures shared with payment components. | Reuse and integration-test these capabilities; source presence does not prove deployed interoperability. [S6] |

The existing manifest still includes Supabase dependencies. That does not override the project owner's current requirement to use **self-hosted PostgreSQL for new backend persistence**. This feature must not silently migrate the rest of CoinPay or replace its authentication system.

## Goals

1. Produce deterministic, actionable structural-change reports with honest coverage limitations.
2. Make one engine available through CLI, SDK, HTTP API, MCP, mobile-first PWA, desktop-installed PWA, and the CoinPay GitHub workflow.
3. Offer a genuinely useful free local tool, without account creation, network access, wallet setup, or AI-provider charges.
4. Demonstrate interoperable agent purchases through CoinPay's verified x402 v2 path and offer account-based service-call credits for repeated hosted use.
5. Prevent duplicate monetary settlement and duplicate credit consumption during concurrent requests, timeouts, retries, and process crashes.
6. Protect private API definitions, credentials, and repository data throughout parsing, billing, reporting, logging, and GitHub publication.
7. Integrate incrementally without breaking existing invoices, payment methods, wallets, escrow, GitHub commands, or SimpleFIN-related work.

## Non-Goals

No legal-contract analysis, smart-contract security review, live endpoint probing, exploit generation, automatic code changes, automatic merging, or claims of complete OpenAPI validation.

No Nano wallet support, Nano receiving-address pool, D1, Turso, SQLite production database, replacement authentication system, new bank-account opening, or new custodial wallet. Existing payment rails remain intact; this project does not make every rail x402-compatible.

No LLM in the required execution path. No paid upstream Contract Lens API dependency. No automatic retrieval of URLs, remote `$ref` documents, or arbitrary repository build commands.

No universal OpenAPI/JSON Schema semantic compatibility solver. Launch support is explicitly limited to OpenAPI **3.0.x and 3.1.x**; other versions are rejected, not silently treated as equivalent.

No separate native desktop application or app-store mobile release in v1. Desktop is served by the CLI and installable PWA. No general-purpose paid-tools marketplace in this release.

## Users

| User | Main job | Primary surface |
|---|---|---|
| API developer | Compare a proposed definition with the released definition before deployment. | Local CLI and SDK |
| Maintainer or reviewer | Understand a PR's API impact without interpreting a large raw diff. | GitHub report/check |
| Agent using moshcode, Chovy, or another runtime | Obtain structured findings and optionally purchase a hosted run within an approved budget. | MCP, CLI, HTTP API |
| CoinPay customer | Upload two definitions, review changes, and share results with authorized teammates. | Mobile-first PWA and desktop PWA |
| CoinPay operator | Operate a small paid service and reconcile settlements, credits, usage, and delivery. | Existing administration and observability tools |

## Requirements

### Priority and release rules

P0 requirements block the v1 public release. P1 requirements are follow-up enhancements and must not be presented as shipped until completed. P2 requirements are intentionally deferred. All IDs are stable and should be referenced in implementation tasks and tests.

- R1 [P0] Import the comparison engine with verifiable provenance and complete upstream license attribution.
- R2 [P0] Provide one deterministic, payment-independent, network-independent audit engine shared across all interfaces.
- R3 [P0] Implement the supported comparison rules and expose incomplete coverage rather than implying compatibility.
- R4 [P0] Bound parsing, reference expansion, report size, execution time, and concurrent work before accepting payment.
- R5 [P0] Publish a versioned report schema with stable rule identifiers, machine-readable locations, and policy outcomes.
- R6 [P0] Provide free local CLI execution and a documented JavaScript/TypeScript SDK export.
- R7 [P0] Provide the hosted API, price/capability discovery, report retrieval, and consistent error responses.
- R8 [P0] Add an accessible, mobile-first audit interface within CoinPay and support desktop installation through the PWA.
- R9 [P0] Expose audit execution and report retrieval through MCP with explicit remote-execution and spending permissions.
- R10 [P0] Extend the CoinPay GitHub integration with authorized `/coinpay audit` PR reports and a safe local CI path.
- R11 [P0] Reuse CoinPay authentication, tenant boundaries, permissions, and secret-management conventions.
- R12 [P0] Support hosted pay-per-run execution through a verified standard x402 v2 adapter, not the upstream Nano invoice protocol.
- R13 [P0] Support account-scoped hosted service-call credits using a transactional PostgreSQL entitlement ledger.
- R14 [P0] Make execution, settlement association, credit accounting, and result delivery retry-safe under concurrency and crashes.
- R15 [P0] Pin report generation versions and disclose retention, replay, deletion, and expired-result behavior.
- R16 [P0] Keep definitions out of persistent storage and logs by default, and encrypt temporarily retained hosted reports.
- R17 [P0] Apply abuse controls and treat document content, rendered findings, repository inputs, and agent prompts as untrusted.
- R18 [P0] Add operational metrics, reconciliation, audit records, and feature flags without collecting document content.
- R19 [P0] Ship fixtures, security tests, payment integration tests, cross-surface parity tests, and recovery tests.
- R20 [P0] Document installation, limits, pricing, supported versions, privacy, examples, and the implementation/release checklist.
- R21 [P1] Accept safely parsed YAML through local/PWA adapters and preserve source locations where reliable.
- R22 [P1] Add SARIF export and opt-in repository merge-blocking policies after report-only validation.
- R23 [P1] Add opt-in extended report history and explicit repository policy suppression with owner/reason/expiry.
- R24 [P1] Add supported semantic rules incrementally, with separate request/response reasoning and dedicated fixtures.
- R25 [P2] Generalize proven hosted entitlement and receipt adapters for other paid developer tools without turning this release into a marketplace.

### Engine import and provenance — R1–R3

Create a proposed workspace package, **`@profullstack/openapi-audit`**, in `packages/openapi-audit/`. It must work without a CoinPay account or service. Publishing the package is a release task, not an assumption that it already exists on npm.

Copy the necessary engine code and relevant test fixtures only. Preserve the upstream MIT license in the package and applicable notice files; document the source repository, imported commit, imported paths, and downstream changes. Pin the actual upstream commit before importing. The engine blob inspected for this PRD was `cc0373067fd73ee108515d8ba7b2a327b183a917`; a blob SHA identifies file content, not a repository commit. [S3]

Do **not** copy upstream `receiving-pool.json`, operator payment destinations, production configuration, hosting identities, database bindings, or payment routes. Replace, rather than rename, Nano billing code. The upstream pool is associated with its original operator. [S1, S4]

Expose a pure engine function conceptually equivalent to:

```ts
export function auditOpenApi(
  input: AuditInput,
  options?: EngineOptions,
): AuditReport;
```

The engine must not access the network, filesystem, database, process environment, wallet, clock, random number generator, or model provider. Adapters perform input/output. Avoid mutating the caller's documents. A worker may enforce limits around the pure function.

For the same documents, options, and pinned version bundle, produce the same report data and ordering. Timestamps, request IDs, receipt data, and delivery status belong to the service envelope, not the deterministic report. The CLI and server must use the same rule implementation.

### Supported rules and honest coverage — R3–R5

The initial fork should maintain the upstream engine's conservative scope, with the following stable rule IDs added by CoinPay. Findings may be more precise than upstream but must not overstate semantic assurance.

| Rule ID | Trigger | Default level |
|---|---|---|
| `operation.removed` | A resolved, previously documented method/path disappears. | `breaking` |
| `input.required_added` | A supported parameter is newly required or becomes mandatory. | `breaking` |
| `request_body.required_added` | A supported request body becomes mandatory. | `breaking` |
| `operation.added` | A method/path is added. | `added` |
| `input.optional_added` | An optional parameter is added. | `added` |
| `response.status_added` | A response status is added. | `added` |
| `operation.id_changed` | An operation identifier changes. | `review` |
| `input.changed` | An existing parameter's structural contract changes. | `review` |
| `input.removed` | A previously declared parameter is removed. | `review` |
| `request_body.changed` | A request-body contract changes. | `review` |
| `response.changed` | A response's structural contract changes. | `review` |
| `response.status_removed` | A response status disappears. | `review` |
| `security.requirements_changed` | Effective operation/root security declarations change. | `review` |
| `security.scheme_changed` | Security-scheme definitions change. | `review` |
| `servers.changed` | Effective operation/path/root server declarations change. | `review` |

Request and response schema changes must remain contextual review findings until an individually tested semantic rule exists. Do not assume that narrowing a request schema and narrowing a response schema have the same compatibility effect.

Resolve supported same-document references with bounded traversal. Respect inherited parameters and operation overrides. Differences in OpenAPI 3.0/3.1 reference semantics must be handled deliberately or disclosed as incomplete coverage. No remote retrieval is allowed. Reference cycles, unresolved paths, or expansion limits must never produce a falsely reassuring clean result. [S3, S9]

Mandatory regression cases include property names such as `description`, `summary`, `title`, and `example`; these must not disappear merely because the same words are documentation keywords elsewhere. Reordered object keys must not create findings. Preserve array ordering unless the specific construct is explicitly treated as unordered and covered by tests. Literal values inside `default`, `const`, and `enum` require appropriate normalization, not blanket documentation stripping.

**Launch exclusions:** callbacks, OpenAPI webhooks, runtime behavior, and unreferenced components other than the explicitly compared security-scheme definitions. List exclusions in every report. Distinguish these published scope exclusions from an unexpectedly unresolved or skipped part of an otherwise supported comparison.

Coverage is `complete_within_scope` or `partial`; it is never named simply `complete`. Track unresolved references, skipped locations, bounded expansions, and exclusions separately. When an unresolved path prevents knowing which operations exist, do not report inferred removals as certain breaking changes; mark the affected area incomplete.

The user-facing zero-findings sentence is: **“No structural changes detected within the supported comparison scope.”** Never say “safe to deploy” or “fully backward compatible.”

### Limits and input contract — R4, R17

P0 input is JSON, supplied as objects in the HTTP envelope or files to the CLI/PWA. Both documents must declare a supported OpenAPI version and contain a usable `paths` object. Validate the supported subset; do not label this a full OpenAPI validator.

| Limit | Proposed launch default | Behavior |
|---|---:|---|
| Entire decoded HTTP request | 128 KiB | Stream-limit and reject before creating an entitlement or challenge. |
| Operations per document | 200 | Reject over-limit input. |
| Structural nodes per document | 20,000 | Reject over-limit input. |
| Structural nesting depth | 40 | Reject over-limit input. |
| Total reference-expansion visits per comparison | 100,000 | Stop with an input-complexity error before billing. |
| Reference-normalization depth | 18 | Disclose bounded comparison and partial coverage. |
| Findings per report | 1,000 | Reject excessive differences; never silently truncate. |
| Serialized report | 512 KiB | Reject excessive output before billing. |
| CPU/wall-clock worker budget | 3 seconds per comparison | Terminate isolated worker; no new charge. |
| Unpaid quote lifetime | 15 minutes | Declared in quote; do not request payment after expiry. |

These are proposed product limits; only some match upstream values. They must be configurable downward for incident response and benchmarked before any increase.

Use a parser that rejects duplicate object keys, invalid encodings, unsupported numeric representations that would lose meaningful precision, and malformed JSON. Do not coerce enum values or silently change numeric types. HTTP content encodings must either be rejected explicitly in v1 or bounded before and after decompression; never rely only on `Content-Length`.

P1 YAML parsing must reject duplicate keys, unsafe tags, and excessive aliases; convert to the same supported data model before audit execution. Never fetch files or URLs referenced by YAML. JSON remains available even when YAML support is absent.

### Versioned report contract — R5, R15

Publish a JSON Schema and TypeScript types for this conceptual shape:

```ts
interface AuditInput {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  options?: {
    policy?: "report-only" | "fail-on-breaking" | "fail-on-review";
    failOnIncomplete?: boolean;
  };
}

type FindingLevel = "breaking" | "review" | "added";

interface AuditReport {
  schemaVersion: "1.0.0";
  tool: "coinpay-openapi-audit";
  engineVersion: string;
  rulesetVersion: string;
  normalizationVersion: string;
  operations: { before: number; after: number };
  counts: Record<FindingLevel, number>;
  findings: Array<{
    id: string;
    ruleId: string;
    level: FindingLevel;
    operation: string | null;
    beforePointer: string | null;
    afterPointer: string | null;
    message: string;
  }>;
  coverage: {
    status: "complete_within_scope" | "partial";
    exclusions: string[];
    limitations: Array<{ code: string; pointer: string | null; message: string }>;
  };
  policy: {
    name: "report-only" | "fail-on-breaking" | "fail-on-review";
    failOnIncomplete: boolean;
    outcome: "pass" | "fail" | "inconclusive";
  };
  interpretation: string;
}
```

Finding IDs must derive from stable, non-secret rule/location identifiers, not timestamps. Sort output consistently. Use JSON Pointers, including correct escaping of `/` and `~`. Source line numbers are optional adapter metadata; never invent them when only parsed JSON is available.

`report-only` findings do not fail the chosen policy, but partial coverage still yields `inconclusive` unless `failOnIncomplete` makes it `fail`. A detected policy violation yields `fail` even when coverage is also partial. A `pass` means only that this configured policy found no violation in the supported scope. The service must not convert an inconclusive audit into a successful CI assurance check.

The hosted envelope adds `auditId`, pinned request-body SHA-256, timestamps, billing mode/status, receipt reference, report expiry, and the report. Raw payment signatures and bearer tokens never appear in the result.

### CLI and SDK — R6

Proposed commands, to be added to the existing `coinpay` dispatcher:

```sh
# Default: local execution, no sign-in, no network, no charge.
coinpay audit openapi before.json after.json
coinpay audit openapi before.json after.json --format json
coinpay audit openapi before.json after.json --format markdown --output audit.md

# CI policy; --local makes the no-network requirement explicit.
coinpay audit openapi before.json after.json \
  --local --fail-on breaking --fail-on-incomplete

# Hosted execution is opt-in; credentials come from existing CoinPay auth.
coinpay audit openapi before.json after.json \
  --remote --billing credits --max-calls 1 --idempotency-key "$AUDIT_RUN_KEY"

# x402 requires explicit per-run spend authority and a supported local signer.
coinpay audit openapi before.json after.json \
  --remote --billing x402 --max-cost-usd 0.01 --approve-payment

coinpay audit price --format json
coinpay audit report AUDIT_ID --format markdown
```

Publish exact flag names and examples in CLI help once implemented. The examples above are proposed syntax, not current commands. `AUDIT_RUN_KEY` must be a previously generated stable identifier for that logical request.

Support `--format text|json|markdown`, optional `--output`, and a documented exit-code contract. Emit only the selected result to stdout; progress and diagnostics go to stderr. Never request sign-in for local mode. `--remote` must not be inferred from missing files or a local error.

| Exit code | Meaning |
|---:|---|
| 0 | Report generated and selected policy passed. |
| 1 | Findings violated selected policy. |
| 2 | Invalid input, unsupported input version, or invalid usage. |
| 3 | Coverage is inconclusive and no definite policy failure takes precedence. |
| 4 | Authentication, authorization, credit, or payment approval is required/denied. |
| 5 | Temporary service, infrastructure, or settlement reconciliation condition. |

The existing `@profullstack/coinpay` SDK should expose hosted convenience methods that call the published API. The standalone engine package remains independent. Verify the SDK's actual export map and conventions before adding names such as `client.audits.run()`; do not import imaginary existing functions.

### Hosted API and error model — R7, R12–R15

Proposed route family:

| Method and route | Purpose |
|---|---|
| `GET /api/v1/tools/openapi-audit/capabilities` | Supported versions, formats, ruleset, limits, available billing modes, and coverage scope. |
| `GET /api/v1/tools/openapi-audit/price` | Current service pricing, credit unit, quote TTL, and actually enabled payment choices. |
| `POST /api/v1/tools/openapi-audit` | Authenticated account execution using free allocation or service-call credits. |
| `POST /api/v1/tools/openapi-audit/quotes` | Prepare a bounded, validated, request-specific hosted x402 quote; not a charge. |
| `POST /api/v1/tools/openapi-audit/quotes/{quoteId}/execute` | x402-protected execution/delivery for that quote and exact original request bytes. |
| `GET /api/v1/tools/openapi-audit/reports/{auditId}` | Authorized retrieval during the disclosed retention window; no new charge. |
| `DELETE /api/v1/tools/openapi-audit/reports/{auditId}` | Remove retained report content; preserve required financial/idempotency records. |
| `GET /api/v1/tools/openapi-audit/credits` | Account-scoped service-call balance and reserved/available amounts. |

Use `Authorization` with existing account credentials on account routes. An `Idempotency-Key` is required for hosted billable mutations and must remain stable through retries. Recommended accepted key syntax is 16–128 URL-safe characters. Bind the key to authenticated principal or an unguessable quote capability, product, request hash, and immutable version bundle.

A successful account run returns `200`. A prepared quote returns `201`, an audit/quote identifier, exact-body hash, selected version bundle, cost, expiry, execution URL, and secret quote capability when there is no authenticated account. Return the secret once, store only a secure hash, and exclude it from URLs, logs, and analytics.

The x402 client first prepares a quote, then calls the quoted execution URL through a standard x402-capable request wrapper. That wrapper can retry the **same execution URL** with the original request bytes. This is a documented two-step product API, not a claim that an arbitrary one-step client will discover the preparation flow automatically.

Example account payload:

```json
{
  "before": {
    "openapi": "3.1.0",
    "info": {"title": "Example", "version": "1.0.0"},
    "paths": {"/items": {"get": {"responses": {"200": {"description": "OK"}}}}}
  },
  "after": {
    "openapi": "3.1.0",
    "info": {"title": "Example", "version": "1.1.0"},
    "paths": {}
  },
  "options": {"policy": "fail-on-breaking", "failOnIncomplete": true}
}
```

Its required finding is `operation.removed` for `GET /items`; the report's policy outcome is `fail`. This is an acceptance fixture, not a captured production response.

Use a common error object with `code`, non-sensitive `message`, `requestId`, `retryable`, optional `retryAfter`, and optional `auditId`. Include billing state where known so callers do not assume an error means payment failed.

| HTTP status | Typical code | Billing behavior |
|---:|---|---|
| 400 | `INVALID_JSON`, `INVALID_REQUEST` | No charge. |
| 401 / 403 | `AUTH_REQUIRED`, `FORBIDDEN` | No new charge. |
| 402 | `PAYMENT_REQUIRED` on x402 execution; `CREDITS_REQUIRED` on account execution | Distinguish standard x402 challenge from account-credit requirements. |
| 409 | `IDEMPOTENCY_CONFLICT`, `REQUEST_HASH_MISMATCH`, `PAYMENT_ALREADY_BOUND` | Reject reuse; do not create a second settlement. |
| 410 | `QUOTE_EXPIRED`, `RESULT_EXPIRED`, `RESULT_DELETED` | Never silently charge again. |
| 413 | `INPUT_TOO_LARGE`, `REPORT_TOO_LARGE` | No new charge. |
| 415 | `UNSUPPORTED_MEDIA_TYPE`, `UNSUPPORTED_CONTENT_ENCODING` | No charge. |
| 422 | `UNSUPPORTED_OPENAPI_VERSION`, `INPUT_LIMIT_EXCEEDED` | No charge. |
| 429 | `RATE_LIMITED`, `CAPACITY_UNAVAILABLE` | No new quote/payment demand while capacity is unavailable. |
| 503 | `SETTLEMENT_UNKNOWN`, `TEMPORARILY_UNAVAILABLE` | Preserve state; reconcile the existing attempt before retrying monetary actions. |

Hash the exact raw request body for billing/replay binding. Reformatting JSON may leave audit semantics unchanged but is a different billable request body; explain the distinction. The SDK must serialize once and reuse those bytes. A retry must also preserve billing mode, report policy, and version selection. Do not expose raw request hashes in public analytics.

### Standard x402 integration — R12, R14

Reuse `@profullstack/x402-gateway` and the current CoinPay SDK/facilitator code after inspecting their actual APIs. Do not implement a new signature format in the audit package. Verify standard v2 challenge, signature, and settlement headers: `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, and `PAYMENT-RESPONSE`. Use the accepted v2 network identifiers and token metadata from the verified payment adapter. [S5–S8]

Start with the subset of CoinPay's deployed routes that passes end-to-end tests. USDC on Base is an initial candidate reflected in the inspected SDK, not an unconditional statement that it is production-ready. Expose enabled choices from configuration and successful capability checks. Native-asset checkout, Lightning, Stripe, and other existing CoinPay payment methods may fund hosted entitlements through their normal supported flows; do not advertise them as standard `exact` x402 choices without the required scheme support. [S6]

A quote binds product, account/capability, exact body hash, version bundle, price, network, asset, recipient, and expiry. An execution attempt must verify all applicable payment fields and bind the unique payment authorization/settlement identity to that quote **before any externally visible monetary side effect**.

An x402 token authorization does not automatically sign an arbitrary document body or URL. Request binding is enforced by the authenticated/capability-protected quote record and atomic server-side payment association. Do not claim cryptographic body binding unless the chosen scheme actually provides and verifies it. A quote-specific URL alone is insufficient.

Separate signature verification from confirmed monetary settlement. A valid signature, submitted transaction hash, callback, or quote creation is not by itself proof that a paid report can be released. Keep the prepared report withheld until the adapter's required settlement success is recorded. Settlement ambiguity returns a recoverable state and triggers reconciliation; it must never trigger a second automatic payment.

Where the existing gateway cannot meet these guarantees, repair the reusable gateway/SDK layer and test it there. Keep the audit engine unaware of these changes. Disable the x402 mode rather than silently using the upstream invoice protocol.

### Credits, quotas, and retry-safe accounting — R13–R14

Credits represent **non-transferable calls to this hosted service**, not deposited cryptocurrency, withdrawable balances, or a general wallet. Reuse an existing suitable entitlement ledger; otherwise add the smallest product-scoped PostgreSQL ledger. Top-ups go through CoinPay's established checkout/payment confirmation path.

One successful new hosted comparison consumes one call. Invalid input, infrastructure failure before a result is prepared, and rejected authorization consume none. Every successful replay of an already accepted request is free within its retrieval window. A network interruption after finalization does not create another debit.

Use PostgreSQL transactions, unique constraints, conditional updates, and persisted recovery state. A read-then-decrement sequence without locking is not sufficient. Free monthly allocation needs the same race-safe accounting as paid credits; use an explicitly documented UTC month boundary.

Credit execution sequence:

1. Authenticate, rate-limit, cheaply validate input, and resolve an existing idempotent request before reserving anything new.
2. Insert the uniquely scoped request and reserve one available free call or paid credit atomically. On a same-key conflict, verify request/version identity and resume the existing operation.
3. Compute within bounded isolation. Prepare the immutable report and encrypt it for the disclosed retrieval period.
4. In one PostgreSQL transaction, persist the ready report/reference, capture the credit reservation, and mark the request deliverable. Failure before this transaction completes must not produce a net debit.
5. Serve the result. Later response interruptions do not undo delivery eligibility. Release abandoned, definitely unfinalized reservations through a leased recovery worker.

For x402, the blockchain/provider and PostgreSQL cannot participate in one ordinary database transaction. Persist an execution/settlement intent before sending or settling; associate each authorization and settlement exactly once; keep the report recoverable; reconcile uncertain outcomes from the original identifiers. Never hold a database transaction open while waiting on a remote provider.

Suggested separate states:

```text
Report:   prepared -> deliverable -> expired | deleted
Request:  created -> running -> succeeded | failed_retryable | failed_final
Credit:   none -> reserved -> captured | released
Payment:  none -> required -> settling -> settled | failed | unknown
```

Track legal transitions and ownership leases. `unknown` cannot be treated as `failed` merely because a timeout occurred. For terminal failures after money was actually received, record a compensation obligation and use an approved CoinPay refund or service-credit remedy; never describe a database rollback as reversing an on-chain transfer. A recovery worker must be idempotent too.

### Privacy, retention, and version pinning — R15–R17

Local mode sends nothing to CoinPay. Hosted mode necessarily receives definitions for computation, but must not intentionally persist the raw definitions. Disable request-body logging, tracing payload capture, analytics/session replay on input/report content, proxy payload dumps, and exception messages that embed documents. Report findings can themselves reveal private routes or schema names and must be treated as sensitive.

Use this proposed default policy:

| Data | Default behavior |
|---|---|
| Local definitions and local results | User-controlled files; no network or telemetry requirement. |
| Hosted raw definitions | Process memory only for the request; not stored in the database, cache, logs, or backups. |
| Unpaid prepared report | Encrypted, inaccessible to the purchaser until entitled, and purged after the 15-minute quote window. |
| Paid/free-account hosted report | Encrypted and retrievable for 24 hours after successful execution/settlement. |
| Extended report history | P1, explicit account opt-in; proposed 30 days. |
| Idempotency tombstones and hashed request bindings | At least 90 days; prevent silent reuse/rebilling during that window. |
| Accounting and settlement records | Governed by CoinPay's existing approved financial-retention policy, not erased by deleting a report. |

The original quote fixes the engine, ruleset, normalization, report schema, price, and options. Store the exact generated report; retries return that report instead of recomputing with a newer engine. Thus the retrieval promise is an explicitly bounded cache of an immutable result, not unlimited recomputation.

Before accepting money, ensure the prepared report is durably recoverable. Retention for a settling/unknown payment must be extended until reconciliation completes; a cleanup job may not delete a report needed to fulfill money already received. Bound unresolved-state storage through incident handling, not by silently discarding obligations.

After content expires, return `410 RESULT_EXPIRED` for the existing idempotency key without charging again. Recomputing after expiry requires a new explicit request and newly approved entitlement. Immediate deletion similarly ends retrieval without silently creating a replacement job. Publish these rules before purchase.

Report encryption must use authenticated encryption and managed/rotatable server secrets, with tenant identity bound as authenticated context. The application decrypts only after authorization. Default reports should be excluded from long-lived backups or use an enforceable key-lifecycle design; document actual backup purge delays. Do not promise instantaneous physical erasure from every storage layer.

Service-worker caches must exclude authenticated results, payment responses, input documents, and credentials. An offline PWA may run the local engine in a Web Worker once its code is cached, but must not queue paid mutations for later without renewed explicit approval.

### PWA, mobile, and desktop — R8

Add `/dashboard/tools/api-audit` and a public informational entry at `/tools/api-audit`, using CoinPay's navigation, identity, permissions, and theme. The informational page may offer local browser execution without sign-in; paid/hosted actions must be visibly separate.

Provide before/after paste and file inputs, bounded sample fixtures, a version/limits disclosure, and a clear Local versus Hosted control. Default to Local when supported. Show selected policy, comparison status, level counts, individual findings, JSON Pointer locations, and a separate coverage/limitations panel.

Hosted users must see exact quoted cost, funding source, retention deadline, and purchase confirmation before spending. During settlement uncertainty, display “Payment status is being checked; do not pay again,” using the known request identifier. Never convert a retry button into a new charge without explicit consent.

Support JSON and Markdown export, keyboard navigation, screen-reader labels, visible focus, text labels in addition to severity colors, dark/light themes, and responsive layouts down to 360 CSS pixels. Desktop layouts can show side-by-side documents; mobile layouts should use Before/After/Report tabs. Do not require a native wrapper.

### MCP and agent permissions — R9, R11

Register tools in CoinPay's existing MCP transport where available. If no such surface exists in the checked-out repository, implement one thin adapter around the same service/engine; do not invent a second authentication or payment subsystem.

Proposed tools:

```text
coinpay_audit_openapi
coinpay_get_audit_report
coinpay_get_audit_capabilities
coinpay_get_audit_price
```

A locally hosted MCP adapter may execute the pure engine for free. A remote MCP server cannot access the caller's filesystem; accept documents or explicitly authorized artifact references, not arbitrary client-local paths. The default audit tool must not silently send documents to a hosted service or spend funds.

A hosted invocation requires an existing account/session or protected quote capability plus an approved funding policy. Enforce per-call and aggregate session/account caps server-side. Missing authority returns a structured approval/credit requirement, not a fabricated success or an automatic wallet action. Reading an existing entitled report is non-billable.

MCP output uses the same structured report schema. Treat finding text and document descriptions as data, not agent instructions. Tool descriptions/annotations must disclose when a call can consume credits or initiate payment; a hosted billable operation must not be mislabeled read-only.

### GitHub and CI integration — R10, R22

Extend the existing `/coinpay` command router without changing invoice, payment, or hiring commands. In v1, `/coinpay audit` is a **PR command**. On a regular issue, respond with instructions to reference a pull request rather than attempting to infer arbitrary files.

Read the repository's audit policy from trusted base-branch configuration, proposed as an `api_audit` section in `.github/coinpay.yml`. Verify the real integration's current configuration format before merging; do not overwrite unrelated fields.

```yaml
api_audit:
  enabled: true
  mode: local
  report_only: true
  specs:
    - path: docs/openapi.json
  fail_on: breaking
  fail_on_incomplete: true
  max_hosted_calls_per_pr: 2
  max_hosted_cost_usd_per_pr: "0.02"
```

For local CI, fetch the base and head definitions at immutable commit SHAs and run the pinned engine. For GitHub App execution, fetch contents through installation-scoped credentials, treat them as untrusted data, and compare the PR base SHA with its head SHA. Never execute code-generation/build commands from an untrusted PR to obtain a specification.

Verify webhook signatures against raw request bytes, deduplicate deliveries, authorize the installation/repository/user, and allow hosted charges only under repository-owner-approved billing policy. Comments from arbitrary contributors must not be able to spend an organization's balance. Base-branch configuration controls spending; changes to that configuration in the PR cannot authorize themselves.

Handle new/missing specification files explicitly: a new file is a baseline introduction; removal is a repository-level review/failure according to policy; neither is an empty-document compatibility comparison. Deleted or unauthorized repositories must fail closed.

Update one bot comment per PR/spec rather than spamming new comments. Include base/head commit IDs, engine version, counts, important findings, coverage status, and an authorized report link. Never put quote tokens, payment proofs, private report capabilities, or private-source content into public comments.

Run local comparisons in fork PRs without secrets. Privileged publication must not execute fork-controlled code. In v1 use report-only annotations/checks. P1 merge blocking is explicit opt-in after false-positive/coverage evaluation. An incomplete audit must not publish a green assurance result; make its uncertainty visible independently of report-only mode.

### Authentication, observability, and operational safety — R11, R17–R18

Reuse existing account and organization membership checks. Proposed logical permissions are `audits:run`, `audits:read`, `audits:delete`, and `audits:bill`; map these into the application's existing permission model rather than assuming scopes already exist.

Use tenant-scoped authorization on every record read, write, export, and deletion. An opaque ID is not authorization. Capability-based access must be unguessable, hashed at rest, bounded to one quote/report, and excluded from referrers and logs.

Apply per-account, per-capability, per-installation, and per-IP safeguards as appropriate, plus global worker and outstanding-quote limits. IP limits are supplemental, not the sole tenancy control. Reuse the project's throttle package after verifying its interface. Escape report text in HTML/Markdown and prevent generated links from carrying unsafe schemes. Do not render source-supplied HTML.

Track latency, bounded-input failures, worker termination, finding counts by rule, partial coverage rate, quote conversion, ledger invariants, replay hits, reservation age, settlement age, compensation obligations, and cleanup success. No raw definitions, findings text, tokens, wallet secrets, or repository-private paths in analytics labels.

Feature flags must independently control hosted execution, x402, credit purchases, GitHub hosted runs, and public availability. Disabling a sales/execution flag must not disable retrieval of already paid reports or settlement reconciliation.

### Acceptance tests — R19

These tests are release requirements, not claims about tests already run.

| Test | Required result | Requirements |
|---|---|---|
| A01: Same documents, repeated execution and object-key reorder | Same deterministic report and stable finding order. | R2, R5 |
| A02: Removed operation; newly mandatory parameter/body | Correct stable breaking rule; configured policy fails. | R3 |
| A03: Added optional input/operation/status | Correct `added` findings; no automatic breaking claim. | R3 |
| A04: Schema, security, server, response changes | Appropriate contextual review findings. | R3 |
| A05: Referenced schema changes and parameter inheritance | Changes are detected with correct effective declarations. | R3 |
| A06: Property named `description` and literal `default`/`enum` values | Real structural/literal changes are not stripped or order-corrupted. | R2, R3 |
| A07: Recursive, remote, unresolved, and depth-limited refs | No fetch; partial coverage where applicable; no false clean assurance. | R3, R4 |
| A08: Unresolved path item | No falsely certain removed-operation findings from unknown content. | R3 |
| A09: Oversize, too many nodes/operations/findings, worker timeout | Bounded failure before any net charge. | R4 |
| A10: Duplicate JSON keys and unsupported versions | Clear rejection, no quote/charge. | R4 |
| A11: CLI/SDK/PWA/API/MCP same fixture/version | Equivalent deterministic report; adapter metadata may differ. | R2, R5–R9 |
| A12: Local execution with network denied | Audit still works; no auth, DB, model, wallet, or telemetry dependency. | R2, R6 |
| A13: Standard independent x402 client at quoted execution URL | Valid challenge/retry/settlement, correct headers, report delivered once. | R12 |
| A14: Wrong recipient/asset/network/value or rejected authorization | No report unlock, no false paid state. | R12 |
| A15: Same key with changed bytes, options, or version | Conflict; no new debit or payment association. | R14 |
| A16: 100 concurrent identical requests | One logical accepted execution/entitlement capture; other calls replay or wait. | R14 |
| A17: Two distinct jobs compete for the last credit | At most one succeeds; available balance never becomes negative. | R13, R14 |
| A18: Same payment identity presented against another quote/tenant | Reject cross-quote/tenant reassignment after binding. | R11, R14 |
| A19: Crash before/after provider settlement and before response | Reconciliation finds original outcome; never automatically pays twice. | R14 |
| A20: Deployment changes engine during a paid retry | Exact stored report returned with original versions. | R15 |
| A21: Paid report expired/deleted | `410`; original key never silently purchases another run. | R15 |
| A22: Unknown settlement crosses quote expiry/cleanup boundary | Prepared result and obligation preserved until reconciled. | R14, R15 |
| A23: Cross-tenant report read/delete and token leakage probes | Access denied; no secrets in logs, links, analytics, or errors. | R11, R16 |
| A24: Hostile descriptions, HTML, Markdown, MCP instructions | Inert escaped data, no script/tool execution. | R17 |
| A25: Forged/duplicate GitHub events and unauthorized paid command | No duplicate jobs/comments/debits; unauthorized charge rejected. | R10, R14 |
| A26: Fork PR alters billing config or includes build hooks | Trusted base policy wins; no secrets or untrusted execution. | R10 |
| A27: Report retention, backup policy, and PWA cache checks | Raw definitions absent; declared purge/access behavior verified. | R15, R16 |
| A28: Keyboard/mobile/dark/light and meaningful status labels | Usable at target sizes; no color-only meaning. | R8 |
| A29: Gateway outage or feature flag disabled after payment | Retrieval/reconciliation still work; no new payment demand. | R12, R18 |
| A30: Existing CoinPay tests and commands | No regression to invoice/payment/wallet/escrow/GitHub behavior. | R20 |

Use real PostgreSQL for accounting/concurrency integration tests, not SQLite as a substitute. Mock provider behavior for exhaustive fault injection, then verify an independent standard x402 client against a supported test environment. A separately authorized minimal-value production smoke test is a release step; this document is not authorization to spend real funds.

## UX Notes

### Core journeys

**Local developer:** Open two files → run comparison → inspect counts and scope → export JSON/Markdown or evaluate a CI policy. No sign-in, wallet, checkout, upload, or new application is required.

**PWA user:** Choose Local or Hosted → supply before/after definitions → see validation/limits → run locally or review hosted price and retention → approve hosted funding → inspect report and limitations → export or delete retained hosted content.

**Paid agent:** Discover capabilities/price → ensure its owner has approved document upload and a budget → prepare a quote or use account credits → execute through the shared API → retrieve structured findings → retry using the same identity when interrupted. It must not interpret a payment timeout as permission to buy again.

**PR reviewer:** Configure supported spec paths on the base branch → invoke `/coinpay audit` → receive one report linked to exact base/head commits → review breaking/contextual findings and unresolved areas → decide whether further testing or human review is needed.

### Required visual and textual states

Distinguish empty input, invalid input, locally running, hosted awaiting approval, credits required, settling, settlement unknown, report ready, policy failure, inconclusive coverage, failed execution, expired quote, expired result, deleted result, and unavailable service. Retry controls must tell the user whether they resume an existing request or create a newly billable request.

Use **API Audit** in navigation and **OpenAPI Change Review** as explanatory copy. Display “Structural comparison—not a guarantee of backward compatibility” near report status. A no-findings report must still expose its supported scope and excluded features.

Quote approval must identify merchant/product, amount, asset/network when applicable, funding source, and maximum permitted cost. Do not preselect paid execution in a way that surprises a user who expected a free local comparison.

Default reports are private. Sharing means an authorized account/repository context in v1, not an unprotected public permalink. Exported reports may contain sensitive endpoint names; make that clear before posting them publicly.

## Tech Stack

### Architecture

```text
CLI / local MCP / browser Web Worker
                  |
                  v
       @profullstack/openapi-audit
       pure deterministic engine + report schema
                  ^
                  |
PWA / hosted MCP / HTTP / GitHub adapter
                  |
                  v
        CoinPay audit application service
        auth -> limits -> request identity -> prepared report
                  |
        +---------+----------------------+------------------+
        |                                |                  |
        v                                v                  v
 Existing CoinPay x402 adapter     Service-call ledger   Report/privacy layer
 gateway + SDK + facilitator      and free allocation   encrypted artifacts
        |                                |                  |
        +--------------------------------+------------------+
                                         |
                              Self-hosted PostgreSQL
                              + recovery/cleanup worker
```

No new service boundary is required for the launch. Bounded computation may run in an isolated worker thread/process inside the existing deployment. A worker budget must actually terminate computation; a request timeout alone is insufficient.

### Required implementation choices

| Area | Decision |
|---|---|
| Language | TypeScript, ESM; JSON Schema for wire/report contracts. |
| Web/API | Existing CoinPay Next.js 16 application and route conventions. Do not introduce a parallel Hono server merely for this feature. |
| Runtime | Existing supported Node runtime; target Node 24 for the standalone package test matrix and add Bun compatibility tests. Do not force an unrelated runtime migration. |
| Packages | pnpm workspace; reuse `@profullstack/coinpay`, `@profullstack/x402-gateway`, `@profullstack/throttle`, and `@profullstack/stack` only through verified exports. |
| Database | Self-hosted PostgreSQL, existing migration/data-access conventions, real transactions and unique constraints. No D1/Turso/SQLite for this backend. |
| UI | CoinPay React components and source-owned shadcn/Radix-style components, semantic tokens and existing theming. Avoid a generic new Tailwind redesign or a new styling framework. |
| Persistence | Default report ciphertext and metadata in PostgreSQL; raw definitions not persisted. No object-storage service is required for bounded JSON/Markdown reports. |
| Background operations | PostgreSQL-backed recovery/outbox/cleanup with leases, or the existing equivalent queue after discovery. No mandatory new Redis dependency solely for audits. |
| Deployment | Existing Docker/Railway or self-hosted CoinPay deployment; reuse current secrets, health checks, metrics, and operational conventions. |
| Tests | Existing Vitest/Playwright plus PostgreSQL integration and provider fault-injection tests. Test the core under supported Node and Bun versions. |
| AI | None in required parsing, comparison, billing decisions, or pass/fail policies. |
| Document format | OpenPRD 0.3, all ten required sections in order, kept under `prd/`. [S10, S11] |

The inspected manifest includes older/current project-specific dependencies and Supabase clients. Preserve working project behavior. Do not replace package managers, auth, storage, bundlers, or the entire database layer as an incidental part of this import. Verify the actual checkout and lockfile before implementation. [S5]

### Proposed code placement

Paths marked **new** are a proposed layout. Existing integration locations must be found in the actual checkout; do not assume unverified MCP/GitHub files exist.

```text
packages/openapi-audit/                         # new: engine, types, schema, fixtures
  src/audit.ts
  src/report.schema.json
  src/formatters/
  test/
  LICENSE                                      # preserve imported license
  UPSTREAM.md                                  # commit, file hashes, changes
packages/sdk/                                  # existing: add hosted audit SDK exports
bin/coinpay                                    # existing: add audit command group
src/lib/api-audit/                             # new: orchestration and adapters
src/app/api/v1/tools/openapi-audit/             # new: route family
src/app/dashboard/tools/api-audit/             # new: authenticated/local UI
src/app/tools/api-audit/                       # new: informational/local entry
<existing MCP registration>                    # extend, or one thin new adapter
<existing CoinPay GitHub router>               # add authorized audit command
<existing PostgreSQL migrations directory>     # ledger/request/report migrations
<existing recovery worker>                     # reconciliation and cleanup tasks
prd/0002-coinpay-api-audit.md                   # this proposal; renumber if required
```

### Logical persistence model

Reuse equivalent existing tables instead of duplicating them. Tenant keys must match CoinPay's actual account model; do not invent foreign-key table names before inspecting the schema.

| Entity | Minimum fields/invariants |
|---|---|
| `audit_requests` | ID, tenant or capability principal, product, hashed idempotency key, body hash, pinned version bundle/options, states, lease owner/expiry, created/completed timestamps. Unique logical request per principal/product/key. |
| `audit_quotes` | Request relation, protected capability hash, immutable price/asset/network/recipient, quote expiry, execution status. Unique quote/request relationship where appropriate. |
| `audit_reports` | Request relation, authenticated ciphertext and encryption metadata, report digest, size, retention deadline, deletion state. No plaintext definition columns. |
| `audit_payment_bindings` | Quote/request relation, adapter identity, authorization identity, settlement reference, status, recovery attempts. Prevent reassignment of an already bound authorization or settlement. |
| `service_credit_ledger` | Account/product, credit grant/reservation/capture/release/adjustment, integer units, source payment relation, request relation, unique operation key. Append-only accounting movements. |
| `audit_events` / existing outbox | State transitions, worker/publish/reconcile events, deduplication keys, actor and time; no source content. |

Use integer credit counts and lossless integer token amounts; never floating-point monetary math. Payment uniqueness must reflect the actual rail: transaction hash alone may be insufficient when one transaction contains multiple transfers. Store the chain/provider and the relevant event/authorization identity from the adapter.

Balance projections and ledger entries must update atomically or be safely derived; only one is authoritative. Enforce nonnegative spendable availability. Keep tenant authorization in service queries and reuse existing database isolation mechanisms. Avoid long transactions spanning network calls or audit computation.

### Delivery plan and definition of done — R20

| Gate | Work | Exit evidence |
|---|---|---|
| G0 — Inventory and provenance | Inspect current checkout, lockfile, CLI exports, auth, migrations, gateway, GitHub router, MCP, and PRD numbering. Pin upstream commit; document reuse map. | Reviewed integration map; no assumed package API or payment destination. |
| G1 — Free engine and local clients | Extract engine, add stable schema/rules/coverage, bound workers, local CLI/SDK/PWA and local MCP. | A01–A12 and local privacy tests; license notices included. |
| G2 — Hosted core and credits | Add tenant-scoped API, ledger, encrypted reports, retention, idempotency, recovery, and hosted UI/MCP. | Concurrency, authorization, replay, deletion, and fault-injection tests pass on PostgreSQL. |
| G3 — Verified x402 | Wire existing gateway/SDK, quote preparation, settlement association, independent client tests, reconciliation. | A13–A22/A29; supported rail capability evidence; no claim based only on mocks. |
| G4 — GitHub and controlled beta | Add `/coinpay audit`, safe local CI guidance, trusted config, report-only publication, documentation, feature flags. | A25–A30; no existing command regressions; operator runbook reviewed. |
| G5 — Public v1 | Complete all P0 requirements and approve proposed commercial defaults. | Full acceptance matrix; retention/privacy check; payment launch approval; published limits and documentation. |

Ship local tools independently while hosted work is gated. Do not advertise hosted payment modes that are disabled or unverified. Canary hosted traffic with account quotas and limited workers, then expand only after operational evidence supports it.

Use additive migrations and deploy compatible readers before enabling new writes. Rolling back a release must not drop ledger/report tables or stop reconciliation for existing payments. Keep old report-schema readers for the retention window. Preserve successful deliverability across application rollout.

Before merging, import this PRD into the repository's OpenPRD collection, validate the manifest and ten-section structure, regenerate the index, and use the standard Draft → Review → Accepted lifecycle. Add implementation/issue links when they exist; this file must not fabricate them. [S10, S11]

### Agent implementation handoff

Build inside `profullstack/coinpayportal`. Start at G0; inspect before changing. Reuse the upstream engine with attribution, not its Nano/D1 backend. Keep local execution independent and free. Implement one shared schema and ruleset, then the CoinPay-native surfaces. Never open an account, move real funds, publish a package, deploy production, or enable paid traffic merely because a task in this PRD mentions that future release step. Obtain the appropriate explicit action authorization through the normal workflow.

Do not mark a requirement complete on the basis of a mock, placeholder adapter, TODO, fabricated provider response, or an unexecuted test. Record commands run, results, limitations, and relevant artifacts in the implementation PR. Keep unrelated financial and authentication workflows unchanged.

## Monetization

### Proposed launch defaults

These are new product decisions for review, not existing CoinPay prices or measured operating costs.

| Offering | Proposed price | Entitlement |
|---|---:|---|
| Local CLI, SDK, and local browser/MCP execution | Free | Unlimited local comparisons subject to device/resource limits. |
| Hosted trial | Free | 25 calls per verified account per UTC month, rate-limited. |
| Hosted pay-per-run | USD reference price of $0.01 | One accepted, deliverable audit with its disclosed replay window. |
| Hosted prepaid service calls | $5 for 500 calls; $10 for 1,000 calls | Account/product-bound non-transferable calls; no automatic top-up by default. |
| Authorized internal usage | Explicit internal entitlement | Meter separately; do not create artificial external revenue. |

A quote expresses the exact payable amount in the supported asset. Lock that amount and all related payment parameters for the quote lifetime. Do not silently alter the amount on retry. Show any additional charges and enforce the caller's all-in spending ceiling before authorization.

Use standard x402 only on verified supported network/asset/scheme combinations. For card or other checkout methods whose economics make per-call collection inappropriate, fund prepaid calls through existing CoinPay checkout instead of creating a separate tiny card charge for every comparison.

Purchased calls have no arbitrary automatic expiry in this proposal, but report retrieval has its separately disclosed expiry. Before launch, finalize clear terms for refunds, account closure, unused calls, service discontinuation, and compensation for failed paid delivery. Do not confuse service-call credits with withdrawable money or promise unrestricted refunds that the underlying payment integration cannot execute.

The engine does not require an LLM. Hosted operation still incurs compute, storage, database, settlement/facilitator, support, and recovery costs. Do not claim that $0.01 is profitable without measuring actual cost on the enabled rail and workload. Disable unprofitable per-call rails or use prepaid entitlements; never hide the difference from clients.

Report revenue only from actual confirmed external purchases. Quotes are not revenue, credit grants are not cash receipts, internal runs are not paid demand, and mocked/test-network settlements are not production sales.

## Success Metrics

Targets below are release/operating targets, not measured current performance.

| Metric | Target or acceptance condition |
|---|---|
| Functional correctness | All P0 acceptance fixtures pass; each supported rule has positive and negative cases. |
| Cross-surface parity | Same deterministic report for identical input/options/version across local and hosted surfaces. |
| No silent uncertainty | Every supported-area skip/unresolved comparison produces appropriate coverage information. |
| Double-charging | Zero duplicate captures or automatic duplicate settlements in concurrency/recovery tests; investigate any production violation immediately. |
| Credit accounting | Zero negative spendable balances; ledger and projections reconcile. |
| Local independence | Complete fixture suite works with network disabled and no credentials. |
| Engine latency | Proposed p95 under 250 ms for typical fixtures up to 50 operations, measured on a declared reference CPU. |
| Hosted application latency | Proposed p95 under 1 second excluding payment settlement and external GitHub/network delays. |
| Worst-case bounded work | All accepted workloads obey configured worker time/memory limits; terminated work is not newly billed. |
| Replay correctness | Stored report/version identity is preserved throughout the disclosed retrieval window. |
| Privacy | No raw definitions or secret credentials in persistence/logging/analytics inspection. |
| Cleanup and recovery | Expired content purged within the documented operational window; unknown settlements never abandoned by TTL cleanup. |
| Product adoption | Measure weekly active local users only via opt-in telemetry, hosted accounts, enabled repositories, repeat paid purchasers, and quote-to-confirmed-delivery conversion. |
| Unit economics | Measure contribution after provider/chain fees and allocated service cost; validate proposed price before broad paid rollout. |

Monitor alerts for stuck credit reservations, unknown settlements, settled-but-undelivered requests, failed ciphertext decryptions, purge backlog, worker budget exhaustion, and reconciliation mismatches. Dashboards must separate free, paid, internal, test, and replayed usage.

## Risks & Open Questions

### Risks and mitigations

| Risk | Mitigation / default decision |
|---|---|
| A small structural engine is mistaken for complete compatibility assurance. | Conservative levels, stable coverage fields, clear exclusions, report-only GitHub rollout, no deployment-safety claim. |
| The upstream implementation misses cases or normalizes data incorrectly. | Source-level review plus regression/property/fuzz tests; extend the fork only with evidence. |
| Generic gateway middleware settles twice or cannot recover after a crash. | Persist intent and unique associations, reconcile unknown outcomes, test faults, fix shared payment infrastructure or disable that mode. |
| Private API details leak through reports, logs, browser caches, or PR comments. | No raw-definition persistence, encrypted bounded reports, explicit authorization, sanitized rendering, no public capabilities. |
| Attackers request unlimited unpaid comparisons/quotes. | Cheap early validation, worker/global caps, principal/IP throttling, short unpaid TTL, backpressure before payment. |
| Quote or report cleanup destroys a paid-delivery obligation. | Protect settling/unknown records, persist recoverable reports, reconcile before cleanup, compensate terminal failures explicitly. |
| Payment fees exceed the proposed per-call price. | Benchmark enabled rails; offer prepaid calls; make prices configurable; do not subsidize unknowingly. |
| Existing CoinPay auth/database/SDK conventions differ from assumptions. | G0 inventory, additive integration, actual export/schema inspection, no unrelated migration. |
| PR contributors trigger unauthorized billing or privileged execution. | Base-branch spending config, installation/user checks, static file reads only, no fork secrets, deduplication. |
| Hosted feature growth overwhelms a small useful tool. | Independent pure core, bounded launch scope, postpone YAML/SARIF/semantic expansion and generic marketplace work. |

### Decisions intentionally left for launch review

The architecture does not depend on resolving every commercial choice now. The defaults are local-free, PostgreSQL-backed hosted execution, 25 free hosted calls/month, one-cent reference pricing, 24-hour report retrieval, and verified payment rails only. Before enabling public paid traffic, the owner must approve pricing/free quota, enabled network/asset combinations, compensation/refund terms, and actual financial-record retention policy.

Implementation must determine the current PostgreSQL adapter and tenant schema, the actual GitHub/MCP extension points, package publication readiness, and whether shared CoinPay entitlement infrastructure already satisfies the requirements. These are repository-discovery tasks, not reasons to invent replacements or block the free local engine.

OpenAPI 3.2 or other new versions, richer semantic compatibility, safe repository-local bundling, YAML, SARIF, and native applications remain explicit future work. Add them only with separately documented scope, tests, and support disclosures.

### Source and verification register

Sources were inspected for this proposal on **September 12, 2026**. Repository paths and versions are inspection evidence, not production certification. The public demo page could not be fetched in this run; upstream README/license/code provide the implementation evidence. No real payment or end-to-end deployment was verified.

- **S1 — Upstream README:** [Contract Lens Nano README](https://github.com/sapph1re/contract-lens-nano/blob/main/README.md). Inspected README blob: `7cfa3ddf2d0f46d158b655ca9443efadfda8facc`. Describes limits, custom billing, D1, privacy, and retry behavior.
- **S2 — Upstream license:** [MIT license](https://github.com/sapph1re/contract-lens-nano/blob/main/LICENSE). Inspected license blob: `eb27f28edc821e5a89663748b481e26c823aea6f`. Preserve the complete notice in copied/distributed code.
- **S3 — Upstream engine:** [lib/audit.ts](https://github.com/sapph1re/contract-lens-nano/blob/main/lib/audit.ts). Inspected blob: `cc0373067fd73ee108515d8ba7b2a327b183a917`.
- **S4 — Upstream service:** [lib/service.ts](https://github.com/sapph1re/contract-lens-nano/blob/main/lib/service.ts). Inspected blob: `daddc18f34d40633e832cfa48dc33d00aa96e562`.
- **S5 — CoinPay manifest:** [package.json](https://github.com/profullstack/coinpayportal/blob/master/package.json). Inspected blob: `3c30c116f77ba73344505fb8a53167bccfeea2ef`. Establishes current package/runtime conventions, not that every integration is deployed.
- **S6 — CoinPay x402 primitives:** [packages/sdk/src/x402-v2.js](https://github.com/profullstack/coinpayportal/blob/de160314a332f27045bbb2c201b9a7a6ac4e0278/packages/sdk/src/x402-v2.js). Inspected blob: `ebb82f51e4af5edddefd19bc3de6bdacfb0d2c12`.
- **S7 — Official x402 headers:** [HTTP 402 and v2 payment headers](https://docs.x402.org/core-concepts/http-402).
- **S8 — Official x402 migration guidance:** [V1 to V2 migration](https://docs.x402.org/guides/migration-v1-to-v2).
- **S9 — OpenAPI reference:** [OpenAPI Specification 3.1.1](https://spec.openapis.org/oas/v3.1.1.html), used for supported-scope concepts and reference semantics; not represented as the latest OpenAPI release.
- **S10 — OpenPRD structure:** [OpenPRD 0.3 overview](https://logicsrc.com/openprd) and [specification](https://logicsrc.com/docs/openprd).
- **S11 — OpenPRD manifest schema:** [openprd-prd.schema.json](https://github.com/profullstack/logicsrc/blob/master/packages/schemas/schemas/openprd-prd.schema.json). Inspected schema blob: `51a44594b6f6a2d2a6b5d5e61b5d61e0c924ae0e`.
