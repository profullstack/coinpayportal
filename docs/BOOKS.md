# Books

`/finances/books` is the bookkeeping desk: every synced transaction gets a
suggested spend category, a tax category and a business/personal scope, a
person confirms or corrects it, and the confirmed books roll up into a tax
summary and a CPA pack. Companion to [FINANCES-REPORTS.md](./FINANCES-REPORTS.md)
(immutable period reports) and [STATEMENTS.md](./STATEMENTS.md).

Nothing here is tax advice. The tax categories are a bookkeeping mapping in
the shape of a Schedule C, prepared for an accountant, and every export
prints how many rows are still unreviewed.

## Where a category comes from

| `category_source` | What it means | Confidence |
|---|---|---|
| `rule` | A merchant rule matched the payee or description | 0.95 |
| `model` | The language model suggested it (only when `ANTHROPIC_API_KEY` is set) | the model's own, capped at 1 |
| `auto` | The keyword/MCC heuristics in `classify.ts` | 0.6 to 0.8 |
| `user` | Confirmed in the review queue | 1 |

A `user` value is never re-derived. Everything else can be re-run with
**Auto-categorise unreviewed** (a `categorize` job in the worker): rules
first, then heuristics, then the model for whatever is still below the
auto-accept threshold of 0.9. Suggestions above the threshold are applied;
the rest wait in the queue with the suggestion pre-filled.

New rows are categorised at sync time, so a rule created today applies to
tomorrow's pull without a run.

## Rules

Confirming a row with **always** ticked creates an exact-payee rule
carrying the category, tax category and scope. Rules can also be added by
hand (`POST /api/finances/books/rules`) as `payee`/`description` ×
`exact`/`contains`, matched case-insensitively with whitespace collapsed.
Order of precedence: exact payee, contains payee, exact description,
contains description. Deleting a rule leaves rows it already categorised
untouched.

## Tax categories

Income: `income_gross_receipts`, `income_other`. Expenses: `advertising`,
`car_truck`, `commissions_fees`, `contract_labor`, `insurance`, `interest`,
`legal_professional`, `office_expense`, `rent_lease`, `repairs_maintenance`,
`supplies`, `taxes_licenses`, `travel`, `meals`, `utilities`, `wages`,
`software_subscriptions`, `bank_fees`, `education`, `other_expense`.
Excluded from both: `transfer`, `owner_draw`, `income_tax_payment`,
`personal`. Unknown: `uncategorized`.

Defaults: personal-scope activity is `personal`; a transfer or card payment
is `transfer` in either scope; a business credit is `income_gross_receipts`;
a business debit maps by spend category (dining → meals, fuel → car_truck,
software → software_subscriptions, and so on); a business debit for
groceries, entertainment, health or cash is `uncategorized` so a person
decides rather than the books writing it off.

Scope is the account's business/personal setting unless a rule or a
review sets `scope_override` on the row.

## Tax summary and export

`GET /api/finances/books/summary?period=2026|2026-Q3|2026-08&scope=business`
totals the posted rows in the period by tax category, per currency, in
exact decimal arithmetic: income lines, expense lines (as positive
magnitudes), excluded lines, and per-currency income/expenses/net. It
reports the row count, how many are unreviewed and how many are
uncategorised. This reflects the books as they stand, not an immutable
revision; for a frozen document use the period reports.

`GET /api/finances/books/export?period=2026&scope=business&format=csv|pdf|html|json`
is the CPA pack: the same summary plus every row with its category, tax
category, scope, review state, source and confidence. CSV neutralises
spreadsheet formula prefixes.

## Raw provider payloads

Every provider response is archived exactly as received, encrypted on the
private volume, with a `finance_provider_payloads` row (request window,
class, protocol version, bytes, SHA-256, counts) and a `payload_id` on the
fetch windows it produced. `GET /api/finances/payloads` lists them;
`GET /api/finances/payloads/:id/download` returns the original bytes. A
parser or rule change can always be checked against what the bank actually
sent.

## API

| Route | Purpose |
|---|---|
| `GET /api/finances/books/queue` | Rows to review (`status=unreviewed\|reviewed\|all`, `scope`, `account`, `search`, `start`, `end`, paging) plus the category vocabularies |
| `PATCH /api/finances/books/transactions/:id` | Confirm `{category?, taxCategory?, scope?, note?, createRule?}` |
| `POST /api/finances/books/bulk` | Confirm many `{ids, ...}`; omitting fields accepts each row's suggestion |
| `POST /api/finances/books/categorize` | Queue a categorisation run (`202`) |
| `GET/POST /api/finances/books/rules`, `DELETE …/rules/:id` | Rules |
| `GET /api/finances/books/summary` | Totals by tax category |
| `GET /api/finances/books/export` | CPA pack as csv, pdf, html or json |
| `GET /api/finances/payloads`, `GET …/payloads/:id/download` | Raw provider archive |

## CLI

```bash
coinpay finances books queue --json                    # what needs review
coinpay finances books confirm <tx-id> --category software --tax software_subscriptions --scope business --always
coinpay finances books categorize --wait               # rules → heuristics → model
coinpay finances books rules
coinpay finances books summary --period 2026 --scope business
coinpay finances books export --period 2026-Q3 --format pdf --output ./q3-books.pdf
coinpay finances payloads list
coinpay finances payloads download <id> --output ./raw.json
```

## Configuration

| Setting | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | unset | Enables the model pass. Without it, rules and heuristics only. |
| `FINANCES_CATEGORIZATION_MODEL` | `claude-opus-5` | Model used for suggestions, at low effort, 40 rows per request |
| `FINANCES_MODEL_CATEGORIZATION` | on | `false` disables the model pass even with a key |

## Emailing the pack, and the weekly digest

`POST /api/finances/books/send` (`coinpay finances books send --to cpa@x.com,me@x.com --period 2026`)
emails the CPA pack for a period to up to five addresses: the PDF and CSV
attached (while they total under 8 MiB) plus a download link that needs no
login. The link is a random token stored only as its SHA-256, expires after
`FINANCES_SHARE_LINK_DAYS` (14) days, counts its downloads and can be
revoked. The email body carries the period, per-currency totals and the
unreviewed count, never a transaction. Sending bank data by email is the
merchant's decision, one send at a time. Reports have the same:
`POST /api/finances/reports/:id/send`, `coinpay finances reports send <id> --to …`.

**Weekly digest.** `POST /api/finances/email-schedules` (`coinpay finances
digest set --days mon --hour 6 --to you@x.com`) schedules a digest of the
previous seven days, at the chosen local hour in the finance timezone, to
the recipients. The digest is the week's **activity report** with its
executive summary and charts in the email body and attached, plus the
books pack for the same seven days (totals by tax category in the body,
PDF and CSV attached). The worker turns a due schedule into an
`email_report` job; that job creates the week's report revision under a
stable idempotency key, retries every 30 seconds until the report worker
has rendered it, and then sends once. If the report cannot be generated
(no accounts in scope, or a failed render) the books pack goes out alone
and says why. A mail outage retries rather than losing a week. `digest
send-now` sends one immediately; `digest off` pauses it. The Books page
has the same controls (weekdays, hour, recipients, scope) under Tax summary.

