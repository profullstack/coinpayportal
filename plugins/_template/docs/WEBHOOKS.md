# Webhooks — &lt;Platform&gt;

CoinPayPortal uses signed webhooks to notify &lt;Platform&gt; when a payment status changes.

## Webhook URL

```
https://YOUR-DOMAIN.COM/<TODO: platform-specific path>
```

The endpoint is publicly reachable. All security comes from HMAC signature verification — no IP allowlist, no platform auth.

## Registering the webhook

1. Sign in to the [CoinPayPortal merchant dashboard](https://coinpayportal.com).
2. **Settings → Webhooks → Add webhook**.
3. Paste the URL above.
4. Copy the generated **Webhook Secret** into the &lt;Platform&gt; gateway settings.

## Signature verification

Every CoinPayPortal webhook includes:

```
X-CoinPayPortal-Signature: t=<unix_ts>,v1=<hmac_sha256_hex>
```

The plugin verifies the signature with constant-time comparison and rejects requests where `|now - t| > 300s` (replay window).

## Supported events → &lt;Platform&gt; action

| CoinPayPortal event | &lt;Platform&gt; action |
|---|---|
| `payment.confirmed` | Mark order paid |
| `payment.forwarded` | (Optional) note funds swept to merchant wallet |
| `payment.expired` | Mark order failed/expired |
| `payment.failed` | Mark order failed |
| `invoice.paid` | Mark invoice paid |
| `payment.refunded` *(future)* | Note refund |
| `payment.underpaid` *(future)* | Hold or partial-fill, depending on tolerance |
| `payment.overpaid` *(future)* | Mark paid, log overpayment |

`underpaid` / `overpaid` are not yet emitted as discrete events. The plugin can detect these by comparing `paid_amount` vs `amount` on `payment.confirmed`.

## Example payload — `payment.confirmed`

```json
{
  "id": "evt_01hx9k2m3n4p5q6r7s8t9u0v",
  "type": "payment.confirmed",
  "created_at": "2026-04-30T12:00:00Z",
  "data": {
    "payment_id": "pay_01hx9k2abc123def456ghi789",
    "checkout_id": "chk_01hx9k2xyz987wvu654tsr321",
    "invoice_id": "INV-00042",
    "amount": "49.00",
    "currency": "USD",
    "paid_amount": "0.00072341",
    "paid_asset": "BTC",
    "status": "confirmed",
    "txid": "a1b2c3d4...",
    "confirmations": 3,
    "network": "bitcoin",
    "metadata": {
      "platform": "<platform>",
      "<platform>_order_id": "1234"
    }
  }
}
```

## Idempotency

The plugin must check whether the order is already paid before processing `payment.confirmed`. CoinPayPortal retries delivery up to 3 times with exponential backoff (1s, 2s, 4s, 8s).
