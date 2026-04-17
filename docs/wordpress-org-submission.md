# WordPress.org submission checklist — `coinpay-woocommerce`

One-time process. After the plugin is accepted, `plugins-release.yml` auto-deploys future versions via SVN.

## 1. Pre-submission validation

Run locally before submitting:

```bash
./scripts/sync-plugin-sdk.sh
./scripts/build-plugin-zips.sh
```

Then install the resulting zip in a fresh WordPress + WooCommerce test site and verify:

- [ ] Plugin activates with no PHP notices (enable `WP_DEBUG`).
- [ ] `WooCommerce → Settings → Payments` shows CoinPay.
- [ ] Settings save correctly; test-connection button succeeds.
- [ ] A live order against sandbox CoinPay creates a session and redirects.
- [ ] Webhook signed with the secret updates the order.
- [ ] Order admin shows the CoinPay payment ID in notes.
- [ ] Plugin deactivates cleanly; uninstall drops `woocommerce_coinpay_settings`.

## 2. Code-quality gates WordPress.org reviewers care about

- [ ] No `eval()`, no `create_function()`, no `base64_decode` of dynamic input.
- [ ] All inputs sanitized (`sanitize_text_field`, `sanitize_email`, etc.) and outputs escaped (`esc_html`, `esc_attr`, `esc_url`).
- [ ] No remote calls on every admin page load (we gate the test-connection behind an explicit button — ✅).
- [ ] No JavaScript/CSS loaded from third-party CDNs; all assets local.
- [ ] No bundled minified JS without source (our Blocks JS ships unminified for transparency — ✅).
- [ ] `readme.txt` stable tag matches the PHP header version.
- [ ] `License: MIT` explicit in both `readme.txt` and plugin header.
- [ ] Textdomain `coinpay-woocommerce` consistent everywhere.
- [ ] No nested plugin directories; zip extracts to a single `coinpay-woocommerce/` folder.

## 3. Prepare WP.org assets

Place images in `plugins/woocommerce/coinpay-woocommerce/.wordpress-org/`. See [`.wordpress-org/README.md`](../plugins/woocommerce/coinpay-woocommerce/.wordpress-org/README.md) for required dimensions.

At minimum for submission:
- [ ] `icon-128x128.png`
- [ ] `icon-256x256.png`
- [ ] `banner-772x250.png`
- [ ] `screenshot-1.png` through `screenshot-5.png`

## 4. Submit

1. Build the zip: `./scripts/build-plugin-zips.sh` → `dist/coinpay-woocommerce-0.1.0.zip`.
2. Go to https://wordpress.org/plugins/developers/add/.
3. Fill the form:
   - **Plugin slug (will be auto-generated):** `coinpay-woocommerce`
   - Upload the zip.
4. Submit and wait for the reviewer's email (1–2 weeks typical; sometimes faster).

## 5. After acceptance

1. The reviewer creates the SVN repo at `https://plugins.svn.wordpress.org/coinpay-woocommerce/`.
2. Go to the repo's GitHub settings and add:
   - Secret `WP_ORG_SVN_USERNAME` = your WordPress.org username
   - Secret `WP_ORG_SVN_PASSWORD` = your WordPress.org password
   - Variable `WP_ORG_DEPLOY_ENABLED` = `true`
3. Tag the next release (`plugins-v0.1.1`). The release workflow will auto-deploy to WP.org SVN.

## 6. Common rejection reasons to pre-empt

| Reason | Our current stance |
|--------|-------------------|
| "Calls out to external services without disclosure" | `readme.txt` discloses CoinPay dependency in the Description block. |
| "Uses trademarks in slug" | `coinpay-woocommerce` uses CoinPay's own trademark; no third-party marks. |
| "Loading fonts from Google Fonts" | None loaded. |
| "Reviews/affiliates in readme" | None. |
| "Admin nags/upsells" | None — settings page is quiet. |
| "Creates database tables without uninstall" | We don't create tables. `uninstall.php` removes our one option. |
