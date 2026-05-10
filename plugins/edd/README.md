# CoinPay for Easy Digital Downloads (stub)

> **Status:** stub. Not yet a working plugin.

WordPress plugin that registers CoinPayPortal as an Easy Digital Downloads (EDD) payment gateway. Customers pay through CoinPay hosted checkout; the EDD payment record is reconciled via signed webhooks.

## Files (planned)

```
plugins/edd/
  README.md
  manifest.json
  coinpay-edd/
    coinpay-edd.php                # plugin bootstrap (Plugin Name header)
    readme.txt                     # WordPress.org-style readme
    includes/
      class-coinpay-edd-gateway.php       # registers gateway via edd_payment_gateways filter
      class-coinpay-edd-webhook-handler.php
      class-coinpay-edd-status-mapper.php
    lib/CoinPay/                   # vendored from packages/coinpay-php
    languages/
```

## Docs

Adapt from [`../_template/docs/`](../_template/docs/).
