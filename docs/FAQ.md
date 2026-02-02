# Frequently Asked Questions

---

## General

### What is CoinPay?

CoinPay is a **non-custodial** cryptocurrency payment gateway. Merchants can accept crypto payments from customers, and funds are automatically forwarded to the merchant's own wallet. CoinPay also includes a multi-chain web wallet for end users.

### What does "non-custodial" mean?

CoinPay never holds your funds. Payments flow through temporary addresses and are automatically forwarded to your merchant wallet. Private keys for forwarding addresses are encrypted server-side and only used for the forwarding transaction.

### Which blockchains are supported?

| Chain | Token | Status |
|-------|-------|--------|
| Bitcoin (BTC) | Native | ✅ Active |
| Bitcoin Cash (BCH) | Native | ✅ Active |
| Ethereum (ETH) | Native | ✅ Active |
| Polygon (POL) | Native | ✅ Active |
| Solana (SOL) | Native | ✅ Active |
| BNB Chain (BNB) | Native | ✅ Active |
| Dogecoin (DOGE) | Native | ✅ Active |
| XRP Ledger (XRP) | Native | ⚠️ Limited |
| Cardano (ADA) | Native | ⚠️ Limited |
| USDC (Ethereum) | ERC-20 | ✅ Active |
| USDC (Polygon) | ERC-20 | ✅ Active |
| USDC (Solana) | SPL | ✅ Active |
| USDT (Ethereum) | ERC-20 | ✅ Active |

### How long does payment detection take?

- **Cron monitor**: Checks every 60 seconds (Vercel Cron)
- **Active polling**: `POST /api/payments/:id/check-balance` checks on-demand
- **Typical detection time**: 1-3 minutes after on-chain confirmation
- **Blockchain confirmation times**: BTC ~10 min, ETH ~15 sec, SOL ~0.4 sec

---

## Merchant Questions

### How do I get started?

1. **Register** at [coinpayportal.com/signup](https://coinpayportal.com/signup)
2. **Create a business** from the dashboard
3. **Add wallet addresses** for chains you want to accept
4. **Get your API key** from business settings
5. **Integrate** using the SDK or API — see [Getting Started](./sdk/getting-started.md)

### What are the fees?

| Plan | Monthly Cost | Commission | Transaction Limit |
|------|-------------|------------|-------------------|
| Starter | Free | 1% | 100/month |
| Professional | $49/month | 0.5% | Unlimited |

Commission is deducted from each payment before forwarding to your wallet. Example: $100 payment on Starter plan → $99 forwarded to you, $1 platform fee.

### Can I accept payments without the SDK?

Yes. The API works with any HTTP client. The SDK is a convenience wrapper — all it does is make `fetch()` calls with your API key. See the [API Reference](./api/README.md).

### How do I test payments?

1. **Use small amounts** on mainnet (e.g., $1 worth of SOL — cheapest gas fees)
2. **Use the webhook test endpoint** to simulate webhook delivery
3. **Check the Vercel/Railway logs** for monitor output
4. There is no testnet mode currently — all chains are mainnet

### What happens when a payment expires?

- Payment status changes to `expired`
- A `payment.expired` webhook is sent
- The payment address is no longer monitored
- If the customer sends funds after expiry, they can be recovered manually but won't auto-confirm
- Create a new payment for the customer

### What if the customer sends the wrong amount?

- **Overpayment**: The full received amount is forwarded (the customer gets their change in the merchant amount)
- **Underpayment (>1% short)**: Payment stays pending. The customer needs to send the remaining amount to the same address
- **Slight underpayment (<1%)**: The 1% tolerance allows it to confirm

### Can I issue refunds?

CoinPay doesn't have built-in refund functionality. Refunds must be handled directly between you and your customer:

1. Get the customer's wallet address
2. Send the refund from your merchant wallet
3. Keep records of the refund for your accounting

---

## Web Wallet Questions

### Is the Web Wallet safe?

The Web Wallet is **non-custodial**. Your private keys are generated in your browser and encrypted with your password. The server **never** sees your private keys or seed phrase.

- Keys are derived using BIP39/BIP44 standard
- Encryption uses AES-256-GCM
- Authentication uses cryptographic signatures (no passwords sent to server)

### What if I lose my seed phrase?

**You lose access to your wallet permanently.** There is no recovery mechanism. CoinPay cannot access your funds or reset your wallet.

Back up your seed phrase:
- Write it on paper (not digital)
- Store in a secure location (safe, safety deposit box)
- Never share it with anyone
- Never take a screenshot of it

### How does Web Wallet authentication work?

Instead of passwords, the Web Wallet uses **signature-based authentication**:

1. You request a challenge from the server
2. You sign the challenge with your private key (in your browser)
3. The server verifies the signature against your stored public key
4. If valid, you get a JWT token for API access

This proves you own the wallet without ever revealing your private key.

### Can I use the Web Wallet with the payment gateway?

They're separate systems but on the same platform. The Web Wallet is for personal crypto management (send/receive/hold). The payment gateway is for merchants accepting payments. You can use both with the same CoinPay account.

---

## Technical Questions

### What authentication methods are available?

| Method | Use Case | How to Get |
|--------|----------|------------|
| JWT Token | Dashboard, UI, multi-business management | `POST /api/auth/login` |
| API Key | Server-to-server payment creation | Business Settings |
| Wallet JWT | Web Wallet operations | Challenge-response auth |
| Internal API Key | Monitor/admin endpoints | Environment variable |

### How do webhooks work?

1. Configure a webhook URL on your business
2. When a payment event occurs, CoinPay sends a POST request to your URL
3. The request includes an `X-CoinPay-Signature` header (HMAC-SHA256)
4. Your server verifies the signature and processes the event
5. Return HTTP 200 to acknowledge receipt
6. If your server returns non-2xx, CoinPay retries the webhook

### What's the payment lifecycle?

```
pending → detected → confirmed → forwarding → forwarded
                  ↓                           ↓
               expired                      failed
```

| Status | Meaning |
|--------|---------|
| `pending` | Payment created, waiting for funds |
| `detected` | Funds detected on-chain (unconfirmed) |
| `confirmed` | Sufficient confirmations received |
| `forwarding` | Funds being forwarded to merchant wallet |
| `forwarded` | Forwarding complete |
| `expired` | Payment timed out |
| `failed` | Error during processing |

### How does payment forwarding work?

1. Customer sends crypto to a **temporary payment address** (unique per payment)
2. CoinPay detects the funds and marks the payment as confirmed
3. CoinPay splits the payment: merchant amount + platform fee
4. The merchant's share is sent to their configured wallet address
5. The platform fee is sent to the CoinPay fee collection wallet
6. Both transactions are recorded

### Can I self-host CoinPay?

CoinPay is open source and designed for self-hosting:

- **Vercel** for the Next.js frontend + API
- **Railway** for always-on deployment (no cold starts)
- **Supabase** for the database
- See [Deployment Guide](./deployment/README.md)

### What are the rate limits?

| Scope | Limit |
|-------|-------|
| API requests per IP | 100/minute |
| API requests per account | 1,000/hour |
| Web Wallet creation per IP | 5/hour |
| Web Wallet auth per IP | 10/minute |
| Web Wallet balance queries per IP | 60/minute |
| Web Wallet broadcast per IP | 10/minute |

### Does CoinPay support webhooks for the Web Wallet?

Yes. Web Wallet users can register webhooks for:
- `transaction.incoming` — New incoming transaction
- `transaction.confirmed` — Transaction confirmed
- `transaction.outgoing` — Outgoing transaction sent
- `balance.changed` — Balance updated

Register via `POST /api/web-wallet/:id/webhooks`.

---

## Pricing & Billing

### How do I upgrade my plan?

1. Go to **Settings → Subscription**
2. Choose a plan and billing period
3. Select a cryptocurrency to pay with
4. Complete the payment
5. Your plan upgrades immediately upon confirmation

### Can I pay for my subscription with crypto?

Yes — that's the only payment method. Use `POST /api/subscriptions/checkout` or the dashboard.

### What happens if I hit my transaction limit?

API calls to create payments will return HTTP 429 with the current usage:

```json
{
  "success": false,
  "error": "Monthly transaction limit exceeded",
  "usage": { "current": 100, "limit": 100, "remaining": 0 }
}
```

Upgrade to Professional for unlimited transactions.

### Do unused transactions roll over?

No. Transaction counts reset on the first of each month (UTC).
