# Business Collection: Receive Payments Across Many Coins/Chains

You are integrating CoinPay's Business Collection feature, which gives a merchant a single "collection" that aggregates inbound payments across multiple coins and chains into one ledger.

## Goal

Generate a payment address per customer/order under a merchant's collection. Funds are auto-forwarded to the merchant's payout wallet, and reporting is unified across coins.

## Environment variables

```
COINPAY_API_KEY=sk_live_...
COINPAY_WEBHOOK_SECRET=whsec_...
COINPAY_API_URL=https://coinpayportal.com
```

Where to find them:
- `COINPAY_API_KEY` — `https://coinpayportal.com/businesses/<your-business-id>` → **API Keys** tab → **Create API Key**. Shown once.
- `COINPAY_WEBHOOK_SECRET` — same business page → **Webhooks** tab (or `?mode=webhooks`) → create an endpoint → **Signing Secret**.
- The merchant payout wallet must be configured first at `https://coinpayportal.com/settings/wallets` (or per-business under the **Wallets** tab). No private keys touch your code.

## Steps

1. **Create a collection payment** server-side:

   ```bash
   curl -X POST https://coinpayportal.com/api/collection/payments \
     -H "Authorization: Bearer $COINPAY_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "amount": 75.00,
       "currency": "USD",
       "coin": "USDC",
       "chain": "polygon",
       "reference": "invoice_789",
       "webhook_url": "https://example-business.com/api/coinpay/webhook"
     }'
   ```

   Returns `id`, `pay_address`, `pay_amount`, `payment_url`.

2. **Statuses:** `pending` → `detected` → `confirmed` → `forwarded`. Drive UI off webhooks.

3. **List collection payments** for reconciliation:

   ```bash
   curl https://coinpayportal.com/api/collection/payments?status=confirmed \
     -H "Authorization: Bearer $COINPAY_API_KEY"
   ```

## Rules

- The merchant's payout wallet is configured once in the portal — your code never sees private keys.
- Always set a unique `reference` so you can map payments back to your invoices.
- Verify webhook signatures.
- Use `example-business.com` in any sample URL.

## Deliverable

- An endpoint that creates a collection payment for an invoice.
- A webhook handler that progresses invoice state on `confirmed` and `forwarded`.
- A reconciliation job that lists yesterday's `forwarded` payments and ticks them off in your ledger.
