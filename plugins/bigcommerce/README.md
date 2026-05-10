# CoinPay for BigCommerce (stub)

> **Status:** stub. Not yet a working plugin.

BigCommerce single-click app + offsite payment integration. Adds a "Pay with crypto" option that creates a CoinPayPortal hosted checkout, then reconciles the order via signed webhooks.

## Approval / scope notes

BigCommerce supports **offsite payment apps** (redirect to external checkout) without partner-tier approval. Native checkout payment methods on BigCommerce's hosted checkout require partner approval and are deferred.

## Files (planned)

```
plugins/bigcommerce/
  README.md
  manifest.json
  app/
    package.json
    src/
      server.ts                    # Node app shell (Hono / Express)
      auth/install.ts              # OAuth install flow
      auth/load.ts                 # store-load handshake
      routes/checkout.ts           # build hosted checkout, redirect
      routes/webhook-bc.ts         # BigCommerce → us
      routes/webhook-coinpay.ts    # CoinPay → us, mark order paid via Orders API
      lib/bigcommerce.ts           # thin BC Admin API client
```

## Docs

Adapt from [`../_template/docs/`](../_template/docs/).
