# Implementation and activation tasks

Source: `prd/0001-coinpay-lending-quickbooks-sync.md`. Every task below is unfinished. Specification preparation and structural validation do not complete implementation or external approval tasks. Complete a task only with reviewable evidence; passing a stage does not enable later capabilities.

## 1. Stage 0 — repository and policy foundation

- [ ] 1.1 Reconcile the current finance, legal-entity, permission, data-access/auth, migration, job, routing, SDK/CLI and MCP boundaries; confirm the self-hosted PostgreSQL target without a wholesale rewrite. (R1, R41)
- [ ] 1.2 Implement the capability/evidence directory, exact profile/product/geography/rail checks, evidence expiry/revocation and shared unavailable-by-default evaluation; keep YouLend research-only. (R2, R3, R4, R6, R7, R47; A11, A17, A19)
- [ ] 1.3 Implement purpose/recipient/field-specific consent, legal-entity/account/company mappings, revocation enforcement, approval invalidation and tenant isolation. (R9, R10, R12, R42, R44)
- [ ] 1.4 Extend the existing SimpleFIN adapter with explicit v2-first capability requests, labeled v1 policy, malformed-v2 rejection, upstream identity namespaces and version-specific fixtures. (R8, R22; A18)
- [ ] 1.5 Verify backend setup-token claiming, encrypted credentials, URL/DNS/private-address/redirect/SSRF controls and secret-free logs/CLI/MCP responses. (R9, R40, R44)
- [ ] 1.6 Add retained coverage and exact-money source normalization; distinguish missing history, pending rows and verified zero, including first-total coverage copy. (R11, R22, R26; A03, A10, A18)
- [ ] 1.7 Implement economic-event/source links, cross-source lifecycle deduplication, reviewed exclusions, fees/refunds and crypto business-purpose evidence. (R21, R24; A06, A07, A12)
- [ ] 1.8 Implement versioned revenue snapshots with entity, period/timezone, gross/net basis, coverage, rules, FX and lineage; corrections create reviewed new versions. (R23, R39, R43; A10)
- [ ] 1.9 Build `/lending` waitlist, nonbinding provider inquiry, privacy/retention handling, honest availability/FAQ copy and the labeled illustrative calculator; test mobile/desktop accessibility and light/dark contrast. (R2, R25, R26, R45, R47; A01, A02)
- [ ] 1.10 Establish provider polling ceilings, per-tenant quotas, cost controls, paid-check approval, retention/legal-hold policy and privacy-safe stage/cohort instrumentation. (R45, R48)

## 2. Stage 0 — QuickBooks sandbox and review

- [ ] 2.1 Validate current Intuit operations, terms and permitted data uses; implement sandbox OAuth with entity/realm binding, rotating encrypted credentials, CSRF/state handling, and remote-terminal HTTPS authorization. (R12, R13)
- [ ] 2.2 Implement company/account mappings and local accounting roles; create immutable hashed posting plans with amounts, currencies, dates, fees, tax, confidence and source/mapping versions. (R10, R14, R42)
- [ ] 2.3 Implement validated typed accounting operations and exceptional accountant-approved journal entries without claiming native bank-feed delivery. (R15)
- [ ] 2.4 Implement identity constraints and matching against existing QuickBooks entries; send ambiguous matches to review. (R16; A06, A08)
- [ ] 2.5 Build the review/history workspace with per-item approval, conflict, partial-batch, reauthorization and independent accounting status. (R14, R17, R20; A09, A20)
- [ ] 2.6 Implement a PostgreSQL transactional outbox and serialized publisher with supported idempotency, uncertain-write reconciliation, external concurrency tokens, closed-period protections and bounded retries. (R16, R17, R44; A08, A09)
- [ ] 2.7 Review ordinary, borrowing and receivables-purchase/RBF mapping templates with an accountant; separate principal, charges, fees and settlement differences. (R18; A07)
- [ ] 2.8 Demonstrate sandbox publishing, consent revocation, realm/tenant isolation, hash/approval invalidation, token expiry, partial batches, unknown commit and external-edit recovery. (R13–R20, R42, R44, R48; A06–A09, A19, A20)

## 3. Stage 1 — approved accounting release

- [ ] 3.1 Add PWA, API, ESM SDK/declarations, both installed CLI paths and minimal MCP bindings to the shared accounting services; verify `--no-browser`, previews and approved-only execution. (R13, R14, R41, R42)
- [ ] 3.2 Obtain production Intuit entitlement, data-use/retention review, accountant-approved mappings and read/write permission evidence. (R12–R15, R18, R45)
- [ ] 3.3 Pass applicable financial correctness/security tests; publish recovery owners/runbooks and independently enable accounting reads/writes with financing gates unchanged. (R2, R16–R20, R44, R48; A08, A09, A19, A20)

## 4. Stage 2 — partner financing engineering

- [ ] 4.1 Implement versioned provider eligibility, trading-history/document criteria and explainable readiness; unknown/low revenue never fabricates an offer or sends hidden applications. (R11, R23, R27, R43; A03, A10)
- [ ] 4.2 Implement draft and named-provider submission with separate KYB/KYC, disclosure, bureau/credit-check, recurring-monitoring and application consents. (R12, R28, R41, R42; A16)
- [ ] 4.3 Render complete provider-sourced versioned offers and disclosures; build bound acceptance/signing intents with reauthentication, expiry, terms-change handling, and distinct guarantee/drawdown approvals. (R28, R29, R42)
- [ ] 4.4 Implement normalized application/agreement states preserving provider status; acceptance cannot become active without verified provider/rail funding evidence. (R3, R30)
- [ ] 4.5 Implement verified provider webhooks/inbox, deduplication, replay/order checks and auditable outbox transitions. (R30, R44, R48)
- [ ] 4.6 Implement exact contract-defined remittance assessments, locked cap reservations and durable collection identities; unknown outcomes retain reservations and confirmed failures reconcile them. (R25, R26; A01–A05)
- [ ] 4.7 Integrate only a separately approved collector/rail with financing-specific mandates; test returns, duplicate requests, disputes, refunds, late settlement and overcollection boundaries. (R31, R32, R44, R48; A04, A05)
- [ ] 4.8 Build agreement/servicing views with separate assessed/pending/settled/returned amounts, cap, adjustments and accounting health, plus hardship/reconciliation and provider-support paths. (R20, R30, R32; A20)
- [ ] 4.9 Expose readiness, draft/approval-request, offer and remittance operations through all interfaces; verify agent self-approval is rejected and declines never auto-submit to another provider. (R28, R41, R42; A16)

## 5. Stage 2 — external program and activation evidence

- [ ] 5.1 Execute a suitable provider agreement identifying legal parties, source of external capital, underwriting, funding, servicing, support and alternative payment responsibilities. (R3, R4, R32)
- [ ] 5.2 Review actual reserves, prefunding, repurchase, guarantees, indemnities, clawbacks, minimums and operating costs; reject CoinPay principal/first-loss/credit-return exposure. (R5, R45; A17)
- [ ] 5.3 Verify the exact financing product/obligation, profile, jurisdiction and SimpleFIN route before recommendation/opening; establish actual-customer verification after opening and expiry/retest handling with no API/bank/crypto/referral waiver. (R6, R7; A11)
- [ ] 5.4 Obtain data-use rights for underwriting/monitoring and provider acceptance of source provenance and reviewed supplemental evidence. (R4, R12, R23)
- [ ] 5.5 Obtain qualified counsel's written assessment for actual provider/CoinPay roles, jurisdictions, disclosures, licensing/exemptions, collection, privacy and credit/reporting duties. (R28, R29, R43, R46)
- [ ] 5.6 Record approved funding/collection permissions and mandates, accountant templates, contingency servicing, dispute ownership and incident procedures. (R18, R31, R32)
- [ ] 5.7 Pass applicable A01–A11, A16–A20 and additional R48 failure cases; attach evidence and separately activate applications, acceptance and fiat funding only for the verified pilot scope. (R2, R30, R44, R47, R48)

## 6. Stage 3 — stablecoin pilot

- [ ] 6.1 Select and verify one native stablecoin/chain with product/account SimpleFIN qualification, provider support and an external direct or approved third-party settlement route; separately accept any conversion quote. (R6, R7, R33; A11, A19)
- [ ] 6.2 Implement distinct denomination/funding/remittance asset fields and the asset subledger with contract/decimals, valuation source/time, fees and reviewed base-currency/FX/gain-loss accounting. (R19, R22, R33)
- [ ] 6.3 Implement asset/destination allowlists, wallet-control and screened identity evidence, nonce/expiry-bound signed intent, limits, replay protection and quote revalidation. (R34, R40, R42)
- [ ] 6.4 Review actual wallet/escrow keys, recovery/admin/upgrade/pause authority and value flow; prohibit pooled CoinPay custody or unrestricted wallet spending. (R35)
- [ ] 6.5 Implement chain-specific finality and reorg recovery, refunds and depeg/freeze/outage policy; a hash or testnet success cannot activate funding. (R30, R34, R48; A13)
- [ ] 6.6 Implement minimized business-purpose crypto evidence and signed revenue attestation/challenge provenance with sensitive information off-chain. (R24, R39, R40; A12)
- [ ] 6.7 Obtain crypto-specific legal, screening, settlement, control/security and accounting evidence; pass A12, A13, A19 and applicable R48 cases before enabling only the approved production route. (R19, R34–R35, R40, R46, R48)

## 7. Stage 4 — permissioned P2P

- [ ] 7.1 Obtain a reviewed origination/servicing/offering/intermediary/compensation structure and verified participant criteria before solicitation or investment commitments. (R36, R46)
- [ ] 7.2 Implement and verify one qualified external-funder deal with separate human investment approval, actual funding receipts, existing product/account qualification and the approved settlement operator. (R3, R6, R28, R36, R42)
- [ ] 7.3 After the single-funder route works, implement per-deal commitments, allocations, deadlines, minimum funding conditions and approved-operator unused-fund returns; distinguish committed from received capital. (R37; A15)
- [ ] 7.4 Implement exact-share/waterfall rounding, durable one-time distributions, realized collections reporting, losses, arrears and illiquid remaining exposure without guaranteed yield or redemption. (R38; A14)
- [ ] 7.5 Obtain separate legal/control review and independent security audit for any production smart contract; pass underfunding, rounding, replay and loss/default reporting tests. (R35–R40, R46, R48; A14, A15)
- [ ] 7.6 Activate only the evidenced permissioned scope and update shared public/API/CLI/MCP status without introducing retail “lend now,” token or guaranteed-return marketing. (R2, R36, R47)

## 8. Every applicable release — evidence and operations

- [ ] 8.1 Exercise all applicable fixtures in `traceability.md`, plus FX/decimal errors, stale/partial sources, tenant collisions, expired/revoked consents, changed offers/mappings, OAuth expiry, partial/uncertain writes, external edits, webhook ordering, returns, reorgs, underfunding and losses. (R48)
- [ ] 8.2 Verify append-only permissions and separate integrity retention, secret-free audit/correlation, reconciliation/dead-letter ownership, recovery procedures and alternative servicing access during outages. (R32, R40, R44)
- [ ] 8.3 Verify budget/paid-check controls, actual provider costs and fee disclosures, data deletion/legal holds, approved data-use purposes and privacy-safe research/sandbox/live metrics. (R5, R12, R29, R45, R46)
- [ ] 8.4 Check shared capability copy across public pages, structured data, pricing, CLI, API, MCP and notifications; disabled or expired evidence must never leave a live transaction CTA. (R2, R47)
- [ ] 8.5 Review capability rollback with retained history, unresolved-effect reconciliation and ongoing borrower support; attach current legal/accounting/security/provider evidence before each applicable live gate. (R2, R17, R20, R32, R46, R48)
