# CoinPay for OpenCart (stub)

> **Status:** stub. Not yet a working plugin.

OpenCart 4.x payment extension. Adds CoinPayPortal as a payment method during checkout, builds a hosted checkout, and reconciles via signed webhooks.

## Files (planned)

```
plugins/opencart/
  README.md
  manifest.json
  upload/
    admin/
      controller/payment/coinpayportal.php
      language/en-gb/payment/coinpayportal.php
      view/template/payment/coinpayportal.twig
    catalog/
      controller/payment/coinpayportal.php
      controller/extension/payment/coinpayportal/webhook.php
      language/en-gb/payment/coinpayportal.php
      model/payment/coinpayportal.php
      view/template/payment/coinpayportal.twig
    system/
      library/coinpayportal/Client.php
      library/coinpayportal/StatusMapper.php
      library/coinpayportal/WebhookVerifier.php
  install.json
  install.xml                       # OCMOD if needed
```

## Docs

Adapt from [`../_template/docs/`](../_template/docs/).
