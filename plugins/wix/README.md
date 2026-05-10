# CoinPay for Wix Stores (stub)

> **Status:** stub. Not yet a working plugin.

Wix integration for CoinPayPortal. Wix supports payment service providers via the **Payment Provider SPI** — a hosted JSON-RPC service that Wix calls during checkout. Listing in the Wix Marketplace requires Wix partner approval.

## Approval requirement

Wix Payment Provider SPI requires an active Wix Studio partner account and submission to Wix for review before stores can connect to it. Until approved, this plugin can only run as a private app on a single dev store.

## Files (planned)

```
plugins/wix/
  README.md
  manifest.json
  app/
    package.json
    src/
      server.ts                  # Wix Payment Provider SPI host
      routes/connect.ts          # /v1/connect       — store onboarding
      routes/payment.ts          # /v1/payments      — create CoinPay checkout
      routes/refund.ts           # /v1/refunds       — (future)
      routes/webhook-coinpay.ts  # CoinPay → us → Wix Payment Provider transactions API
```

## Docs

Adapt from [`../_template/docs/`](../_template/docs/).
