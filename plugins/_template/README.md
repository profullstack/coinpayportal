# CoinPayPortal Plugin Template

This directory is a **scaffolding template** for new CoinPayPortal ecommerce / billing platform integrations. It is not a runnable plugin — copy it into a new `plugins/<platform>/` directory and fill in the platform-specific bits.

The shape mirrors the working WooCommerce, WHMCS, and FOSSBilling plugins so that every CoinPayPortal integration looks roughly the same:

```
plugins/<platform>/
  README.md
  docs/
    INSTALL.md
    CONFIGURATION.md
    WEBHOOKS.md
    TROUBLESHOOTING.md
  src/                # platform-native source files (PHP module / Node app / etc.)
  manifest.json       # plugin metadata (name, version, supported events, capabilities)
```

## What every plugin must do

1. **Authenticate to CoinPayPortal** with a `cp_live_*` / `cp_test_*` API key the merchant pastes into the plugin settings.
2. **Create an invoice / checkout session** when a customer chooses "Pay with crypto" — `POST /api/invoices` (or `POST /api/payments/create` for one-shot payment links).
3. **Redirect the customer** to the hosted CoinPay checkout URL returned in step 2.
4. **Receive a signed webhook** at a publicly reachable URL on the merchant's site, verify the HMAC-SHA256 signature using the merchant's webhook secret, and update order status idempotently.
5. **Map CoinPayPortal payment states → platform order states** (see `WEBHOOKS.md`).
6. **Surface refunds** if the platform supports them (read-only display is acceptable for MVP).

## Webhook signature format

CoinPayPortal signs webhooks as:

```
X-CoinPayPortal-Signature: t=<unix_ts>,v1=<hmac_sha256_hex>
```

Verify with constant-time comparison and reject if `|now - t| > 300s`.

## Events you should at least handle

| Event | Action |
|---|---|
| `payment.confirmed` / `payment.completed` | Mark order paid |
| `payment.forwarded` | (Optional) note that funds have been swept to merchant wallet |
| `payment.expired` | Mark order failed/expired |
| `payment.failed` | Mark order failed |
| `invoice.paid` | Mark invoice paid (if the platform models invoices separately from orders) |

`underpaid` / `overpaid` are not yet emitted as discrete events — handle via the `paid_amount` vs `amount` fields on `payment.confirmed`.

## Required SDK / client

Use the canonical client from `packages/`:

- JS / TS plugins → `packages/sdk` (`@coinpayportal/sdk`)
- PHP plugins → `packages/coinpay-php` (vendored into the plugin under `lib/CoinPay/` or `src/`)

Do **not** re-implement HMAC verification, retries, or SSRF protection in the plugin — call into the SDK.

## Status of each integration

See `plugins/README.md` for the live status table.
