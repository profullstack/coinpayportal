# Retrying invoice creation

`POST /api/invoices` accepts an optional `Idempotency-Key` header. Existing
unkeyed clients retain their current behavior. Auth and business permissions are
unchanged: callers need invoice-write access; naming a payout override still
requires the existing owner permission for team/JWT callers.

## Contract

- Use one stable, opaque key per logical request (1-255 printable, non-space
  ASCII characters). A GitHub integration can derive it from repository and
  comment ID. Never derive it from amount or description.
- Send the same requested terms on every retry. Keys are scoped by business.
- First creation returns HTTP 201 with `success`, `invoice`, and
  `idempotentReplay: false`. A replay returns HTTP 200 and the current original
  invoice with `idempotentReplay: true`, even if it is now paid or cancelled.
- Changed terms with the same key return 409. A deleted original returns 410;
  its retained key cannot create a replacement. A new intentional invoice
  needs a new key.
- Lookup, migration, or transaction failure returns 503 without falling back to
  unkeyed creation. A timeout may mean the transaction committed: retry with
  the same key, not a new one.
- Amounts must be positive JSON numbers with at most two decimal places;
  currency is a three-letter uppercase code (default USD). Notes are bounded
  to 5,000 characters. Invalid keyed requests return 400.
- Draft, optional recurrence schedule, and key are committed atomically.
  Requested terms, not mutable business wallet defaults, determine replay
  identity. Replays never recalculate or overwrite the stored payee.

Creation produces a **draft**, not a payable invoice, and neither emails nor
moves funds. Use the separately authorized `POST /api/invoices/{id}/publish`
flow to activate payment details without email. Only advertise its live link
after a successful publish response. Never republish a closed invoice.

## GitHub source reference

An optional structured `source_reference` is stored in invoice metadata:

```json
{
  "provider": "github",
  "repository": "example/project",
  "thread_number": 12,
  "comment_id": 123456,
  "actor_id": 654321,
  "actor_login": "contributor",
  "payer_login": "maintainer"
}
```

This is caller-supplied audit context, **not proof of GitHub identity, a client
account mapping, or authorization**. The authenticated business remains the
issuer. Do not expose private issue text or sensitive billing data in a public
comment. The API rejects extra reference fields and invalid IDs/logins.

Keyed source requests have a durable per-business/repository rolling hourly
creation cap (`source_rate_limit`, integer 1-1000, default 20). Repository
matching is case-insensitive. The authenticated integration chooses its cap;
it is not a global account quota. At capacity, new creations return 429. Existing
keys still replay, and deleting an invoice does not erase its usage. The cap
does not apply to legacy unkeyed invoice creation or prove source authenticity.

## Deployment and tests

Apply `supabase/migrations/20260907100000_invoice_creation_idempotency.sql`
through the normal migration process before enabling an integration that
requires this contract. It adds a service-role-only table/function. App deploys
alone do not apply the migration. Keep the GitHub command disabled until the
portal and migration are deployed and verified. Do not drop the identity table
on rollback: retaining keys prevents delayed retries from duplicating invoices.

`pnpm test:invoice-creation-db` checks the actual migration against isolated
PostgreSQL, including concurrent retries, unique numbering, transactional
schedule rollback, deleted-invoice tombstones, per-repository limits, and role
privileges. It requires Docker and an already available `postgres:17-alpine`
image. It uses no host ports, no external network, and an ephemeral tmpfs data
directory; the container is removed afterward. Never point this test at a
production database.
