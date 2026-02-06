# CoinPay SDK Examples

Runnable examples demonstrating every major feature of `@profullstack/coinpay`.

## Setup

```bash
# From the SDK directory
cd packages/sdk

# Set your credentials
export COINPAY_API_KEY=cp_live_your_key_here
export COINPAY_BUSINESS_ID=biz_your_id_here
export COINPAY_WEBHOOK_SECRET=whsec_your_secret_here
```

## Examples

| File | Description |
|------|-------------|
| `01-quick-start.js` | Minimal example — create a payment and check status |
| `02-create-payment.js` | Create payments on BTC, ETH, SOL, USDC, with metadata |
| `03-check-payment-status.js` | One-time check & polling with `waitForPayment` |
| `04-list-payments.js` | List, filter, and paginate payments |
| `05-exchange-rates.js` | Fetch single & batch exchange rates |
| `06-webhook-handler.js` | Express webhook server with signature verification |
| `07-ecommerce-checkout.js` | Complete checkout flow: order → payment → webhook → fulfillment |
| `08-business-management.js` | Create, list, and update businesses |
| `09-error-handling.js` | Handle auth, validation, rate-limit, and timeout errors |

## Running

```bash
# Quick start
node examples/01-quick-start.js

# Check a specific payment
node examples/03-check-payment-status.js pay_abc123

# Webhook server (requires express: npm install express)
node examples/06-webhook-handler.js
```

## Notes

- Examples use ES module syntax (`import`) — requires Node.js ≥ 20 and `"type": "module"` in package.json.
- Webhook examples (`06`, `07`) need `express` installed separately.
- All examples read credentials from environment variables — never hard-code API keys.
