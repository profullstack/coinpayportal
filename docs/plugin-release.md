# Plugin Release & Distribution

How CoinPay's WooCommerce and WHMCS plugins get from `master` to merchants.

## TL;DR

```bash
# 1. Bump version in the three places that carry it
#    - plugins/woocommerce/coinpay-woocommerce/coinpay-woocommerce.php (header + COINPAY_WC_VERSION)
#    - plugins/woocommerce/coinpay-woocommerce/readme.txt (Stable tag)
#    - plugins/whmcs/modules/gateways/coinpay.php (plugin_version metadata)

# 2. Tag and push
git tag plugins-v0.1.1
git push origin plugins-v0.1.1

# 3. GitHub Actions does the rest (GitHub Release + WP.org deploy).
# 4. Manually upload the attached zips to WooCommerce.com and WHMCS Marketplace.
```

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
