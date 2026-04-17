# CoinPay for WHMCS

A WHMCS payment gateway module that lets clients pay unpaid invoices through CoinPay hosted checkout (crypto or credit card).

## Installation

1. Copy the contents of the `modules/` folder into your WHMCS installation's `modules/` folder, preserving structure:
   - `modules/gateways/coinpay.php`
   - `modules/gateways/coinpay/lib/CoinPay/…`
   - `modules/gateways/callback/coinpay.php`
2. In WHMCS admin: **Setup → Payments → Payment Gateways → All Payment Gateways**, activate **CoinPay**.
3. Configure:
   - API key + Business ID (from CoinPay dashboard)
   - Webhook secret (create in CoinPay dashboard)
   - Payment mode: `both`, `crypto`, or `card`
4. In CoinPay dashboard, add the webhook URL shown in the gateway description:
   ```
   https://<your-whmcs>/modules/gateways/callback/coinpay.php
   ```

## Requirements

- WHMCS 8.x or newer
- PHP 7.4+
- `curl` and `hash` extensions (standard)

## How it works

- On an unpaid invoice, the gateway creates a CoinPay hosted checkout session and renders a **Pay with CoinPay** button.
- The client is redirected to CoinPay to complete payment.
- CoinPay POSTs a signed webhook to `/modules/gateways/callback/coinpay.php`.
- The callback verifies the HMAC signature, resolves the invoice from `metadata.invoice_id`, and calls `addInvoicePayment()` on success.
- Duplicate events are suppressed via `checkCbTransID()`.

## Files

| File | Role |
|------|------|
| `modules/gateways/coinpay.php` | Gateway module entrypoint (meta + config + link) |
| `modules/gateways/coinpay/lib/CoinPay/` | Vendored CoinPay PHP client (source of truth: `packages/coinpay-php/`) |
| `modules/gateways/callback/coinpay.php` | Webhook receiver |

## Refunds

CoinPay refunds are initiated from the CoinPay dashboard in MVP. When a refund is issued, CoinPay emits a `payment.refunded` webhook which the callback logs. Full WHMCS-side refund wiring is Phase 2.

## Debug logging

Toggle **Debug logging** in the gateway config. Logs are written to **Utilities → Logs → Gateway Log**.
