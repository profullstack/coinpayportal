# CoinPay for Squarespace Commerce (stub)

> **Status:** stub. Not yet a working plugin.

## Why this is hard

Squarespace does not expose a public payment-method extension API. There is no equivalent to Shopify's Payments App Extension or Wix's Payment Provider SPI. Practical integration paths today are limited:

1. **Order Notifications API + custom button (workaround).** Add a custom "Pay with crypto" button on the product page via Code Injection that bypasses Squarespace checkout, builds a CoinPayPortal hosted checkout, and creates a Squarespace order via the Commerce API after the CoinPay webhook fires. This skips Squarespace tax/shipping calculations and is fragile.
2. **Manual / invoice-only flow.** Merchant generates a CoinPay invoice link from the CoinPayPortal dashboard and emails it to the customer. No Squarespace integration; this directory exists only to host docs explaining the workaround.
3. **Wait for an official extension API** if Squarespace ships one.

The plugin will ship as a documentation-first stub plus an optional Code Injection snippet, until Squarespace exposes a real payment extension API.

## Files (planned)

```
plugins/squarespace/
  README.md
  manifest.json
  snippets/
    pay-with-crypto-button.html       # Code Injection snippet
  app/                                # only if/when we host a real API listener
    package.json
    src/server.ts
```

## Docs

Adapt from [`../_template/docs/`](../_template/docs/).
