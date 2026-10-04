# Public invoice snapshots

`GET /api/invoices/{uuid}/pdf` downloads a one-page snapshot for a sent, overdue,
or paid invoice. Draft, cancelled, unknown and missing invoices return the same
404. Eligibility is rechecked on each request; already downloaded copies cannot
be revoked. No invoice, payment, email or settlement action is performed.

The PDF includes only invoice number, issuer business name, stored fiat total,
currency, status, creation/due dates, generation time and the canonical `/now/`
link. Notes, client details, wallet addresses, fees and crypto quotes are excluded.
It is not a receipt and a `paid` status is not proof of forwarding funds.

The origin comes from runtime `INVOICE_PUBLIC_ORIGIN` or build-time
`NEXT_PUBLIC_APP_URL`, never request headers. At least one must be configured;
there is no production-domain fallback for staging/self-hosted installs. Configure a
root HTTPS origin (HTTP localhost is accepted outside production). The bundled
Noto Sans font and license must be shipped; Next's route tracing includes the
font. No network font, HTML, image or user-controlled file is loaded.

Latin (including Vietnamese), Greek and Cyrillic labels are supported when every
glyph exists in the bundled font. Control/format characters, unsupported scripts
or glyphs, labels over 240 characters, oversized layouts and malformed financial
data fail closed with 503 and a live-invoice fallback. Totals are positive,
at most 12 integer digits and 2 fractional digits, with a recognized ISO currency.
They are printed without rounding or recalculating fees. Other scripts and larger
totals require a separately tested rendering extension, not silent substitution.
Some labels below the character cap can still exceed layout limits. Stored amounts
use the invoice schema's two decimal places even for currencies normally displayed
with zero or three; no currency conversion is performed. Failures log only a
structured reason code, not invoice IDs, contents, addresses or raw exceptions.

Deploy and verify this endpoint before enabling `githubInvoices.pdfEnabled` in
CoinPayBot. This produces a download link, not a GitHub attachment. The bot's
checkout flow must remain usable while PDF support is disabled or unavailable.

## Verification

Run `pnpm test -- src/app/api/invoices` with `pdftotext` available (the
`poppler-utils` package on Debian/Ubuntu). CI fails rather than skips the real
PDF text/privacy check when the reader is missing. Local runs without the reader
report that one test as skipped; do not treat that as complete PDF verification.
Next build tracing must include `public/fonts/invoices/NotoSans-Regular.ttf` in
`.next/server/app/api/invoices/[id]/pdf/route.js.nft.json`.
