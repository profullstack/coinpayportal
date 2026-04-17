# coinpay-php

Shared PHP client used by the CoinPay WooCommerce and WHMCS plugins. This is the PHP sibling of [`packages/sdk`](../sdk) (JavaScript). The two are kept in lockstep — especially the webhook signing contract.

## Layout

- `src/Client.php` — HTTP client for the CoinPay REST API
- `src/Webhook.php` — `X-CoinPay-Signature` HMAC-SHA256 verifier + helpers
- `src/StatusMap.php` — canonical status codes + platform-neutral classifier
- `src/ApiException.php` — error type thrown by the client

## Packaging into plugins

WordPress and WHMCS install plugin zips directly — they don't run `composer install` at deploy time. The canonical PHP client lives here, and `scripts/sync-plugin-sdk.sh` copies `src/*` into each plugin's vendored `lib/CoinPay/` directory. Edit here, then run the sync script to propagate.

## Webhook signature contract

```
Header:    X-CoinPay-Signature: t=<unix_seconds>,v1=<hex_hmac>
HMAC body: "{timestamp}.{rawBody}"
Algorithm: HMAC-SHA256
Tolerance: 300 seconds
```

Same as `packages/sdk/src/webhooks.js`. If that file changes, update `Webhook.php` too.
