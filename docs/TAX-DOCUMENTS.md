# Tax documents: California FTB and the IRS

The statement fetcher (see [STATEMENTS.md](./STATEMENTS.md)) also downloads
from the tax agencies. They hold notices, letters and transcripts rather than
bank statements: there is no account and no statement cycle, so what comes
from them is filed into the **document library** (`finance_documents`,
category `tax`), shown on `/finances/history`, and can travel with the CPA pack.

| Key            | Source                    | Sign-in page                              |
|----------------|---------------------------|-------------------------------------------|
| `ftb`          | California FTB (MyFTB)    | https://webapp.ftb.ca.gov/MyFTBAccess/    |
| `irs`          | IRS Online Account        | https://sa.www4.irs.gov/ola/              |
| `irs-business` | IRS Business Tax Account  | https://sa.www4.irs.gov/bola/ (linked from irs.gov/businessaccount) |

These are **standalone sources**: they need no linked SimpleFIN or Plaid
account. Every command that takes a bank takes them too. Their keys are fixed
in the SDK (`TAX_SOURCES`), never derived from a domain. `institutionKey()`
also maps `*.ftb.ca.gov` to `ftb` and `*.irs.gov` to `irs` (both the CLI and
the server), so neither becomes `ca` or collides with a bank.

## Commands

```sh
coinpay login --device                          # or plain `coinpay login` with a local browser
coinpay finances statements banks               # banks, then the tax sources and their throttle state

# Recommended for the IRS, and the simplest for FTB: a window on this
# machine. You sign in by hand; every PDF you download is filed under
# Documents (tax) as it lands. Close the window when done.
coinpay finances statements assist irs
coinpay finances statements assist ftb

# Optional, after a sign-in has been saved (login or assist keeps the Chrome
# profile): look for new notices, letters and transcripts headless.
coinpay finances statements fetch ftb

# CoinPay cloud (Professional plan, free for admins): sign in once in
# CoinPay's cloud browser; fetched weekly after that.
coinpay finances statements cloud connect ftb
coinpay finances statements cloud fetch ftb --wait
coinpay finances statements cloud schedule ftb weekly|off

# The CPA pack with the period's tax documents (8 MiB cap, see below).
coinpay finances books export --period 2025 --with-documents --output cpa-pack-2025.zip
coinpay finances books send --period 2025 --with-documents --to you@example.com   # your own address only

# Tax documents from an agent: the MCP server (`coinpay mcp`) has
# tax_documents_list and tax_documents_get; statements_banks lists the tax
# sources with their throttle state.
```

`books send` never has a default recipient: `--to` is required every time.

## Where tax data may go

Tax documents, and anything about them (deadlines, status, reminders), stay
on CoinPay surfaces: the coinpay CLI, the PWA, the MCP server and the API.
They are not posted, promoted or forwarded anywhere else. By email they go
only to the books owner's own address: `books send --with-documents` refuses
(`400 tax_documents_owner_only`) when any recipient is someone else. To give
them to an accountant, the owner downloads `books export --with-documents`
and shares it themselves.

API: `GET /api/finances/documents?category=tax` lists them,
`GET /api/finances/documents/:id` returns one, `/download` the bytes.

## What is collected

A tax page is collected in **tax mode** (`collectScript('tax')`). The bank
collector skips "tax form", "1099" and notice links on purpose; tax mode is
the opposite. It keeps any visible link or button that

- points at a `.pdf`, or
- is labelled like a document action (notice, letter, transcript,
  correspondence, document, form, 1099, W-2, return, PDF, download, view,
  print, CP/LTR notice numbers) **and** has a date, a year or a notice word in
  its label or row,

and skips account chrome (preferences, settings, help, FAQ, payment, sign
out, chat, surveys). If the page lists nothing, it follows the site's own
"Notices", "Letters", "Correspondence", "Documents", "Records" or
"Transcripts" link once. Clicks are spaced 3 seconds apart, at most 12
documents per run.

Each file is classified (`classifyTaxDocument`) from the link label, its row
and the file name:

- `doc_type`: `transcript`, `notice`, `letter`, `form`, `return` or `other`;
- `tax_year`: from "Tax Year 2024" / "TY 2024", or a lone year on a
  transcript, form or return;
- `period_label`: the tax year, else the notice date (YYYY-MM-DD), else the
  day it was fetched;
- `title`: the link label, or the row text when the label is just "View" or
  "Download".

### Filing

- **Locally** (`fetch`, `assist`): the PDF is archived under
  `~/.coinpay/statements/files/<key>/<tax year or _undated>/` and sent to
  `POST /api/finances/documents` with `category=tax`, `source=fetch`,
  `institutionKey`, `taxYear`, `docType`. Only a bearer (CLI) request may
  claim `source=fetch`. The server keeps one copy per books owner by sha256:
  a repeat answers `200 {duplicate: true}` with the stored document.
  `coinpay finances statements retry` re-files any that failed.
- **In the cloud**: the fetch job calls `createDocument` directly with
  `source=cloud` and the same dedupe.

No account matching or statement period import happens for a tax source.

### Not automated: IRS transcripts

The IRS transcript screens make you choose a transcript type and a tax year
before a PDF exists. That DOM has not been verified against the live site, so
there is **no** selector automation for it. Open the transcripts with
`coinpay finances statements assist irs` and download the ones you want; each
is filed as it lands. TODO: a per-source `steps` hook (choose type + year)
once the real page has been inspected.

## Throttle and lockouts (no exceptions)

Agencies lock an account after a few attempts, and MyFTB restarts its
30-minute lock on any attempt made inside it. So for every tax source:

- at most **2 visits per 30 minutes** and **4 per 24 hours**, per source;
  `login`, `assist`, `fetch`, cloud `connect` and cloud fetch jobs all count;
- the visit is counted **before** it is made; a refusal is not a visit;
- a **lockout page** ("Account locked", "exceeded the allowed number of
  attempts", "too many attempts", …) is detected from the page text, during
  a fetch and while a person drives a login/assist window or a cloud sign-in.
  It is recorded with its end: the duration the page names plus 5 minutes,
  else 35 minutes for FTB and 60 for the IRS. Nothing is attempted before
  then. `--force` does not lift it (it only concerns the local Chrome profile);
- credentials and codes are **never** entered or re-submitted by CoinPay. A
  lost session is reported ("sign in again, when you are ready"), never retried.

Where it is kept:

- locally: `~/.coinpay/statements/throttle.json`
  (`{sources: {ftb: {attempts: [{at, kind}], lockedUntil, lockReason}}}`).
  A corrupt file refuses every visit until it is fixed or removed;
- server side: `finance_site_attempts` (`connect`, `fetch`, `lockout` rows).
  A throttled cloud connect answers `429 site_throttled` or `site_locked`; a
  throttled fetch job is re-queued for the moment the next visit is allowed.

A locked run is reported to the fetch-run history as `error` with the
lockout message.

## Bot checks

CoinPay does not solve CAPTCHAs, Turnstile or any other bot check and adds no
stealth evasion. The IRS signs in through **ID.me, which sits behind
Cloudflare**; it often refuses datacenter addresses, so a CoinPay cloud
sign-in for `irs` / `irs-business` may never load. Cloud connect is still
allowed and answers with a `warning`; the PWA asks before opening it. The IRS
default is `coinpay finances statements assist irs` on your own computer,
headed, with you signing in.

## The CPA pack with tax documents

- `GET /api/finances/books/export?...&with_documents=1` answers a ZIP
  (stored, uncompressed): the books file, `tax-documents/*.pdf`, and
  `MANIFEST.txt`. Headers `X-Documents-Attached` and `X-Documents-Skipped`.
- `POST /api/finances/books/send` with `withDocuments: true` attaches them to
  the email, to the owner's own address only; the answer's `documents` lists
  `attached` and `skipped`, and the email names what was left out.

A document belongs to the period by `tax_year` (any year the period touches),
else by a year or date `period_label`, else by the day it was added. Both
paths share the email's **8 MiB** budget with the books files: documents are
added oldest tax year first, anything that does not fit is skipped (the rest
still go in) and named in the manifest or the email.

## Schema

Migration `20261005090000_finance_tax_document_sources.sql`:

- `finance_documents.source` allows `fetch` and `cloud`; new nullable
  `institution_key`, `tax_year`, `doc_type`; index on
  `(merchant_id, category, tax_year)`;
- unique `(merchant_id, sha256)`, or, where duplicate uploads already
  exist, the same index limited to `source in ('fetch','cloud')`;
- `finance_site_attempts` (RLS on, service role only).

Apply the migration before deploying this code: the document queries select
the new columns.
