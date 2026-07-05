# PRD: CoinPay Browser Extension

**Version:** 0.2 (Draft)
**Date:** July 5, 2026
**Status:** Proposal
**Platforms:** Chromium (Chrome, Edge, Brave) and Firefox

> **Changelog v0.1 → v0.2 (July 5, 2026):** Corrected §4/§9 after verifying claims against `profullstack/coinpayportal@master` (commit `d54fe39`) and the published `@profullstack/coinpay` SDK (v0.6.11). Three findings drove material changes: (1) chain-specific transaction **signing is not reusable SDK code** — the published SDK's high-level `send()` signing is a non-functional stub, and the only real signer is hand-rolled, Node-dependent code inside the web app, not the npm package; (2) the SDK's x402 helpers are all **merchant/facilitator-side** — the payer-side flow the extension needs is entirely greenfield, and native (BTC/SOL) methods use a **non-standard `exact` scheme**; (3) all web-wallet API rate limits are **per-IP** (answers Open Question #6). Requirements P0-2/4/6/7/8/10, the technical approach, timeline, and open questions were updated accordingly. Original v0.1 claims that survived verification are retained.

---

## 1. Problem Statement

CoinPay ([coinpayportal.com](https://coinpayportal.com)) offers a non-custodial multi-chain web wallet and is the only x402 facilitator supporting BTC, ETH, SOL, POL, BCH, USDC, Lightning, and Stripe — but users have no way to hold a persistent wallet in their browser, approve x402 (HTTP 402) payments in-context, or pay sites without navigating to the web app. As x402-paywalled APIs and content proliferate, users and AI-agent operators need a lightweight, always-available signer. Without an extension, CoinPay cedes this surface to MetaMask/Phantom, neither of which supports CoinPay's multi-chain x402 flow, and users abandon 402 paywalls that have no one-click payment path.

## 2. Goals

1. **Ship a cross-browser wallet extension** (single MV3 codebase) that lets a user create/import a CoinPay wallet and send/receive on all supported chains within 90 seconds of install.
2. **Enable one-click, user-approved x402 payments**: from 402 challenge to settled payment and content unlock in under 15 seconds, with an explicit approval prompt every time.
3. **Preserve CoinPay's non-custodial guarantee**: private keys and seed phrases never leave the extension; only public keys, addresses, and signed payloads are transmitted. The approval UI must display transaction details **parsed from the exact payload being signed** (see P0-7), so a compromised or MITM'd API cannot get the user to sign a payment to an address other than the one shown.
4. **Stay radically simpler than MetaMask/Phantom**: no dApp browser, no NFT galleries, no token swapping UI in v1 — wallet + pay, nothing else.
5. **Drive facilitator volume**: measurable increase in x402 verify/settle API calls attributable to the extension within 60 days of launch.

## 3. Non-Goals

- **Full dApp provider compatibility (EIP-1193 / Solana wallet-adapter):** Emulating MetaMask/Phantom APIs so arbitrary dApps can connect is a large compatibility surface and a separate initiative. The v1 provider is CoinPay-specific (`window.coinpay`).
- **In-extension swaps or fiat on-ramp:** The SDK exposes swap support, but it adds UI complexity and regulatory surface. Defer to the web app.
- **Hardware wallet support (Ledger/Trezor):** Valuable but adds WebHID/WebUSB complexity per browser. P2 consideration.
- **Mobile (iOS Safari / Android):** Different distribution and API constraints; separate project.
- **Automatic (promptless) x402 payment:** Explicitly excluded per product direction — every x402 payment requires a user approval prompt in v1. Spending allowances/budgets are a P2 design consideration.
- **Lightning (BOLT12) and Stripe x402 methods in v1:** The facilitator supports them, but Lightning requires node/session handling and Stripe is fiat; v1 ships on-chain methods only.
- **SegWit / bech32 BTC support:** CoinPay derives and signs **legacy P2PKH** (`m/44'/0'`, `1...` addresses) only — see §4. Matching the web wallet is a P0; adding SegWit is out of scope for v1.

## 4. Background & Technical Context

Findings from a review of the `profullstack/coinpayportal` repository (`@master`, commit `d54fe39`) and the published `@profullstack/coinpay` SDK (v0.6.11). **File/line references below point at the verified source.**

- **Server-assisted transaction flow (confirmed).** The web-wallet API prepares unsigned transactions server-side (`/api/web-wallet/:id/prepare-tx` assembles UTXOs, nonces, blockhashes, and fee estimates; unsigned txs get a 5-minute TTL — `src/lib/web-wallet/prepare-tx.ts:109`), the client signs locally, and the server broadcasts (`/broadcast`). The extension therefore does **not** need to *assemble* transactions.
- **⚠️ Correction — the extension DOES need a full chain-specific signer; it is not free SDK reuse.** v0.1 stated the extension needs "only key derivation and signing" and that the SDK "already implements … prepareTx/sign/broadcast." In reality:
  - The **published SDK's high-level `wallet.send()` signing is a non-functional placeholder**: it calls `signMessage(unsignedTx, privateKey)` — a single sha256 + secp256k1 signature over the whole unsigned blob — with inline comments stating *"This is a simplified version — real implementation would need chain-specific signing logic"* (`packages/sdk/src/wallet.js:1000-1009`). It will not produce valid transactions for any chain.
  - The **only real signer lives in the web app, not the npm package**: `src/lib/web-wallet/signing.ts` — a hand-rolled implementation of EIP-1559 (RLP), BTC/BCH legacy + BIP143 (P2PKH), and Solana message serialization. It is imported only by an internal server wrapper (`src/lib/wallet-sdk/wallet.ts`) and is **not exported from `@profullstack/coinpay`.**
  - That signer uses **Node built-ins unavailable in an MV3 service worker**: `require('crypto')` for `ripemd160`/sha256, `Buffer` throughout, and `require('tweetnacl')` for ed25519 (`signing.ts:186,72,410`). Porting to the extension requires a `Buffer` polyfill, replacing `ripemd160` with `@noble/hashes`, replacing `tweetnacl` with `@noble/ed25519`, and re-validating byte-for-byte against the web wallet.
  - The SDK's newer low-level primitives (`signDigest`, EIP-191 `signMessage`, `signSolanaMessage` — `wallet.js:1024+`) are documented to require the **caller to build the unsigned tx "with their own library (viem / ethers / @solana/web3.js)."** In other words, the SDK's own authors assume a chain library is present.
  - **Implication:** the extension must either (a) port and de-Node-ify the hand-rolled `signing.ts`, or (b) adopt a chain library (viem/ethers, `@solana/web3.js`, a BTC lib) and use the SDK's digest primitives. Option (a) keeps the "pure JS, no WASM" property but ships **bespoke, not-independently-audited** transaction serialization; option (b) contradicts the "no chain libraries" simplicity claim. Either way this is real engineering, not reuse (see P0-4, §9, §12).
- **Lightweight, browser-friendly crypto (confirmed, for derivation).** Key **derivation** uses pure-JS audited libraries (`@scure/bip39`, `@scure/bip32`, `@noble/curves`, `@noble/hashes`) — no WASM, bundles cleanly (`packages/sdk/package.json`). This holds for derivation; the **signing** layer as currently written pulls in Node crypto + tweetnacl (see above) and must be reworked for the browser.
- **Existing SDK — reuse is narrower than v0.1 implied.** `@profullstack/coinpay` reliably provides: BIP-44 derivation for all chains (`wallet.js`, incl. SLIP-0010 ed25519 for Solana at `wallet.js:238`), per-request secp256k1 signature auth, and the prepare/broadcast HTTP calls. It does **not** provide working transaction signing (see above) or any payer-side x402 construction (see below).
- **⚠️ Correction — x402 SDK helpers are merchant/facilitator-side, not payer-side.** v0.1 listed `buildPaymentRequired`, `verifyX402Payment`, `settleX402Payment` as extension building blocks. In the SDK (`packages/sdk/src/x402.js`): `buildPaymentRequired` builds a **merchant's** 402 challenge; `verifyX402Payment` (`:477`) and `settleX402Payment` (`:544`) take an *already-formed* `X-PAYMENT` header and POST it to `/api/x402/verify|settle` — i.e., they are the **facilitator/merchant** side. **None of them constructs a payment as a payer**, which is exactly what the extension needs. The payer-side X-PAYMENT construction is entirely greenfield.
- **⚠️ Correction — `x402fetch()` is advertised but does not exist, and native schemes are non-standard.** The client-side `x402fetch()` helper is referenced as a real SDK import in the README (`README.md:51,62`), the marketing page (`src/app/x402/page.tsx:299`) and docs (`src/app/docs/page.tsx:517`), but is **absent from all SDK source.** Additionally, every method (including native BTC/BCH/SOL) is declared `scheme: 'exact'` (`x402.js:17-90`), yet standard x402 `exact` is an EVM signed-authorization (EIP-3009/USDC) scheme — there is no standard `exact` for native BTC. The payer payload for non-EVM methods must be reverse-engineered from what CoinPay's `/api/x402/settle` actually expects, per method (see P0-8).
- **x402 protocol.** A 402 response carries an `accepts` array of payment methods (network, asset, scheme, amount, pay-to address). The client constructs and signs a payment, then retries the request with a payment header the facilitator verifies/settles.
- **Chains (confirmed).** BTC, BCH, ETH, POL, SOL, plus USDC on ETH/POL/SOL/Base (BNB and USDT variants exist in the SDK chain enum — `wallet.js:27-40`). `USDC_BASE` reuses coinType 60, so it shares the ETH address (`wallet.js:60`).
- **⚠️ BTC is legacy P2PKH only.** Derivation is `m/44'/0'/0'/0/i` with version byte `0x00` → `1...` addresses (`wallet.js:132`), and the signer builds P2PKH scripts only (`signing.ts:185`). Consequences: higher fees (no witness discount) and — importantly for the "import my seed" story — the BTC address will **not** match wallets that default to SegWit (`m/84'`, `bc1...`), so imported users may perceive funds as missing. Internally consistent with the CoinPay web wallet (parity holds), but must be surfaced in onboarding.
- **⚠️ API rate limits are all per-IP (answers Open Q#6).** `balance_query 60/min`, `auth_challenge`/`auth_verify 30/min`, `prepare_tx 20/min`, `broadcast_tx 10/min`, `estimate_fee 60/min`, all **per-IP** (`src/lib/web-wallet/rate-limit.ts:55-70`). Users behind shared NAT/CGNAT/corporate-VPN egress share one bucket, so aggressive polling from a popular extension can rate-limit unrelated users on the same IP. Refresh must be manual/backoff (already the plan), and note that auth is consumed on wallet switches.

## 5. Target Users

- **Crypto-comfortable consumers** who hit x402-paywalled content/APIs and want one-click payment without leaving the page.
- **CoinPay web-wallet users** who want persistent browser access to their existing wallet (import via seed phrase).
- **Developers and AI-agent operators** testing x402-paywalled endpoints who need a human-in-the-loop signer.
- **Merchants** validating their own x402 integrations end-to-end.

## 6. User Stories

**Wallet lifecycle**
- As a new user, I want to create a wallet in the extension with a generated seed phrase so that I can start receiving crypto without any signup or KYC.
- As an existing CoinPay web-wallet user, I want to import my BIP-39 seed phrase so that my extension shows the same addresses and balances. *(Note: BTC will show a legacy `1...` address, matching CoinPay but not SegWit-default wallets — surface this.)*
- As a security-conscious user, I want my seed encrypted with a password I choose, and the wallet to auto-lock after inactivity, so that a stolen laptop doesn't mean stolen funds.
- As a user, I want to view and verify my seed phrase backup so that I can recover my wallet on another device.

**Send / receive**
- As a user, I want to see my balances across BTC, ETH, SOL, POL, BCH, and USDC in one popup so that I don't have to check multiple apps.
- As a user, I want to receive funds by copying an address or showing a QR code so that anyone can pay me on any supported chain.
- As a user, I want to send funds by entering an address and amount, reviewing the fee, and confirming, so that a transfer takes under a minute.
- As a user, I want a clear error when I enter an invalid address or an amount above my balance so that I can't construct a doomed transaction.

**x402 payments**
- As a user browsing a site with x402-paywalled content, I want the site to request payment through my extension so that I get a prompt showing exactly what I'm paying, in what asset, to whom.
- As a user, I want to choose which chain/asset to pay with when the 402 challenge accepts multiple methods so that I can spend from whichever balance I prefer.
- As a user, I want to reject an x402 payment request with one click so that nothing is signed or spent without my consent.
- As a user, I want to see a history of x402 payments I've approved so that I can audit what I've spent and where.

**Edge cases**
- As a user with a locked wallet, I want payment/send requests to route me through unlock first so that requests aren't silently dropped.
- As a user whose prepared transaction expired (5-min TTL), I want the extension to re-prepare automatically so that a slow approval doesn't fail cryptically.
- As a security-conscious user, I want the approval screen to show the recipient/amount **read from the transaction I'm actually signing**, so that a tampered server response can't redirect my funds.

## 7. Requirements

### P0 — Must-Have (v1 cannot ship without)

| # | Requirement | Acceptance criteria |
|---|-------------|---------------------|
| P0-1 | **Cross-browser MV3 build.** Single codebase producing Chrome and Firefox builds via `webextension-polyfill`; browser-specific manifest fields handled at build time. | Extension installs and passes the full test suite on latest Chrome and Firefox ESR+; no browser-specific code paths outside the build layer. |
| P0-2 | **Wallet create/import.** Generate a BIP-39 mnemonic (12/24 words) or import an existing one; derive BIP-44 addresses for BTC (legacy P2PKH), ETH, SOL (SLIP-0010 ed25519), POL, BCH (+ USDC variants) matching CoinPay web-wallet derivation; register public keys/addresses with the CoinPay API. | Given the same seed, extension addresses exactly match the web wallet's for every chain (BTC = legacy `1...`). Seed backup screen requires confirmation before wallet is usable. **Verify** the exact create/import registration payload against `/api/web-wallet/create` and `/import` — a reusable SDK registration method was not located, so this may be replicated from the API, not the SDK. |
| P0-3 | **Encrypted local key storage.** Seed encrypted with a user password (WebCrypto AES-GCM, PBKDF2 or scrypt KDF) in `browser.storage.local`; decrypted key material held only in `storage.session` / memory while unlocked; auto-lock after configurable idle timeout (default 15 min). | Seed never appears in plaintext in `storage.local` (verified by inspection). Killing the service worker and reopening requires no re-login while session is valid; browser restart requires password. |
| P0-4 | **Non-custodial signing flow with a browser-native signer.** Send = call `prepare-tx` → display amount, recipient, fee → user confirms → **sign locally with the extension's own chain-specific signer** → `broadcast`. Because the SDK ships no working transaction signer, the extension either (a) ports `src/lib/web-wallet/signing.ts` and replaces its Node deps (`Buffer`, `ripemd160`, `tweetnacl`) with browser-safe equivalents, or (b) uses the SDK digest primitives plus a chain library. Private keys and mnemonics never included in any network request. | Signed transactions from the extension are byte-compatible with the web wallet for every P0 chain (differential test against `signing.ts` output on shared vectors). Network capture during a full send shows zero requests containing key material. Expired prepared txs (5-min TTL) are re-prepared transparently. |
| P0-5 | **Balances & receive.** Popup shows per-chain balances (CoinPay REST API) with manual refresh (per-IP rate limit: `balance_query` 60/min); receive view shows address + QR per chain. | Balances match web wallet within one refresh. QR scans correctly into 3 major mobile wallets. |
| P0-6 | **Injected provider (`window.coinpay`).** Content script injects a page-facing API with at minimum: `isCoinPay`, `getAccounts()` (user-gated), and `payX402(paymentRequired)` which resolves to a payment header after user approval. | A demo page can detect the provider, request accounts, and complete an x402 payment. All provider calls that touch accounts or funds require an approval prompt. Provider ↔ content ↔ background messaging enforces origin checks; all signing occurs in the background context only. |
| P0-7 | **x402 approval prompt with sign-what-you-show integrity.** On `payX402`, the extension opens an approval window showing: origin, USD amount, asset/chain options from the `accepts` array, recipient, and estimated fee — with **recipient and amount parsed from the exact payload/transaction about to be signed, not from server-supplied summaries or page-supplied intent.** Approve → construct payer payload / sign / settle → return header; Reject → provider promise rejects, nothing signed. | Given a 402 challenge with 3 accepted methods, user can pick any, approve, and the paywalled request succeeds on retry. Reject produces no on-chain activity and no signed payload. Prompt appears within 500 ms of the provider call. **A tampered `prepare-tx`/challenge response that changes the recipient is reflected in the displayed recipient (spoofing/redirect test passes).** |
| P0-8 | **x402 402→pay→retry client loop (greenfield — payer-side).** The SDK provides no payer-side helper and no `x402fetch()`; the extension implements the loop: parse 402 `accepts`, **construct and sign the payer `X-PAYMENT` payload for the chosen method**, retry the original request. Because native (BTC/BCH/SOL) methods use a non-standard `exact` scheme, the exact payload shape must be confirmed against `/api/x402/settle` **before** implementation. | For **each** supported on-chain method, the payer payload format is documented and an end-to-end test against a CoinPay x402-middleware-protected endpoint passes. Methods whose payload cannot be validated against the facilitator are explicitly descoped from v1 rather than assumed. |
| P0-9 | **Transaction & payment history.** Local log of sends and x402 approvals (origin, amount, asset, tx/settlement ref, timestamp) with links to CoinPay/web explorer detail. | Every approved x402 payment and send appears in history immediately; rejected prompts do not. |
| P0-10 | **Security review — expanded scope.** Internal threat-model review + third-party audit before store submission, explicitly covering: key handling; provider message passing; prompt-spoofing/clickjacking resistance; the **sign-what-you-show** guarantee (P0-7); **and the bespoke/ported transaction serialization + payer-side x402 payload construction** (P0-4, P0-8), since these are not backed by an independently audited library. | All critical/high findings remediated; report on file. Signer and x402-payload code are covered by the audit scope, not just messaging/storage. |

### P1 — Nice-to-Have (fast follows)

- **Per-origin connection management:** remember which sites may see accounts; revoke from settings.
- **Fee priority selector** (low/medium/high) on sends, using the API's fee estimates.
- **Fiat value display** for balances and payment prompts (rates from CoinPay API).
- **USDT and BNB chain support** (already in SDK chain enum).
- **Passive 402 detection banner:** non-blocking page banner when a top-level navigation returns 402 with a CoinPay-compatible `accepts` array ("Pay with CoinPay"), as a fallback for sites that don't integrate the provider. (Note: blocking webRequest is unavailable in Chrome MV3; this must be observational only.)
- **Localization** (extension already targets an international audience; web app has i18n).

### P2 — Future Considerations (design for, don't build)

- **SegWit / bech32 BTC** (`m/84'`) for lower fees and modern-wallet address parity — requires coordinated support in the CoinPay prepare-tx/derivation layer, not just the extension.
- **Spending budgets / allowances** for trusted origins (e.g., auto-approve x402 under $0.25 up to $5/day) — keep the approval pipeline pluggable so a policy layer can sit in front of the prompt.
- **EIP-1193 / Solana wallet-standard compatibility layer** so generic dApps can use CoinPay.
- **Lightning (BOLT12) and Stripe x402 methods.**
- **Hardware wallet signing.**
- **Escrow and DID/reputation surfaces** from the broader CoinPay platform.

## 8. UX Overview

- **Popup (toolbar):** balance list → Send / Receive / History tabs. Deliberately minimal — one primary action per screen.
- **Approval window:** dedicated small window (not the popup) for x402 and send confirmations, styled distinctly to resist spoofing, always showing origin + amount + asset + recipient — **all derived from the payload being signed** (P0-7).
- **Onboarding:** Create or Import → password → seed backup + confirm → done. Target ≤ 90 seconds. BTC legacy-address note shown to importing users.
- **Locked state:** any provider request or popup open routes through password unlock first.

## 9. Technical Approach (summary)

- **Manifest V3**, background service worker (Chrome) / event page (Firefox), `webextension-polyfill`, shared TypeScript core.
- **Reuse `@profullstack/coinpay` SDK for what it actually provides:** BIP-44/SLIP-0010 derivation, per-request secp256k1 auth signatures, and the prepare/broadcast HTTP calls. **Do not assume reuse for transaction signing or payer-side x402** — both are effectively greenfield (see §4).
- **Transaction signer:** port `src/lib/web-wallet/signing.ts` (EIP-1559 RLP, BTC/BCH P2PKH+BIP143, Solana message serialization) into the extension and remove its Node dependencies — `Buffer` → polyfill/`Uint8Array`, `ripemd160`/sha256 via `@noble/hashes`, `tweetnacl` → `@noble/ed25519` — then differential-test byte output against the web wallet. Alternatively adopt viem/`@solana/web3.js` + the SDK digest primitives; decide explicitly (trade-off: bespoke-but-tiny vs. audited-but-heavier).
- **Payer-side x402:** implement the 402→pay→retry loop and per-method `X-PAYMENT` construction. **Confirm the facilitator's expected payload for each `exact` method (especially non-EVM BTC/BCH/SOL) against `/api/x402/settle` before building**; descope any method that can't be validated.
- **Crypto:** `@scure/bip39`, `@scure/bip32`, `@noble/curves`, `@noble/hashes`, `@noble/ed25519` (pure JS, no WASM).
- **Messaging:** page ↔ content script ↔ background via `postMessage`/runtime ports with origin checks; all signing in background context only.
- **Balance/refresh strategy:** manual refresh + backoff; respect per-IP limits (`balance_query` 60/min, `auth` 30/min, `prepare_tx` 20/min, `broadcast` 10/min).
- **Key risk areas:** MV3 service-worker lifetime vs. session unlock; **bespoke/ported BTC/BCH/ETH/SOL signing correctness (no audited chain lib as a backstop under option (a))**; **greenfield payer-side x402 payload construction, non-standard for native methods**; prompt-spoofing/clickjacking and sign-what-you-show integrity; prepared-tx TTL expiry during slow approvals; per-IP rate-limit collisions behind shared egress.

## 10. Success Metrics

**Leading (first 30 days)**
- ≥ 60% of installs complete wallet creation/import (activation).
- x402 approval flow completion (prompt shown → settled) ≥ 80%; median challenge-to-unlock time ≤ 15 s.
- Send success rate ≥ 95% of confirmed attempts; signing-related error rate < 1%.
- Crash-free sessions ≥ 99.5% on both browsers.

**Lagging (60–90 days)**
- Measurable lift in facilitator `/api/x402/verify`+`/settle` volume attributable to the extension (target: +25% over pre-launch baseline).
- ≥ 30% of weekly-active extension users perform ≥ 1 transaction (send or x402) per week.
- Chrome Web Store / AMO rating ≥ 4.0.
- Zero critical security incidents.

## 11. Open Questions

- **[Engineering]** Should the extension talk to CoinPay's hosted API only, or support self-hosted CoinPay instances (configurable base URL)? *(Blocking — affects settings, auth, and store review.)*
- **[Engineering — RESOLVED, non-blocking]** Is `x402fetch()` planned for the SDK soon? Verified: it does **not** exist in SDK source despite being documented in the README/marketing/docs pages. The extension must implement the payer loop itself; if the SDK later ships a real `x402fetch()`, migrate to it.
- **[Engineering — NEW, decision needed]** Signer strategy: port the hand-rolled `signing.ts` (keeps "pure JS/no WASM", but ships unaudited serialization) **vs.** adopt viem/`@solana/web3.js` + SDK digest primitives (audited libs, larger bundle, contradicts the "no chain libs" simplicity goal)? *(Affects P0-4 scope, bundle size, and audit effort.)*
- **[Engineering — NEW, blocking for P0-8]** For each `exact` method, what exact payer `X-PAYMENT` payload does `/api/x402/settle` expect — especially the non-standard native BTC/BCH/SOL schemes? *(Must be answered before x402 implementation; determines which methods ship in v1.)*
- **[Product]** For x402 challenges denominated in USD with multiple accepted assets, who sets the default method — last used, cheapest fee, or largest balance? *(Non-blocking.)*
- **[Product/Legal]** Store-policy review: crypto wallet extensions face extra scrutiny on Chrome Web Store and AMO (source-code requirements on AMO, crypto policy attestations on CWS). *(Blocking for launch date.)*
- **[Design]** Anti-spoofing treatment for the approval window (persistent security indicator? per-install visual secret?). *(Blocking for security review.)*
- **[Engineering — RESOLVED, non-blocking]** Rate limits on the web-wallet API for balance polling. Verified: all limits are **per-IP** (`balance_query` 60/min, etc. — `rate-limit.ts:55-70`). Refresh manually with backoff; be aware shared-egress users share a bucket.

## 12. Timeline & Phasing

Estimate for one experienced extension developer (add ~30–40% for a first-time extension dev). **Revised upward from v0.1 because Phases 2 and 3 are not "SDK reuse" — the signer and the payer-side x402 flow are bespoke/greenfield (§4).**

| Phase | Scope | Duration |
|-------|-------|----------|
| **Phase 1 — Wallet core** | MV3 scaffold, storage/encryption, create/import, derivation parity tests, balances/receive UI | ~2–3 weeks |
| **Phase 2 — Send** | Port + de-Node-ify (or replace) the chain signer; prepare→approve→sign→broadcast for all P0 chains with **differential byte-parity tests** against the web wallet; sign-what-you-show; history; error states | ~2–3 weeks |
| **Phase 3 — x402** | Injected provider, approval window, **greenfield payer-side payload construction per method** (after validating the settle contract), 402→pay→retry loop, per-method e2e tests | ~2–3 weeks |
| **Phase 4 — Hardening & launch** | Security review/audit remediation (**expanded to cover the bespoke signer + x402 payloads**), cross-browser QA, store submissions (CWS + AMO review lead time: 1–3 weeks, run in parallel) | ~1–2 weeks |

**Total: roughly 7–11 weeks to v1** (up from v0.1's 5–9), with store review as the main external dependency. Sequencing dependencies: the `/api/x402/settle` payload contract (Open Q) gates Phase 3; the signer decision (Open Q) gates Phase 2; security review (P0-10) gates store submission.

---

*Prepared from analysis of the `profullstack/coinpayportal` repository and coinpayportal.com, July 2026. v0.2 corrections verified against commit `d54fe39` and `@profullstack/coinpay` v0.6.11: `packages/sdk/src/wallet.js`, `packages/sdk/src/x402.js`, `src/lib/web-wallet/{prepare-tx,signing,rate-limit}.ts`, README/docs pages.*
