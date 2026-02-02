# Integration Examples

Practical, copy-paste-ready examples for common CoinPay integration patterns.

## Examples

| Example | Description | Best For |
|---------|-------------|----------|
| [Node.js Payment Bot](./nodejs-bot.md) | Discord/Telegram bot that creates invoices and monitors payments | Bots, automation, CLI tools |
| [Browser Payment Page](./browser-app.md) | Minimal HTML + JS checkout page with React component variant | SPAs, static sites, custom checkouts |
| [E-Commerce Checkout](./ecommerce.md) | Full server-side integration with order management and webhook handling | Online stores, SaaS billing, marketplaces |

## Common Pattern

All integrations follow the same flow:

```
1. Your Backend → POST /api/payments/create → CoinPay
2. CoinPay → Returns payment address + QR code
3. Your Frontend → Shows address/QR to customer
4. Customer → Sends crypto to the address
5. CoinPay → Detects funds on-chain
6. CoinPay → POST webhook → Your Backend
7. Your Backend → Fulfills the order
```

## Which Approach Should I Use?

- **Webhooks** (recommended): Your server receives instant notifications when payments are confirmed. Most reliable for production.
- **Polling**: Your frontend calls `POST /api/payments/:id/check-balance` every few seconds. Good for testing or simple integrations.
- **SSE (Server-Sent Events)**: Connect to `GET /api/realtime/payments` for streaming updates. Good for dashboards.

## Prerequisites

1. CoinPay account with at least one business
2. Wallet addresses configured for your supported chains
3. API key (from business settings)
4. Webhook secret (from business settings) — for webhook verification
