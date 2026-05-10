# Configuration — &lt;Platform&gt;

All settings live in the &lt;Platform&gt; admin UI under **&lt;TODO: settings path&gt;**.

## Fields

| Field | Required | Default | Description |
|---|---|---|---|
| **API Key** | Yes | — | Your CoinPayPortal API key (`cp_live_*` or `cp_test_*`). Get one in the CoinPayPortal dashboard under Settings → API. |
| **Business ID** | Yes | — | Your CoinPayPortal business / merchant ID. Required when an API key is scoped to multiple businesses. |
| **Webhook Secret** | Yes | — | Used to verify incoming webhook signatures. Generate or reveal in the CoinPayPortal dashboard. |
| **API Base URL** | No | `https://api.coinpayportal.com` | Override only if instructed by support. |
| **Sandbox Mode** | No | No | When on, calls the sandbox API and skips on-chain settlement. |
| **Sandbox API Base URL** | No | `https://sandbox-api.coinpayportal.com` | Used when sandbox mode is on. |
| **Display Name** | No | `Pay with Crypto (CoinPayPortal)` | Customer-facing name shown at checkout. |
| **Payment Expiration (minutes)** | No | `30` | How long a hosted checkout stays valid before expiring. |
| **Underpayment Tolerance (%)** | No | `0` | Accept payments that are slightly under the invoice total. `0` = exact match required. |
| **Debug Logging** | No | No | Verbose log output. Disable in production. |

## Webhook URL

Your &lt;Platform&gt; webhook URL is:

```
https://YOUR-DOMAIN.COM/<TODO: platform-specific path>
```

Paste this into the CoinPayPortal dashboard under **Settings → Webhooks**.

## Sandbox vs production

When **Sandbox Mode** is on, use a sandbox API key — live keys will be rejected by the sandbox API and vice versa.
