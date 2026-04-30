# Webhooks

CoinPayPortal uses signed webhooks to notify FOSSBilling when a payment status changes.

## Webhook URL

Your webhook endpoint is automatically available at:

```
https://YOUR-DOMAIN.COM/ipn/CoinPayPortal
```

This URL must be reachable from the internet. It does not require authentication — all security is handled via signature verification.

## Registering the Webhook

1. Log into your [CoinPayPortal merchant dashboard](https://coinpayportal.com).
2. Go to **Settings → Webhooks**.
3. Add a new webhook with the URL above.
4. Copy the generated **Webhook Secret** into your FOSSBilling gateway configuration.

## Signature Verification

Every webhook from CoinPayPortal includes an `X-CoinPayPortal-Signature` header:

```
X-CoinPayPortal-Signature: sha256=<hmac-sha256-hex>
```

The plugin verifies this using constant-time comparison (`hash_equals`). Any request with a missing or invalid signature is rejected with HTTP 401.

## Supported Events

| Event Type | FOSSBilling Action |
|---|---|
| `payment.completed` | Mark invoice paid |
| `payment.overpaid` | Mark invoice paid + admin note |
| `payment.pending` | No change (logged) |
| `payment.confirming` | No change (logged) |
| `payment.underpaid` | No change unless within tolerance |
| `payment.expired` | No change (logged) |
| `payment.failed` | No change (logged) |
| `payment.refunded` | Logged as warning |
| `payment.disputed` | Logged as warning |
| `checkout.created` | Ignored |

## Example: payment.completed

```json
{
  "id": "evt_01hx9k2m3n4p5q6r7s8t9u0v",
  "type": "payment.completed",
  "created_at": "2026-04-30T12:00:00Z",
  "data": {
    "payment_id": "pay_01hx9k2abc123def456ghi789",
    "checkout_id": "chk_01hx9k2xyz987wvu654tsr321",
    "invoice_id": "INV-00042",
    "amount": "49.00",
    "currency": "USD",
    "paid_amount": "0.00072341",
    "paid_asset": "BTC",
    "status": "completed",
    "txid": "a1b2c3d4e5f6...",
    "confirmations": 3,
    "network": "bitcoin",
    "metadata": {
      "platform": "fossbilling",
      "fossbilling_invoice_id": "42",
      "fossbilling_client_id": "7"
    }
  }
}
```

## Idempotency

The plugin checks whether an invoice is already marked paid before processing a `payment.completed` event. Duplicate webhooks for the same payment are safely ignored.

## Testing Webhooks

Use the CoinPayPortal sandbox and enable **Debug Logging** in the gateway settings to trace webhook receipt, signature verification, and invoice matching in your PHP error log.
