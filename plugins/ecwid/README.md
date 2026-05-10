# CoinPay for Ecwid / Lightspeed eCom (stub)

> **Status:** stub. Not yet a working plugin.

Ecwid (now Lightspeed eCom) external payment app. The Ecwid storefront posts the order to our hosted endpoint; we build a CoinPayPortal hosted checkout, redirect the customer, then call the Ecwid Orders API to mark the order paid once CoinPay's webhook fires.

## Files (planned)

```
plugins/ecwid/
  README.md
  manifest.json
  app/
    package.json
    src/
      server.ts                   # Hono / Express entrypoint
      routes/checkout.ts          # POST from Ecwid → build CoinPay checkout, redirect
      routes/webhook-coinpay.ts   # CoinPay → us → Ecwid Orders API
      lib/ecwid.ts                # thin Ecwid Admin API client
```

## Docs

Adapt from [`../_template/docs/`](../_template/docs/).
