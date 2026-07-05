# @profullstack/coinpay-extension

Cross-browser (MV3) CoinPay wallet + x402 payment extension for Chromium and
Firefox. Product spec: [`docs/BROWSER_EXTENSION_PRD.md`](../../docs/BROWSER_EXTENSION_PRD.md).

## Status — Phase 1 (wallet core) in progress

This package currently contains the **tested, browser-native wallet core** plus
extension scaffolding. It reuses `@profullstack/coinpay` for BIP-44/SLIP-0010
derivation so addresses match the CoinPay web wallet exactly.

### Built & tested (`pnpm --filter @profullstack/coinpay-extension test`)

| Module | Purpose | PRD |
|--------|---------|-----|
| `src/core/derivation.ts` | Seed + address derivation, reusing the SDK (parity fixture test) | P0-2 |
| `src/core/vault.ts` | WebCrypto AES-256-GCM + PBKDF2 (600k) seed encryption | P0-3 |
| `src/core/storage.ts` | `browser.storage` abstraction (+ in-memory impl for tests) | P0-3 |
| `src/core/wallet.ts` | Create / import / lock / unlock lifecycle; no plaintext seed at rest | P0-2/3 |
| `src/background/index.ts` | Service worker: storage wiring, message router, idle auto-lock | P0-3/6 |
| `src/popup/*` | Read-only popup rendering wallet state + addresses | P0-5 |
| `vite.config.ts` | Cross-browser MV3 build → `dist/` (Chrome + Firefox) | P0-1 |

16 unit tests cover vault round-trip / wrong-password / no-plaintext-at-rest,
the full wallet lifecycle, and derivation parity against a known BIP-39 vector
(incl. the canonical `m/44'/60'` ETH address as a cross-check).

### Build & load

```bash
pnpm --filter @profullstack/coinpay-extension build           # -> dist/ (Chrome MV3)
pnpm --filter @profullstack/coinpay-extension build:firefox   # -> dist/ (Firefox MV3)
pnpm --filter @profullstack/coinpay-extension dev             # rebuild on change
```

`dist/` layout: `manifest.json`, `background/index.js` (self-contained ES module
service worker), `popup/index.html` + `popup/main.js`, `icons/`.

- **Chrome/Edge/Brave**: `chrome://extensions` → enable Developer mode → *Load
  unpacked* → select `packages/extension/dist`.
- **Firefox**: run `build:firefox`, then `about:debugging` → This Firefox → *Load
  Temporary Add-on* → pick `dist/manifest.json`.

The popup currently renders wallet state + derived addresses (read-only); create
a wallet from the background console (`chrome.runtime`) or via the onboarding UI
once it lands.

### Not yet built (next phases — see PRD)

- **Onboarding UI** (create/import/backup flows) — Phase 1 remainder.
- **Send** (prepare → approve → sign → broadcast) — Phase 2. Note the PRD's
  key finding: the transaction signer is **not** free SDK reuse and must be
  ported/de-Node-ified from `src/lib/web-wallet/signing.ts` or replaced.
- **x402** provider (`window.coinpay`), approval window, payer-side pay→retry
  loop — Phase 3.

## Develop

```bash
pnpm --filter @profullstack/coinpay-extension test        # unit tests
pnpm --filter @profullstack/coinpay-extension type-check  # tsc --noEmit
```

## Security notes

- Seed is encrypted at rest (AES-GCM/PBKDF2); plaintext only in `storage.session`
  while unlocked. Verified by test (`wallet.test.ts`: "never persists … in local").
- All seed access is confined to the background context; the popup communicates
  over `runtime.sendMessage` only.
- BTC uses **legacy P2PKH** (`1...`) to match the web wallet — not SegWit. See PRD §4.
