# CoinPayPortal — Ecommerce / Billing Plugins

Each subdirectory ships a CoinPayPortal integration for one host platform. New plugins should be scaffolded from [`_template/`](./_template/).

## Status

| Plugin | Platform | Language | Status | Approval required |
|---|---|---|---|---|
| [`woocommerce/`](./woocommerce/) | WooCommerce | PHP | **working** | No |
| [`whmcs/`](./whmcs/) | WHMCS | PHP | **working** | No |
| [`fossbilling/`](./fossbilling/) | FOSSBilling | PHP | **working** | No |
| [`shopify/`](./shopify/) | Shopify | Node | stub | Yes (Payments App Extension); off-checkout mode does not |
| [`magento/`](./magento/) | Magento 2 / Adobe Commerce | PHP | stub | No |
| [`bigcommerce/`](./bigcommerce/) | BigCommerce | Node | stub | Offsite no, native checkout yes |
| [`prestashop/`](./prestashop/) | PrestaShop 8 | PHP | stub | No |
| [`opencart/`](./opencart/) | OpenCart 4 | PHP | stub | No |
| [`edd/`](./edd/) | Easy Digital Downloads | PHP | stub | No |
| [`ecwid/`](./ecwid/) | Ecwid / Lightspeed eCom | Node | stub | App store listing yes |
| [`wix/`](./wix/) | Wix Stores | Node | stub | Yes (Payment Provider SPI) |
| [`squarespace/`](./squarespace/) | Squarespace Commerce | HTML / Node | stub (workaround-only) | n/a (no public payment SPI) |

`status` mirrors `manifest.json#status` in each directory: `stub` = scaffolding only, `workaround` = no first-class API path, `working` = end-to-end flow implemented.

## Adding a new plugin

1. Copy `_template/` to `<platform>/`.
2. Update `<platform>/manifest.json` with the platform name, supported version, and language.
3. Replace the `<Platform>` placeholders in `docs/`.
4. Implement the platform-native source files (PHP module / Node app / etc.) following one of the working plugins as a reference.
5. Add a row to the table above and bump `status` from `stub` → `working` in `manifest.json` once the integration is end-to-end.

## Shared invariants

All plugins must:

- Authenticate with a `cp_live_*` / `cp_test_*` API key.
- Build hosted checkouts via `POST /api/invoices` or `POST /api/payments/create`.
- Verify webhooks with HMAC-SHA256 (`X-CoinPayPortal-Signature: t=<ts>,v1=<hex>`) and a 5-minute replay window.
- Process `payment.confirmed` idempotently — duplicate deliveries must be no-ops.
- Use the canonical SDK from `packages/sdk` (JS) or `packages/coinpay-php` (PHP). Do **not** re-implement HMAC, retries, or SSRF protection.

See [`_template/README.md`](./_template/README.md) for the full contract.
