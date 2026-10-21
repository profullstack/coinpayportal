# Changelog

All notable changes to `@profullstack/coinpay` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.23.0] - 2026-10-21

### Added
- `createPayment({ successUrl, cancelUrl })`, like Stripe Checkout: once the payment confirms, the
  hosted pay page sends the customer to `successUrl` (`{PAYMENT_ID}` is replaced with the payment id);
  `cancelUrl` is the "Back to merchant" link from an expired checkout. Before this the crypto checkout
  had no way to return the buyer and left them on "Payment Complete!".

## [0.22.0] - 2026-10-19

### Added
- `coinpay document publish <dir> --business-id <id>`: encrypt and publish a whole directory, keeping
  its structure (under a folder named like the directory, or `--folder dest`, `--folder /` for the top
  level). Publishing again syncs: new files upload, changed files become a new version, unchanged files
  are skipped, signed documents are left alone, nothing remote is deleted. `--dry-run` shows the plan;
  hidden files and `node_modules` are skipped unless `--include-hidden`.
- `coinpay document move <id> <folder>`; `upload --folder a/b`; `list` shows folders.
- Any file type can be uploaded (unknown types are opaque downloads; the server only holds ciphertext).
- SDK: `publishDirectory`, `planPublish`, `moveDocument`; `uploadDocument({ folder })`.

## [0.21.0] - 2026-10-19

### Added
- Documents, end-to-end encrypted: `coinpay document vault-setup|list|upload|share|get|link|revoke|download|void|delete`.
  Files are encrypted on your machine (AES-256-GCM, one key per document, wrapped under the
  business vault key, which is wrapped under a PBKDF2 passphrase); CoinPay stores only ciphertext.
  `share` adds signers and viewers and prints each full link with its `#k=` key; the invite
  emails omit the key unless `--email-key`. `download` decrypts and verifies the sha256.
  Invites can be signers, editors (upload new versions) or viewers (`--signers/--editors/--viewers`).
  Every version is kept: `versions <id>`, `new-version <id> <file>`, `download --revision N`.
- SDK: `listDocuments`, `getDocument`, `setupDocumentsVault`, `unlockDocumentsVault`,
  `uploadDocument`, `shareDocument`, `newDocumentLink`, `revokeDocumentRecipient`,
  `voidDocument`, `deleteDocument`, `downloadDocument`, `listDocumentVersions`, `uploadDocumentVersion`.
- MCP: `document_list`, `document_get`, `document_void` (metadata only; no keys).

## [0.19.0] - 2026-10-17

### Added
- Contractors: `coinpay contractor list|add|get|link|offboard|contract|send|end|pending|approve|reject|bonus|expense|1099`.
  Invite a contractor (they get a private portal to add a payout wallet, file a W-9 or W-8,
  sign contracts and submit hours, milestones and expenses), contract fixed, hourly or
  milestone work, approve submissions, and see who needs a 1099-NEC.
- Pay runs: `coinpay payrun list|create|get|pay|record|delete`. A run collects fixed fees
  that are due plus approved work, one line per contractor. `pay <id> --yes` sends from the
  business payout wallet (signed-in owner only); `record` logs a payment made from your own wallet.
- SDK: `listContractors`, `addContractor`, `createContract`, `sendContract`, `reviewWorkItem`,
  `createPayRun`, `payPayRun`, `recordPayRunPayments`, `get1099Summary` and friends.
- MCP: `contractor_list`, `contractor_get`, `contractor_work_list`, `contractor_work_review`,
  `pay_run_list`, `pay_run_get`, `pay_run_draft`, `contractor_1099_summary`. None of them sends money.

## [0.18.0] - 2026-10-17

### Added
- Projects and time tracking: `coinpay project list|create|get|invoice`,
  `coinpay time log|start|stop|list`. `project invoice` bills unbilled
  billable time as a draft itemised invoice; billed time is locked.
- `coinpay invoice aging`: unpaid sent invoices by days past due, per
  currency and per client.
- `coinpay invoice settings`: reminder schedule (`--reminders "-3,0,7"`),
  late fee (`--late-fee 1.5%` or `25`, `--late-fee-after 3`) and branding
  (`--brand-color`, `--logo-url`, `--footer`).
- `coinpay client portal-link <id>`: one link where a client sees and pays
  all their invoices; `--revoke` turns it off.
- MCP: `invoice_list`, `invoice_get`, `invoice_create_draft`,
  `invoice_ar_aging`, `project_list`, `project_get`, `time_log`,
  `project_invoice_time`.
- SDK: `getArAging`, `getInvoiceSettings`, `updateInvoiceSettings`,
  `createClientPortalLink`, `revokeClientPortalLink`, `listProjects`,
  `getProject`, `createProject`, `logTime`, `startTimer`, `stopTimer`,
  `listTimeEntries`, `invoiceProjectTime`.

### Fixed
- A flag value that starts with a minus and a digit (`--reminders -3,0,7`)
  is read as the value instead of as another flag.

## [0.17.0] - 2026-10-17

### Added
- Itemised invoices: `createInvoice` / `updateInvoice` take `lineItems`
  (description, quantity, unit price, optional tax rate) and a `discount`
  (`percent` or `fixed`, applied before tax). The server computes the total;
  `amount` is only for single-amount invoices.
- `coinpay invoice create --item "Desc|qty|price[|tax %[|tax name]]"`
  (repeatable) and `--discount 10%` / `--discount 25`.
- Saved products/services and tax rates: `coinpay item list|create|delete`,
  `coinpay tax-rate list|create|delete`; SDK `listInvoiceItems`,
  `createInvoiceItem`, `deleteInvoiceItem`, `listTaxRates`, `createTaxRate`,
  `deleteTaxRate`.

## [0.16.0] - 2026-10-12

### Added
- `coinpay finances due [--days 7]`: what is due, overdue or not posted yet
  across every linked account, projected from each recurring charge's own
  cadence plus statement due days set on cards and loans.
- `coinpay finances recurring`: every recurring charge with cadence, last and
  next date and monthly cost.
- `coinpay finances due-day <account-id> <1-31|clear> [--amount N|balance]`:
  a card or loan's statement due day, which no bank feed carries.
- `coinpay finances daily [show|on|off|send-now]`: the daily summary email
  (due soon, new activity since the last one, balance sheet).
- MCP: `finance_due_soon`, `finance_recurring`, `finance_summary`,
  `finance_transactions`, `finance_set_due_day`, `finance_daily_summary`.
- SDK: `getDueSoon`, `getDailySummary`, `setDailySummary`,
  `deleteDailySummary`, `sendDailySummaryNow`, `setAccountDueDay`.

### Fixed
- `coinpay mcp` `tools/list` now carries `resultType`, `ttlMs` and
  `cacheScope`; without them Claude Code rejected the whole list
  ("connected · tools fetch failed").

## [0.15.0] - 2026-10-07

### Added
- Brokerage sources, starting with `webull` (Webull E-Documents). Like the tax
  sources they need no linked account: `coinpay finances statements
  login|assist|fetch webull` and `statements cloud connect|fetch|schedule
  webull`. A new `documents` collector mode keeps dated statements and trade
  confirmations and 1099s listed by tax year (the bank collector skips 1099s).
  Monthly statements and confirmations are filed into the document library as
  category `statement` with their month (a confirmation with its day); 1099,
  1042-S and 5498 forms as category `tax`, type `form`, with the tax year. One
  copy per file; `statements retry` re-files failures. Brokerages are not
  throttled like the agencies. If SimpleFIN ever links a Webull account, it
  keeps the bank path (statements matched to the account).
- MCP `statements_banks` lists `brokerages`; statements engine exports
  `BROKERAGE_SOURCES`, `brokerageSource`, `isBrokerageSource`, `sourceMode`,
  `classifyBrokerageDocument`, `keepBrokerageDocument`, `COLLECT_DOCS`,
  `OPEN_DOCUMENTS`.

## [0.14.0] - 2026-10-05

### Added
- Tax document sources: `ftb` (California FTB, MyFTB), `irs` (IRS Online
  Account) and `irs-business` (IRS Business Tax Account). They need no linked
  bank: `coinpay finances statements login|assist|fetch <source>` and
  `statements cloud connect|fetch|schedule <source>` take them. Notices,
  letters and transcripts are collected in a tax mode (the bank collector
  still skips them) and filed into the document library as category `tax`,
  with tax year, document type and the source key; one copy per file.
- Attempt throttle for tax sources: at most 2 visits per 30 minutes and 4 per
  day, counted before the visit, lockout pages detected and respected (no
  override), credentials never re-entered. Ledger at
  `~/.coinpay/statements/throttle.json`.
- `coinpay finances books export --with-documents` (a ZIP with the period's
  tax documents and a manifest) and `books send --with-documents` (to the
  account owner's own address only), within 8 MiB; what does not fit is listed.
- MCP: `tax_documents_list`, `tax_documents_get`; `statements_banks` lists the
  tax sources with their throttle state. API: `GET /finances/documents?category=`
  and `GET /finances/documents/:id`; SDK `getFinanceDocument`.
- SDK: `uploadFinanceDocument`, `listFinanceDocuments`; statements engine
  exports `TAX_SOURCES`, `standaloneSources`, `withStandaloneSources`,
  `keepCandidate`, `collectScript`, `classifyTaxDocument`, `keepTaxDocument`
  and the throttle helpers (`evaluateThrottle`, `detectLockout`, …).

### Fixed
- `coinpay auth login` is the OAuth 2.1 sign-in the help always advertised
  (`--device` works); `--email/--password` keeps the old password path with a
  deprecation note.
- `coinpay self update|upgrade|remove|uninstall` now work as listed in the help
  (the top-level forms still do). `coinpay mcp` is listed on its own.
- `institutionKey` maps `*.ftb.ca.gov` to `ftb` (was `ca`) and `*.irs.gov`
  to `irs`.

## [0.13.0] - 2026-10-04

### Added
- `coinpay login` signs in with OAuth 2.1: authorization code + PKCE over a
  loopback redirect, as the public `coinpay-cli` client, with single-use
  refresh tokens rotated before any command whose access token is about to
  expire. `coinpay login --device` keeps the device flow for SSH.
- `coinpay finances statements cloud [status|connect|fetch|schedule|forget]`:
  CoinPay cloud statement fetching (Professional plan, free for admins).
  `connect` opens CoinPay's cloud browser to sign in to the bank once; CoinPay
  keeps the bank's session sealed and fetches every week.
- MCP: `statements_cloud_status`, `statements_cloud_fetch`.
- `@profullstack/coinpay/statements` export with types; `openBrowser` takes
  `extraArgs` and `handleSignals`; `CoinPayClient#baseUrl` getter.

### Fixed
- The statement fetcher no longer attaches to Chrome's own omnibox page.

## [0.12.1] - 2026-10-04

### Fixed
- `coinpay finances statements login|fetch|assist` no longer reports "profile is
  open in another Chrome" after an interrupted run. A lock left by a process
  that is gone, or now belongs to another program, is removed. Our own leftover
  headless Chrome is stopped. A visible window is closed only with `--force`.
  Ctrl+C or a crash now takes the Chrome it started down with it.

## [0.12.0] - 2026-10-04

### Added
- `coinpay finances statements banks|login|fetch|assist|coverage|runs|local|retry`:
  download the original PDF statements behind every linked account from the
  banks themselves (SimpleFIN has none) and import them into the statement
  library with their account and period. Bank sessions stay in local Chrome
  profiles; `fetch` exits 3 when a bank needs signing in again.
- `coinpay mcp`: a stdio MCP server with finance and statement tools,
  including `statements_fetch`.
- SDK: `reportStatementFetchRun`, `listStatementFetchRuns`, `getStatementCoverage`.

## [0.11.2] - 2026-09-16

### Added
- Invoice creation and due dates remain visible in the finance TUI table;
  selected invoices show created, due, sent and paid dates in the detail panel.
- Right-side details for selected accounts, ledger rows, crypto and card
  payments, invoices, escrows and debt accounts.

### Fixed
- Row clicks select the correct record after scrolling or resizing. Keyboard
  navigation follows the last selected invoice or escrow table.

## [0.11.0] - 2026-09-12

### Added
- `coinpay finances books queue|confirm|confirm-all|categorize|rules|summary|export|send`:
  every transaction auto-categorised (rules, heuristics, and Claude when the
  server has a key) with a review queue, an "always" flag that turns a
  correction into a rule, a tax summary by year/quarter/month in exact
  arithmetic, and the CPA pack as CSV/PDF/HTML/JSON.
- `coinpay finances payloads list|download`: every raw provider response,
  exactly as received.
- `coinpay finances reports send <id> --to …` and `books send --to …`: email
  a report or the pack with attachments plus an expiring no-login link.
- `coinpay finances digest set|show|off|send-now`: a weekly digest on chosen
  weekdays at a chosen local hour.
- `coinpay finances consent <id> on|off`: opt a connection into the
  30-minute background sync.
- SDK: `finances-reports` gained the books, payloads, email and digest
  functions with declarations.

## [0.10.0] - 2026-09-12

### Added
- `coinpay finances report`: monthly, quarterly and custom-period activity
  reports generated server-side from an immutable snapshot, downloadable as
  PDF, HTML, CSV or JSON (`--period 2026-08`, `--period 2026-Q2`, or
  `--from/--to` with an exclusive end; `--account`, `--scope`, `--timezone`,
  `--format`, `--output`, `--strict`, `--wait`, `--json`). Every report
  states that it was generated by CoinPay from imported account data and is
  not an institution-issued statement, and carries `local_export_complete`,
  `provider_coverage` and `reconciliation_status`.
- `coinpay finances backfill`, `jobs`, `coverage`: durable, resumable
  calendar-period fetches in provider-safe chunks, with per-account coverage
  derived from what was actually requested.
- `coinpay finances statements import|list|get|download|reconcile|delete`:
  keep original bank statements (PDF, user supplied, never parsed) beside an
  account and period, and check their balances against a report revision
  with exact decimal arithmetic.
- `coinpay finances connect` (setup token prompted without echo or via
  `--setup-token-stdin`), `disconnect`, `consent <id> on|off`.
- SDK: `finances-reports` module (`createFinanceReport`, `waitForFinanceReport`,
  `downloadFinanceReport`, `createBackfillJob`, `getFinanceCoverage`,
  `importFinanceStatement`, `reconcileFinanceStatement`, ...), and
  `CoinPayClient.requestBinary()` / `requestForm()` for downloads and uploads.
- Exit codes for the new subcommands: 0 done or job accepted, 2 invalid
  input, 3 strict/completeness rejection, 4 authentication, 5 provider or
  storage failure. In `--json` mode stdout carries only the result.

### Fixed
- `listAllFinanceTransactions` now forwards `endDate`.

## [0.9.0] - 2026-09-05

### Added
- `coinpay finances` (aliases `coinpay money`, `coinpay tui`): a live terminal
  dashboard built on `@profullstack/hqtui`. Seven screens — Overview, Bank &
  Cards, Ledger, Crypto, Cards, Invoices & Escrow, Debt & Income — showing
  gross volume, commission
  paid, processor fees, refunds, net earnings, bank assets and liabilities,
  cashflow, credit-card balances from the SimpleFIN/Plaid feeds, the ledger,
  crypto and card payment tables, invoices outstanding/overdue and escrow held.
  Refreshes on a timer and subscribes to the payments SSE stream so crypto
  payment events appear live. `s` syncs the bank feed on demand.
- **Debt & Income** screen (`7`), and `coinpay finances position` (aliases
  `debt`, `income`) as text. Income against spending per month, credits against
  debits, total owed split into revolving and instalment, months to clear each
  balance at its current payment rate, debt-to-income, debt-service ratio,
  months of cover, card utilisation, detected recurring bills with their next
  due date, and a business-versus-personal split of all of it — so the same
  feed reads for a company or a person.
  Transfers and card payments are excluded from both income and spending: a
  feed holding both a checking account and the card it pays counts every card
  payment twice otherwise. The raw sides remain visible as gross credits and
  gross debits.
  Built from about six months of history rather than the dashboard window,
  because a monthly charge is invisible in thirty days of rows, and averaged
  over the history that exists rather than the history requested.
- `coinpay finances scope <account-id> <business|personal|clear>`, and a `Side`
  column on the accounts table. Which set of books an account belongs to was a
  guess from its name, which reads "Business Checking" correctly and is blind to
  a personal card carrying company spend. The correction is now stored in
  `finance_accounts.scope_override`, wins over the guess, and survives a re-sync
  — the same contract as `kind_override`. An overridden account is marked with a
  trailing `*`, so a wrong split is traceable to a guess rather than a decision.
- Plain-text `coinpay finances summary|accounts|ledger|connections|sync`
  (`--json` on all of them) for scripts and for Node older than 22.6.
- SDK `finances` module, also importable as `@profullstack/coinpay/finances`:
  `getFinanceSummary`, `listFinanceAccounts`, `listFinanceTransactions`,
  `listFinanceConnections`, `syncFinances`, `getDashboardStats`,
  `getFinanceAnalytics`, `listCryptoPayments`, `listCardTransactions`,
  `listCardPayouts`, the pure `buildFinanceSnapshot()`, `collectFinanceSnapshot()`
  and `subscribeToPayments()` (SSE with reconnect).

### Changed
- New dependency `@profullstack/hqtui` (zero runtime deps of its own). The
  dashboard needs Node 22.6+; every other command still runs on Node 20.

## [0.6.11] - 2026-03-19

### Added
- OAuth client management methods: `listOAuthClients()`, `createOAuthClient()`, `getOAuthClient()`, `deleteOAuthClient()`
- CLI `coinpay oauth` commands: `list`, `create`, `get`, `delete`
- OAuth section in SDK documentation

## [0.2.0] - 2025-01-15

### Added
- `waitForPayment()` method for polling payment status until completion
- `getPaymentQRUrl()` method (synchronous URL builder)
- `getPaymentQR()` method for fetching QR code as binary `ArrayBuffer`
- `getExchangeRate()` and `getExchangeRates()` for price lookups
- Business management methods: `createBusiness`, `getBusiness`, `listBusinesses`, `updateBusiness`
- Webhook management: `getWebhookLogs`, `testWebhook`
- TypeScript type declarations (`.d.ts` files) for all modules
- Comprehensive SDK documentation and API reference
- Usage examples for all major features
- `CHANGELOG.md`

### Changed
- Renamed `Cryptocurrency` constant to `Blockchain` (`Cryptocurrency` is still exported as a deprecated alias)
- Improved `package.json` for npm publish readiness (added `types`, `homepage`, `bugs`, keywords)

## [0.1.0] - 2024-12-01

### Added
- Initial SDK release
- `CoinPayClient` class with `createPayment`, `getPayment`, `listPayments`
- Standalone helper functions: `createPayment`, `getPayment`, `listPayments`
- Constants: `Blockchain`, `PaymentStatus`, `FiatCurrency`
- Webhook utilities: `verifyWebhookSignature`, `generateWebhookSignature`, `parseWebhookPayload`, `createWebhookHandler`
- `WebhookEvent` constants
- CLI tool (`coinpay`) for command-line payment management
- Support for BTC, BCH, ETH, POL, SOL, USDC_ETH, USDC_POL, USDC_SOL
