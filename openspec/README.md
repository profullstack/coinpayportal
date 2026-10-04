# CoinPayPortal OpenSpec changes

This directory contains proposed changes. A change bundle does not establish shipped behavior or approve a financial capability.

| Change | PRD | Status | Scope |
|---|---|---|---|
| `changes/add-coinpay-lending-quickbooks-sync/` | `prd/0001-coinpay-lending-quickbooks-sync.md` | Draft | Accounting and data foundation; gated partner financing, stablecoin settlement, and permissioned P2P |

The bundle contains `proposal.md`, `design.md`, `tasks.md`, requirement deltas under `specs/`, and `traceability.md`. All implementation and launch tasks remain unchecked. There is no baseline under `openspec/specs/` claiming that these capabilities already exist.

Validate from the repository root:

```bash
logicsrc prd validate --strict --expect-version 0.3
logicsrc openspec validate add-coinpay-lending-quickbooks-sync --strict --no-interactive
```

The second command delegates to the OpenSpec CLI. Validation checks document structure; financial behavior requires the future tests and release evidence listed in the bundle.
