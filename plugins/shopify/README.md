# CoinPay for Shopify (stub)

> **Status:** stub. Not yet a working plugin. See `manifest.json` for capability state.

Shopify integration for CoinPayPortal — accept crypto payments via Shopify checkout.

## Approval requirement

Shopify only allows approved partners to ship checkout-time payment apps via the **Payments App Extension** API. Until that approval is in place, this plugin can ship as a regular Shopify app that:

- Adds a "Pay with crypto" button on the cart / order-status page (off-Shopify checkout)
- Listens to the `orders/create` webhook and creates a CoinPayPortal invoice
- Marks the order paid via `POST /admin/api/<ver>/orders/{id}/transactions.json` after the CoinPay webhook confirms

We track the partner-approval path separately. See `docs/INSTALL.md` for both modes.

## Files (planned)

```
plugins/shopify/
  README.md
  manifest.json
  app/
    package.json
    server.ts                    # Remix / Hono entrypoint
    routes/
      api.coinpay.webhook.ts     # CoinPay → us
      api.shopify.webhook.ts     # Shopify → us
      checkout.ts                # build hosted checkout, redirect customer
  payments-app-extension/        # only if/when approved
    extension.toml
    handlers/
      payment-session.ts
      refund-session.ts
```

## Docs

See the shared template in [`../_template/docs/`](../_template/docs/) — copy and adapt these files when this stub becomes a working plugin:

- [INSTALL.md](../_template/docs/INSTALL.md)
- [CONFIGURATION.md](../_template/docs/CONFIGURATION.md)
- [WEBHOOKS.md](../_template/docs/WEBHOOKS.md)
- [TROUBLESHOOTING.md](../_template/docs/TROUBLESHOOTING.md)
