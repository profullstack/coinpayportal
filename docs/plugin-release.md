# Plugin Release & Distribution

How CoinPay's WooCommerce and WHMCS plugins get from `master` to merchants.

## TL;DR

```bash
# 1. Bump everything (root + SDK + plugins + shared PHP client) to the same
#    version, sync vendored copies, publish SDK to npm, commit, and push.
pnpm version:patch                  # or :minor, :major

# 2. Tag and push the plugin release tag (the bump itself doesn't create tags).
NEW=$(node -p "require('./package.json').version")
git tag -a "plugins-v${NEW}" -m "CoinPay plugins v${NEW}"
git push origin "plugins-v${NEW}"

# 3. GitHub Actions does the rest (GitHub Release + optional WP.org deploy).
# 4. Manually upload the attached zips to WooCommerce.com and WHMCS Marketplace.
```

## Version-bump script

[`scripts/version-bump.js`](../scripts/version-bump.js) is the single source of truth for versioning. It rewrites every place a version appears across the monorepo, then runs the sync + publish + commit + push pipeline:

| File | Pattern |
|------|---------|
| `package.json` | top-level `"version"` |
| `packages/sdk/package.json` | JS SDK `"version"` |
| `packages/coinpay-php/src/Client.php` | `USER_AGENT` constant |
| `plugins/woocommerce/coinpay-woocommerce/coinpay-woocommerce.php` | plugin-header `Version:` + `COINPAY_WC_VERSION` constant |
| `plugins/woocommerce/coinpay-woocommerce/readme.txt` | `Stable tag:` |
| `plugins/whmcs/modules/gateways/coinpay.php` | `'plugin_version'` metadata |
| `scripts/build-plugin-zips.sh` | `COINPAY_PLUGIN_VERSION` default |

Then it runs `scripts/sync-plugin-sdk.sh` to propagate the shared PHP client into each plugin's vendored `lib/CoinPay/` directory.

The script reads the target version from the root `package.json` (source of truth) and **sets** every other file to that same version — it doesn't require the files to be pre-aligned. A `[from X — was drifted]` note is printed for any file that was out of sync, so misalignment gets called out but automatically corrected.

Flags:

- `--dry-run` — prints what would change and exits before any file write, sync, publish, commit, or push. Safe to run anytime.

Side effects when not in dry-run:

1. Rewrites the 7 target files.
2. Runs `sync-plugin-sdk.sh`.
3. Publishes `@profullstack/coinpay` to npm.
4. Commits with `--no-verify` (the pre-commit hook runs the full Next.js build, too slow for a version bump).
5. Pushes the commit to `origin`.
6. `sudo npm install -g @profullstack/coinpay@<new>` to update the global CLI (non-fatal if it fails).

It does **not** create or push git tags — tags are deliberately manual because `plugins-v*` triggers the release workflow.

## What's fully automated

| Step | Trigger | Where |
|---|---|---|
| Lint + webhook tests | every PR / push to master | `.github/workflows/plugins-ci.yml` |
| Build installable zips | every push on plugin paths | CI artifact `plugin-zips` |
| Verify vendored SDK matches source of truth | every CI run | diff in CI |
| Create GitHub Release with both zips | tag `plugins-v*` | `plugins-release.yml` → `github-release` job |
| WordPress.org SVN deploy | tag `plugins-v*`, gated by `vars.WP_ORG_DEPLOY_ENABLED == 'true'` | `plugins-release.yml` → `wordpress-org-deploy` job |

## What's manual (no public API)

Neither WooCommerce.com Marketplace nor WHMCS Marketplace expose a public upload API. After the GitHub Release is created, download the zips and upload them via the vendor dashboards:

- **WooCommerce.com Marketplace** → https://woocommerce.com/my-dashboard/ (Extensions → your product → new version)
- **WHMCS Marketplace** → https://marketplace.whmcs.com/ (vendor portal → your module → upload)

You can enable a Slack/Discord webhook reminder by setting the `NOTIFY_MARKETPLACES` variable to `true` and adding `MARKETPLACE_NOTIFY_WEBHOOK` as a secret.

## Secrets / variables reference

| Name | Type | Purpose |
|---|---|---|
| `WP_ORG_SVN_USERNAME` | secret | WordPress.org SVN username for `10up/action-wordpress-plugin-deploy` |
| `WP_ORG_SVN_PASSWORD` | secret | WordPress.org SVN password |
| `WP_ORG_DEPLOY_ENABLED` | variable | Set to `true` to enable the WP.org deploy job. Leave unset or `false` to skip. |
| `MARKETPLACE_NOTIFY_WEBHOOK` | secret | Slack/Discord/email webhook for manual-upload reminders |
| `NOTIFY_MARKETPLACES` | variable | Set to `true` to post the reminder |

## Versioning

Plugins are versioned independently of the portal app and JS SDK. Use tags of the form `plugins-v<semver>`:

- `plugins-v0.1.0` — MVP (current)
- `plugins-v0.2.0` — next feature drop
- `plugins-v1.0.0` — first stable marketplace release

The same version is applied to both WooCommerce and WHMCS zips. If they need to diverge later, split the tag prefix (`wc-plugin-v*` / `whmcs-plugin-v*`) and the release workflow.

## Pre-WP.org-submission checklist (one-time)

WordPress.org requires a plugin to be reviewed and accepted before `10up/action-wordpress-plugin-deploy` will work. Before the first automated deploy:

1. Submit `coinpay-woocommerce` at https://wordpress.org/plugins/developers/add/
2. Wait for reviewer acceptance (1-2 weeks typical).
3. Once approved, set `WP_ORG_DEPLOY_ENABLED=true` and add the SVN credentials.

Until that's done the WP.org deploy job is skipped and only the GitHub Release asset is produced.

## Local builds

```bash
./scripts/sync-plugin-sdk.sh        # sync vendored client into each plugin
./scripts/build-plugin-zips.sh      # write dist/coinpay-{woocommerce,whmcs}-<version>.zip
```

Set `COINPAY_PLUGIN_VERSION=0.1.1 ./scripts/build-plugin-zips.sh` to name the zips differently.
