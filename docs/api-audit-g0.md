# API Audit G0 inventory

Inspected September 14, 2026 for `prd/0002-coinpay-api-audit.md`. This is source inspection and an implementation handoff, not completed feature work or payment certification. The proposal remains **Draft**; R1–R25 and A01–A30 remain unimplemented/unverified for API Audit.

## Checkout and collection

- Repository: `profullstack/coinpayportal`; local branch `cfo-report`; HEAD `8dde009aefc3ccf3cabb2af0d4230cc7165c3e69`.
- Existing changes at inspection: `packages/sdk/README.md`, `packages/sdk/package.json`, `packages/sdk/src/finances-tui.js`, `pnpm-lock.yaml`, and untracked `packages/sdk/test/finances-markdown.test.js`. These were not edited by the audit import.
- No `prd/` collection existed initially. Another concurrent import added `0001-coinpay-lending-quickbooks-sync.md`; API Audit was renumbered to `0002` without changing that proposal. The API Audit front matter, target-file note, and proposed file tree agree on `0002`.
- The original requirements, acceptance matrix, source register, and Draft status were retained. `updated` is September 14 to record the import/renumbering. The historical September 12 observations in the PRD are supplemented by this inventory, not silently rewritten as current facts.
- Existing root `PRD.md` is a separate legacy document, not a numbered OpenPRD allocation.

## Upstream pin and permitted import

Repository: https://github.com/sapph1re/contract-lens-nano

Pin for the future engine import: `030ab9f959236f60eb72d9dc065cda009ad99e5a`. Both remote HEAD and `refs/heads/main` resolved to this commit during inspection. Files were fetched by this immutable commit, and their Git blob IDs were recomputed from their bytes. The four file blobs cited in the proposal all match.

| Path | Git blob ID | SHA-256 |
| --- | --- | --- |
| `lib/audit.ts` | `cc0373067fd73ee108515d8ba7b2a327b183a917` | `a7f82c4442c42ab1141e0b7dc79d5b20d48259d16f92a8d93277e80bd8a9e709` |
| `LICENSE` | `eb27f28edc821e5a89663748b481e26c823aea6f` | `ac0139d578aedf1dab922938d9f7d98f1ea62d2547670b40a0f0b330ddb04387` |
| `README.md` | `7cfa3ddf2d0f46d158b655ca9443efadfda8facc` | `f3deea5bc322e8d881e59faaf7a25d759862a70bfbcfc2fe551301c976d2eb18` |
| `lib/service.ts` | `daddc18f34d40633e832cfa48dc33d00aa96e562` | `114e2cc737822f7960db426dec488090fd3e93eabd16dc164b1fa927b4a97802` |
| `tests/audit.test.mjs` | `acda3e803ea46f6f0994712c5cf5c1650f9be86e` | `e26754cfb2ef624f16a3e8afaf62dafdac630f9d045f71831aa98b76b15b92d3` |

Import only the engine and relevant audit fixtures/tests into the future independent package, with the complete MIT license naming Copyright (c) 2026 Roman Vinogradov. Record subsequent modifications in `packages/openapi-audit/UPSTREAM.md` and ship the license with artifacts. No upstream code has yet been copied into CoinPay. Service/payment files were inspection evidence only; do not import the Nano backend, receiving pool, addresses, configuration, or hosting identities.

Source review found specific work for G1:

- Upstream exports `audit(input: any)`; it does not expose the proposed versioned `auditOpenApi` contract, JSON Pointers, stable rule IDs, or policy outcomes.
- Object keys are sorted inside fingerprints, but operations/findings follow document insertion order. Final ordering needs explicit normalization.
- Literal `default`, `const`, and `enum` values bypass recursive normalization. Reordered keys inside literal objects can therefore change fingerprints. Preserve literal data while making object-key order deterministic.
- Documentation-key filtering uses a map-context allowlist. The upstream test for a schema property named `description` is useful, but wider keyword-named maps and literal cases need dedicated regression coverage.
- `$ref` siblings are wrapped in `$resolved`/`$siblings`; operation enumeration can consequently lose path-item methods. Unresolved paths can also become falsely certain operation removals. Track unknown operation sets before classifying removals.
- Expansion visits are counted per fingerprint, with a 12,000-visit limit. They are not the proposed global 100,000-visit comparison budget, and the separate reference-chain resolver needs a bounded budget too.
- The existing version regex only checks a prefix. Strict JSON parsing, precision checks, worker termination, serialized-output limits, and the explicit coverage/policy schema remain work.
- Seven audit tests are present upstream. They were inspected, not executed; they are not a substitute for the proposed acceptance suite.

## Integration map

All paths below are in CoinPay unless a separate repository is named. Presence in source does not establish deployed configuration or successful runtime behavior.

| Area | Verified surface | Implementation consequence |
| --- | --- | --- |
| Workspace/runtime | Root `package.json`: ESM, Next `16.2.11`, React `^19.0.0`, Node `>=20.9.0`; `pnpm-workspace.yaml` includes `packages/*`. `Dockerfile` uses Node 24 and pnpm `10.32.1`. | Add an independent workspace package; avoid changing the application's runtime or package manager. |
| Local tools | Root `bin/coinpay` and published SDK `packages/sdk/bin/coinpay.js` are distinct dispatchers. Both manifests declare a `coinpay` binary. | Route both to the same audit adapter. A change to the root binary alone would not reach published CLI users. Dispatch local audit before wallet/auth initialization that it does not need. |
| SDK | `packages/sdk/package.json` exports ESM JS with `.d.ts` types; root, payments, wallet, and x402 subpaths exist. `CoinPayClient` in `src/client.js` accepts an API key and base URL ending in `/api`; `request()` accepts caller-provided body/headers. | Add explicit hosted audit helpers/types/export entries. Serialize once and reuse exact bytes on retries. There is no existing `client.audits` namespace. Preserve structured billing errors and distinguish timeouts from payment failure. |
| Auth/tenancy | `src/lib/auth/middleware.ts` has `authenticateRequest` and merchant/business contexts; `merchant-guard.ts` verifies dashboard merchant JWTs. `authz.ts` resolves business/org membership using `permissions.ts`. Migrations define `merchants`, `businesses`, `organizations`, `organization_members`, and `business_members`. | Reuse identity and membership checks; add audit capabilities deliberately. Do not convert a scoped business credential into unrestricted owner access. Verify OAuth CLI-token compatibility with the chosen route guard. |
| Persistence | Current server access uses `src/lib/supabase/server.ts` and `service-client.ts`. SQL migrations live in `supabase/migrations/`. No direct `pg`/`postgres` application adapter or standalone PostgreSQL migration runner was found in the inspected app/scripts/manifests. | Add the smallest audit-scoped PostgreSQL connection/migration path for new persistence. Keep current authentication/data access intact. Determine whether the new database shares existing identity tables before adding foreign keys; deployment topology is unverified. |
| Entitlements | `src/lib/entitlements/service.ts` includes atomic quota RPC wrappers. `20260404160000_usage_billing.sql` defines USD balances keyed by business/email, usage logs, and top-ups. | These are reuse references, not a demonstrated call-credit reservation/capture ledger. The inspected schema lacks the proposed product/request identities and report-finalization transaction. Do not relabel money balances as call credits. |
| Throttle | No `@profullstack/throttle` dependency or import was found in current manifest/lockfile/app. `src/lib/web-wallet/rate-limit.ts` exposes `checkRateLimitAsync(identifier, endpoint)` with a shared-store path and memory fallback. | The historical PRD package listing differs here. Implement tenant/global limits using verified interfaces and a suitable shared store; local memory is insufficient for distributed billing or replay protection. |
| Shared stack | `@profullstack/stack` `0.1.3` exports root, referrals, email, supabase, feedback, coinpay, and crawlproof. Current consumers include feedback and referrals. | No generic PostgreSQL ledger export was discovered. Do not assume this package supplies transaction/accounting APIs. |
| x402 gateway | `src/lib/crawl-gateway.ts` imports `createGateway` and `x402Proxy`; `robots.txt/route.ts` imports `robotsRoute`. This integration sells crawl access. | Keep crawling behavior intact. A daily access-pass gateway is not an audit quotation/recovery implementation. |
| x402 SDK/facilitator | `packages/sdk/src/x402-v2.js` exports `buildPaymentRequiredV2`, `buildExactEvmPayment`, header codecs, `CAIP2`, `TOKEN_DOMAINS`, and authorization helpers. Server paths include `/api/x402/verify`, `/api/x402/settle`, `src/lib/x402/v2.ts`, and `settle-v2.ts`. | Reuse cryptographic structures and verified network/token metadata. Add the audit quote/authorization association and repair reusable settlement recovery before enabling this mode. No rail has been certified by this inventory. |
| Recovery | `src/lib/webhooks/retry-queue.ts` and payment-monitor cron code implement persistent retries; `20260819210000_webhook_delivery_queue.sql` defines that queue. | Reuse scheduling/claim patterns where applicable, but create audit-specific ownership leases and reconciliation. Best-effort enqueue after failure is insufficient for a settlement intent that must exist before money moves. |
| Report encryption | `src/lib/crypto/encryption.ts` has AES-256-GCM helpers. The inspected `encrypt(plaintext, keyHex)` API has no tenant AAD or key-version parameter. | Extend the reusable primitive or add a report wrapper with authenticated tenant context, rotation metadata, retention, and backup lifecycle. Do not assume current ciphertext format meets R16. |
| Logging | `src/lib/audit/log.ts` exposes `recordAuditEvent` and secret-key redaction. `src/instrumentation.ts` forwards logs through OpenTelemetry. | Existing security audit logs are distinct from OpenAPI reports. Use an allowlist of content-free events; redaction by secret-like keys does not remove private API definitions/findings. |
| PWA/UI | `public/manifest.json`, root layout, `src/components/Header.tsx`, and existing page/component styles are available. No service-worker registration/cache implementation was found in the searched app/public sources. | Reuse the app shell. Offline local-worker caching and the sensitive-content exclusions need implementation and browser testing; manifest presence alone does not prove offline behavior. |
| MCP | No MCP transport/registration was found in this checkout's app, library, package, or script paths. | Use the PRD's thin-adapter fallback around the same engine/service. Local and hosted permissions must remain explicit. |
| Tests | Root Vitest includes only `src/**/*.test.{ts,tsx}` and `packages/sdk/test/**/*.test.js`; Playwright is configured. | Add package-specific test configuration or explicitly include the new engine suite. Otherwise root `pnpm test` will silently omit `packages/openapi-audit/test`. Real PostgreSQL and independent x402-client tests are additional work. |

### Dependency installation drift

The manifest requests `@profullstack/x402-gateway: ^0.1.0` and the working lockfile resolves **0.1.0**, but `node_modules/@profullstack/x402-gateway` points to installed **0.6.0**. Inspection of that installed export map is evidence only for 0.6.0. Resolve this mismatch in a clean dependency environment before choosing gateway APIs or claiming reproducible tests. This import did not reinstall dependencies or alter the user's lockfile.

### Settlement gaps identified by static review

`src/app/api/x402/settle/route.ts` conditionally claims a verified payment as `settling`, which is a useful concurrency primitive. It also:

1. Uses network/business/authorization nonce to locate a verified payment, without an audit quote/body/version binding.
2. Calls `settleExactEvmV2`, whose token broadcast is followed by `tx.wait()` and only then returns the transaction hash. There is no persistence callback for the submitted hash in this helper.
3. Maps exceptions from the settlement block to `settlement_failed`, including potentially ambiguous broadcast/confirmation failures.
4. Awaits the final database update but does not check its returned error before returning a settled response.

Consequently, the inspected flow does not demonstrate R14's persisted broadcast identity, `unknown` state, confirmed durable completion, and crash reconciliation. These are implementation findings from reading source, not reproduced production incidents. Test and repair the reusable layer; leave API Audit x402 disabled until the required independent-client and fault-injection evidence exists.

## GitHub integration location

CoinPay's `.github/workflows/coinpay.yml` handles `issue_comment.created` and delegates to `profullstack/coinpaybot@v0`. It is managed by the sh1pt Actions Fleet. `.github/coinpay.yml` is a separate proposed repository configuration path, not this workflow file.

A read-only inspection of the sibling `profullstack/coinpaybot` checkout at `09e2d386dffa6e6e9310e0ea9a8d8f505d1a7f5d` found:

- `src/parser.ts`: `parseCommand`, supporting help, invoice, approve, status, and cancel.
- `src/handler.ts`: `handleComment`, with author-association checks for invoices and comment-marker deduplication.
- `src/config.ts`: `ResolvedConfig`/`resolveConfig`; existing camelCase keys and nested `commands`/`labels`. There is no `api_audit` field.
- `src/main.ts`: reads `.github/coinpay.yml` without an explicit commit ref and falls back to defaults on any read error. This must not become fail-open hosted spending behavior.
- `action.yml`: an Action entrypoint using Node 24. The inspected source is not proof that the moving `v0` tag currently points to this commit or that a hosted GitHub App exists.

G4 needs a coordinated extension at these real integration points, immutable base/head reads, trusted billing policy, PR identification, and stronger job/publication idempotency. Changes to a PR's config cannot authorize that PR's spending. A future Action update must account for the Fleet-managed workflow rather than replacing invoice handling inside CoinPay. No sibling repository files or GitHub state were modified by this inventory.

## Evidence and next gate

Commands/checks performed:

- `git status --short`, branch/HEAD/remote inspection, `rg --files`, and targeted source/manifest/lockfile reads.
- `git ls-remote https://github.com/sapph1re/contract-lens-nano.git HEAD refs/heads/main`, immutable raw-file downloads, Git tree inspection, and recomputed Git blob/SHA-256 hashes.
- Installed tools: Node `v24.18.1`, pnpm `11.18.0`, Bun `1.4.2`, LogicSRC CLI `0.3.0`. These differ from the Docker pnpm pin and do not represent a completed runtime test matrix.
- `logicsrc prd init`, `logicsrc prd index --write`, and `logicsrc prd validate --strict --expect-version 0.3`. Validation passed after the numbering collision was resolved: two PRDs, 73 requirements in the collection; API Audit contains 25 requirements and ten required sections. Slug/H1 wording produces informational findings only.

No application, engine, PostgreSQL, browser, or payment test suite was run for this documentation-only import. No migration, package publication, deployment, account creation, payment, or paid-traffic enablement occurred. G0's inspection artifact is ready for review; it does not imply completion of later gates.

Next implementation work is G1: import the pinned engine/license/test fixtures, define the deterministic schema/rules/coverage contract, enforce bounded parsing and workers, wire both CLI entrypoints and local clients, then execute A01–A12. Hosted persistence topology, commercial approval, external integration changes, and payment certification remain separately identified work, not prerequisites for free local engine development.
