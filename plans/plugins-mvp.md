# Plugins MVP — WooCommerce + WHMCS

Tracking doc for the PRD in [`PRD.md`](../PRD.md). Updated 2026-04-16.

## Repo layout (added)

```
packages/
  coinpay-php/          ← shared PHP client (source of truth)
    src/
      ApiException.php
      Client.php
      StatusMap.php
      Webhook.php
    tests/WebhookTest.php
    composer.json
plugins/
  woocommerce/
    coinpay-woocommerce/
      coinpay-woocommerce.php
      uninstall.php
      readme.txt
      includes/
        class-coinpay-logger.php
        class-coinpay-webhook-handler.php
        class-wc-gateway-coinpay.php
      lib/CoinPay/      ← vendored copy of packages/coinpay-php/src
  whmcs/
    README.md
    modules/gateways/
      coinpay.php
      callback/coinpay.php
      coinpay/lib/CoinPay/  ← vendored copy of packages/coinpay-php/src
scripts/
  sync-plugin-sdk.sh    ← copy shared client → each plugin's vendored lib
  build-plugin-zips.sh  ← produce installable zips in dist/
```

## API contract (locked with JS SDK)

| Concern | Value |
|---|---|
| Base URL | `https://coinpayportal.com/api` |
| Auth | `Authorization: Bearer <apiKey>` |
| Crypto session | `POST /payments/create` (`business_id`, `amount`, `currency`, `blockchain`, `metadata`) |
| Card session | `POST /stripe/payments/create` (`businessId`, `amount` in cents, `currency`, `successUrl`, `cancelUrl`, `metadata`) |
| Status lookup | `GET /payments/{id}` |
| Ping | `GET /businesses` |
| Webhook header | `X-CoinPay-Signature: t=<unix>,v1=<hex_hmac_sha256>` |
| Webhook body | `"{t}.{rawBody}"` |
| Tolerance | 300 s |
| Events | `payment.{created,pending,confirming,completed,expired,failed,refunded}` |

The `packages/coinpay-php/src/Webhook.php` contract is kept in lockstep with `packages/sdk/src/webhooks.js`. If the JS contract changes, update the PHP verifier AND re-run `scripts/sync-plugin-sdk.sh`.

## Status mapping (MVP)

| CoinPay class | WooCommerce state | WHMCS action |
|---|---|---|
| paid       | `payment_complete()` → processing/completed | `addInvoicePayment()` |
| pending    | `on-hold`                         | log only |
| failed     | `failed`                          | log only |
| expired    | `cancelled`                       | log only |
| refunded   | `refunded`                        | log only (Phase 2: reverse) |

## What's done (Milestones 1–3)

- [x] Shared PHP client with cURL transport, injectable transport for tests
- [x] HMAC-SHA256 webhook verifier + 6-case unit test (all pass)
- [x] Canonical status map (one mapping layer used by both plugins)
- [x] WooCommerce: gateway registration, settings UI, HPOS compat declaration, hosted checkout redirect, webhook handler at `/wc-api/coinpay`, idempotency via event-id ring, test-connection AJAX, secret redaction in logs
- [x] WHMCS: gateway meta + config, hosted checkout button on invoice, signed webhook callback, duplicate suppression via `checkCbTransID`
- [x] Build pipeline: sync-plugin-sdk.sh + build-plugin-zips.sh

## What's Phase 2

- WooCommerce Blocks checkout (we register as classic gateway; block support requires a separate `PaymentMethodTypeInterface` class)
- Native refunds initiated from WooCommerce/WHMCS admin (requires CoinPay refund API coverage)
- WHMCS recurring billing / tokenization
- Per-method messaging ("pay in BTC / ETH / USDC") at the gateway button
- Dashboard widgets + analytics

## Open questions carried over from PRD

1. Canonical refund API — does CoinPay expose `POST /refunds` for crypto rails, or is it dashboard-only?
2. Single session covering crypto + card, or two sessions? Current plugin picks based on `paymentMode`; if CoinPay unifies, we can drop the card/crypto branch.
3. Sandbox webhooks — separate secret or same? Currently one `webhook_secret` field.
4. Metadata size limit? We send ~8 keys (~200 bytes); fine for any reasonable cap.

## How to ship

**Local:**
```bash
./scripts/sync-plugin-sdk.sh        # sync vendored client
./scripts/build-plugin-zips.sh      # → dist/coinpay-woocommerce-0.1.0.zip, dist/coinpay-whmcs-0.1.0.zip
```

**Release:** tag `plugins-v<semver>` and push. GitHub Actions (`.github/workflows/plugins-release.yml`) builds the zips, attaches them to a GitHub Release, and — when enabled — deploys the WooCommerce zip to the WordPress.org plugin directory via SVN. WooCommerce.com Marketplace and WHMCS Marketplace have no public upload API so those two uploads stay manual; a webhook reminder is available. Full process in [`docs/plugin-release.md`](../docs/plugin-release.md).
