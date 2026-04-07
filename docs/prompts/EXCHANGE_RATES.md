# Use the CoinPay Exchange Rates API

You are adding live crypto-to-fiat conversion to an app using CoinPay's rates endpoint.

## Goal

Quote a crypto amount in the user's local fiat currency (and vice versa) using a trustworthy, cached source.

## Environment variables

```
COINPAY_API_URL=https://coinpayportal.com
```

The rates endpoint is **public** — no API key required. Only the base URL needs to be configured, and you can hardcode it if you prefer. There is no portal location to copy from.

## Single rate

```js
const response = await fetch('https://coinpayportal.com/api/rates?coin=SOL&fiat=EUR');
const data = await response.json();
// { coin: 'SOL', fiat: 'EUR', rate: 142.31, ts: 1712512345 }
```

## Batch

```js
const response = await fetch('https://coinpayportal.com/api/rates?coins=BTC,ETH,SOL&fiat=GBP');
const data = await response.json();
// { fiat: 'GBP', rates: { BTC: 52311.4, ETH: 2814.7, SOL: 121.9 }, ts: ... }
```

## Rules

- The endpoint is **public** — no API key needed — but rate-limited per IP. Cache server-side and serve to your clients from there.
- Quotes drift. Re-fetch right before locking in an order; don't reuse a quote older than ~30 seconds for checkout.
- Display the timestamp (`ts`) so users know how fresh the rate is.
- Use `example-business.com` for any sample app domain.

## Deliverable

- A server route `/api/quote?coin=BTC&fiat=USD&amount=49.99` that returns `{ amount_crypto, rate, ts }`.
- A 30s in-memory cache layer.
- A test asserting that stale (>30s) cached rates are refreshed before checkout.
