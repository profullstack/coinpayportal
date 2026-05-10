# CoinPay for PrestaShop (stub)

> **Status:** stub. Not yet a working plugin.

PrestaShop 8.x payment module. Hooks into `paymentOptions` to render "Pay with crypto", builds a CoinPayPortal hosted checkout, and reconciles the order via a signed webhook hitting a PrestaShop module controller.

## Files (planned)

```
plugins/prestashop/
  README.md
  manifest.json
  coinpayportal/
    coinpayportal.php              # main module class extending PaymentModule
    config.xml
    composer.json
    logo.png
    controllers/front/
      validation.php               # post-checkout return
      webhook.php                   # CoinPay → us
    views/templates/hook/
      payment_options.tpl
      payment_return.tpl
    classes/
      CoinPayClient.php             # wraps packages/coinpay-php
      StatusMapper.php
    translations/
```

## Docs

Adapt from [`../_template/docs/`](../_template/docs/).
