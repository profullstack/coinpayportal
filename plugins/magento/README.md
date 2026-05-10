# CoinPay for Magento / Adobe Commerce (stub)

> **Status:** stub. Not yet a working plugin.

Magento 2 / Adobe Commerce module that adds CoinPayPortal as a payment method. The customer selects "Pay with crypto", the module creates a CoinPay hosted checkout, redirects, and reconciles the order via signed webhooks.

## Files (planned)

```
plugins/magento/
  README.md
  manifest.json
  CoinPayPortal/PaymentGateway/
    composer.json
    registration.php
    etc/
      module.xml
      config.xml
      adminhtml/system.xml
      di.xml
      webapi.xml                 # exposes the webhook receiver
      payment.xml                # method config
    Model/
      Ui/CoinPayConfigProvider.php
      ConfigProvider.php
      Webhook/Receiver.php       # POST /rest/V1/coinpay/webhook
      StatusMapper.php
    Controller/
      Redirect/Index.php         # builds checkout, redirects customer
      Return/Index.php           # post-checkout return page
    view/frontend/
      web/js/view/payment/method-renderer/coinpay.js
      web/template/payment/coinpay.html
      layout/checkout_index_index.xml
```

## Docs

Adapt from [`../_template/docs/`](../_template/docs/) when promoting out of stub status.
