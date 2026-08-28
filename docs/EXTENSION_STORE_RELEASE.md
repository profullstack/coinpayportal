# Releasing the CoinPay Wallet extension

The extension ships through four channels off one build. Everything except the
Safari step runs on any machine.

| Channel | Identity | Automated? |
|---|---|---|
| Chrome Web Store | `pmckmdnikecngblpjdlhgnimickinfkp` | package upload yes, listing no |
| addons.mozilla.org | `coinpay@profullstack.com` (addon `3061765`, slug `coinpay-wallet`) | yes, end to end |
| Safari / Mac App Store | `com.profullstack.coinpay-wallet` | needs a Mac |
| GitHub release + tronbrowser.dev | `jmojjohoigoecfkjlobdmiejcdjjbhnb` | tag + asset, manual |

## Credentials

Store account credentials live in the logicsrc `brisk-news-extensions` vault —
they are the shared Profullstack Chrome Web Store and AMO ("Profullstack,
Inc.") accounts, not CoinPay-specific:

```
logicsrc teams pull profullstack brisk-news-extensions example --env .env.store
```

The two CoinPay-specific ids are public identifiers, not secrets — they are
recorded here rather than in a vault, and the publish scripts read them from
the environment:

```
CHROME_EXTENSION_ID=pmckmdnikecngblpjdlhgnimickinfkp
FIREFOX_ADDON_ID=3061765
```

Apple credentials (`APPLE_ID`, `APPLE_TEAM_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`) are in `pairux-com--prod`.

## 1. Build every channel

```bash
pnpm --filter @profullstack/coinpay-extension package
```

Writes `packages/extension/release/`:

- `coinpay-wallet-<version>-chrome.zip` — no `key`, no localhost hosts
- `coinpay-wallet-<version>-firefox.zip` — same, plus the Gecko id
- `coinpay-wallet-<version>-safari.zip` and `unpacked-safari/`
- `coinpay-wallet-<version>-selfhost.zip` and `coinpay-wallet.zip` — **keeps
  `key` and the localhost hosts**; this is the GitHub release asset
- `coinpay-wallet-<version>-source.zip` — AMO's required source archive

Two transforms are applied to store builds and are deliberate:

- **`key` is stripped.** It pins the extension id so a tronbrowser.dev install
  replaces an existing sideload instead of duplicating it. The stores mint
  their own id, so the field only causes confusion there. The consequence is
  that a Web Store install and a self-hosted install are *different
  extensions* to the browser; a user moving between channels reinstalls once.
- **`http://localhost/*` and `http://127.0.0.1/*` are removed.** They exist for
  local x402 development, they are the most frequently challenged permission in
  review, and local development uses an unpacked build anyway.

## 2. Screenshots

```bash
pnpm --filter @profullstack/coinpay-extension screenshots
```

Drives the packaged build in a real browser: creates a throwaway wallet so the
wallet view is photographed with genuine derived addresses, and renders the
payment-approval window from a representative x402 request. Output is
`packages/extension/store-assets/*-1280x800.png` — 1280x800 is the only size
the Chrome Web Store takes, and these are committed, because the images the
stores serve should be reviewable in git rather than regenerated from scratch.

It needs the packaged build, so run `package` first.

## 3. Chrome Web Store

```bash
node scripts/publish-chrome.mjs            # upload to the existing item
node scripts/publish-chrome.mjs --publish  # …and submit for review
```

The Publish API can only put a package on an item and publish it. **Listing
copy, category, language, icon, screenshots, and the whole Privacy practices
tab are dashboard-only.** `store-listing.json` holds the exact text to paste:

- `chrome.singlePurpose` → Single purpose
- `chrome.permissionJustifications` → Permission justifications, one per row
- `chrome.remoteCode` → Remote code use
- `chrome.dataUse` → Data usage, plus the compliance certification checkbox
- `privacyPolicyUrl` → Privacy policy

Publishing also requires a free publisher slot: the account caps at **3
published extensions**, and it is currently full. Either unpublish one or
request a limit increase from the dashboard before `--publish` will succeed.

## 4. Firefox

```bash
node scripts/publish-firefox.mjs --validate   # linter only, submits nothing
node scripts/publish-firefox.mjs              # new version of the listing
node scripts/publish-firefox.mjs --previews   # re-attach screenshots
```

`--create` is for the first listing only and has already been used. The script
uploads the package, waits for AMO's linter, creates the version, attaches the
source archive, and uploads the screenshots. A listed version then waits in a
human review queue.

Keep the manifest's `browser_specific_settings.gecko.data_collection_permissions`
accurate. It currently declares `financialAndPaymentInfo`, which is what the
wallet actually transmits: addresses and signed transactions go to
coinpayportal.com for balances and broadcast. The seed never leaves the device.
Declaring `none` would be false.

## 5. Safari

```bash
./scripts/safari-convert.sh            # convert + archive
./scripts/safari-convert.sh --upload   # …and upload to App Store Connect
```

**This step requires macOS.** A Safari web extension is distributed as a
containing app, and the only supported way to produce one is Xcode's
`safari-web-extension-converter`. The script refuses to run anywhere else
rather than pretending to work.

Before the first upload, create the app record for
`com.profullstack.coinpay-wallet` at appstoreconnect.apple.com — Apple has no
API that creates it as part of a first submission.

## 6. Self-hosted release

```bash
gh release create extension-v<version> --target <master sha> --notes '…'
```

`.github/workflows/extension-release.yml` picks the tag up, builds every
channel, refuses the tag if it disagrees with `package.json`, and attaches
`coinpay-wallet.zip` to the release. tronbrowser.dev packs the `.crx` from that
asset and signs it with the store key.

Store submission is **not** on the tag — it is a `workflow_dispatch` with
`chrome` / `firefox` checkboxes, because both stores put a submission in front
of a human reviewer. Running it needs `CHROME_*` / `FIREFOX_*` repository
secrets, mirrored from the vaults above; without them, use the local scripts.

## Bumping the version

`package.json` and all three files in `manifest/` must move together;
`src/__tests__/packaging.test.ts` fails if they drift, and a manifest left at
the old version ships an extension the stores accept and then never update.
