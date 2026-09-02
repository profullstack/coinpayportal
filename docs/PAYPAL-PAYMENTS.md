# PayPal payments

PayPal is a first-class payment rail in CoinPayPortal, alongside crypto and
Stripe Connect. This document covers how it works, how it differs from the
Stripe rail, and what has to be configured before it can take money.

## How a merchant connects

**Merchants connect by signing in to PayPal — there is nothing to copy or paste.**
"Connect with PayPal" sends them through PayPal Partner Referrals, PayPal's OAuth
onboarding for platforms: they sign in to their own PayPal account, approve
CoinPay, and come back connected. CoinPay then acts on their behalf using
`PayPal-Auth-Assertion`, exactly as the Stripe rail acts on a connected account.

Funds settle directly to the merchant's own PayPal balance. CoinPay never holds
them, and takes its commission as a PayPal `platform_fees` entry on each order.

### The deprecated credential mode

An earlier version asked merchants to paste a REST app Client ID and Secret.
That path is **no longer offered in the dashboard**, for two reasons:

- it made the merchant handle a client secret that OAuth onboarding never needs;
- PayPal treats those calls as **first-party** and rejects `platform_fees` on
  them, so such a connection can never carry CoinPay's commission — it earns 0%.

`POST /api/paypal/connect` still exists and still works, because businesses
connected that way are live in production and the invoice flows read that shape.
It is marked deprecated in code. Nothing new should be built on it.

| | **Partner** (how merchants connect) | **Self-serve** (deprecated, legacy rows) |
|---|---|---|
| How the merchant connects | Signs in to PayPal and approves CoinPay | Pasted their own Client ID + Secret |
| Who CoinPay authenticates as | The platform, acting on the merchant | The merchant |
| Where funds land | The merchant's PayPal account, directly | The merchant's PayPal account, directly |
| **CoinPay commission** | **Tiered `platform_fees` (1% free / 0.5% paid)** | **None — 0%** |
| Offered in the dashboard | Yes | No |

Both shapes coexist at runtime. `paypal_accounts.connection_mode` records which
one a row is, and `resolvePaypalContext()` in `src/lib/paypal/accounts.ts`
resolves either into a single calling context, so no payment code branches on
mode.

## Configuration

Partner mode needs these set on the running service. They live in the logicsrc
team vault `coinpayportal--prod`, not in a `.env` file.

| Variable | Required | What it is |
|---|---|---|
| `PAYPAL_PLATFORM_CLIENT_ID` | yes | Partner REST app client id |
| `PAYPAL_PLATFORM_CLIENT_SECRET` | yes | Partner REST app secret |
| `PAYPAL_PARTNER_MERCHANT_ID` | yes | CoinPay's own PayPal merchant id — the payee of every platform fee |
| `PAYPAL_WEBHOOK_ID` | for webhooks | The partner app's webhook id; without it inbound webhooks are refused |
| `PAYPAL_BN_CODE` | recommended | Partner attribution id (BN code) |
| `PAYPAL_ENVIRONMENT` | no | `sandbox` or `live` (default `live`) |

With none of these set, **no business can connect PayPal**: the dashboard says
onboarding is unavailable and asks for an administrator, and the webhook endpoint
returns 503. Existing connections keep working. There is deliberately no
credential-paste fallback — the fix is to configure the server, not to offer a
mode that earns nothing and hands the merchant a secret to manage.

Getting the partner credentials is an account task, not a code one — CoinPay
must be enrolled in **PayPal Commerce Platform (PPCP)** as a partner, which
PayPal grants per-account.

## Merchant onboarding

1. Merchant clicks **Connect with PayPal** on Business → 🅿️ PayPal → PayPal Connect.
2. `POST /api/paypal/connect/onboard` creates a Partner Referral and writes a
   `paypal_accounts` row in partner mode with `connected = false`. The row
   exists from this moment so that whichever of the two return paths arrives
   first has something to attach to.
3. The merchant completes onboarding at PayPal and is redirected to
   `/businesses/{id}?paypal=connected`.
4. Two independent things then confirm it:
   - the dashboard calls `PATCH /api/paypal/connect/onboard`, which reads the
     merchant integration back from PayPal;
   - the `MERCHANT.ONBOARDING.COMPLETED` webhook does the same.

   Both write the same fields and both are safe to run twice. The dashboard call
   exists because the webhook can lag by minutes — long enough for the merchant
   to look at the page, see "not connected", and start over.

A business is only marked `connected` when PayPal reports **both**
`payments_receivable` and third-party OAuth scopes granted. Marking it connected
any earlier produces an account whose first real order fails.

`merchantIdInPayPal` on the return URL is used only as a **lookup key**, never
stored directly — trusting it would let anyone bind an arbitrary PayPal account
to a business they control. Everything persisted comes from PayPal's own
response, and a `tracking_id` that names a different business is refused.

## Taking a payment

```
POST /api/paypal/payments/create
{
  "businessId": "…",
  "amount": 100.00,          // MAJOR units — see below
  "currency": "USD",
  "description": "Order #1234",
  "customerEmail": "buyer@example.com"
}
→ { "approve_url": "https://www.paypal.com/checkoutnow?token=…",
    "checkout_url": "…",     // alias, so Stripe-rail integrations read the same field
    "order_id": "…", "transaction_id": "…",
    "platform_fee_amount": 1, "platform_fee_supported": true }
```

Redirect the payer to `approve_url`. PayPal returns them to
`/pay/paypal/return`, which captures the order and shows a receipt.

### Money units — read this before integrating

`amount` on this rail is in **major units** (`100.00` is one hundred dollars),
matching PayPal's own decimal API and what `paypal_transactions.amount` stores.
The Stripe rail's `amount` is **minor units** (cents).

An integration that switched rails and reposted the same body would otherwise be
charged 100x or 1/100th with no error anywhere, so:

- `amount_cents` is accepted as an explicit alternative and wins when present;
- passing **both** `amount` and `amount_cents` is rejected rather than guessed at;
- `GET /api/paypal/transactions` returns both `amount` and a derived
  `amount_cents` so a client that already speaks cents needn't guess.

Note that `paypal_transactions.amount` (NUMERIC, major) and
`stripe_transactions.amount` (bigint, minor) are **not** directly comparable.
Multiply by 100 before summing across rails, and beware zero-decimal currencies
such as JPY where that factor is wrong.

### Settlement

A payment settles through two independent paths that must agree:

- **the payer's return leg** — fast, but only if they don't close the tab;
- **the `PAYMENT.CAPTURE.COMPLETED` webhook** — reliable, but can lag.

Both call `settlePaypalCapture()`, which claims the row with a conditional
`UPDATE … .neq('status', 'completed')`. Postgres serialises the two updates, so
the loser matches zero rows and reports `alreadySettled` — only the winner sends
the merchant's outbound webhook. This is a real lock, not a check-then-act race.

The merchant webhook is dispatched after the row commits and failures there are
swallowed: a merchant endpoint being down must not make PayPal retry a capture
already banked.

## Webhooks

Point a PayPal webhook at `POST /api/paypal/webhook` and set `PAYPAL_WEBHOOK_ID`
to its id. Subscribe to:

- `CHECKOUT.ORDER.APPROVED`
- `PAYMENT.CAPTURE.COMPLETED`
- `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.DECLINED`, `PAYMENT.CAPTURE.REVERSED`
- `PAYMENT.CAPTURE.REFUNDED`
- `MERCHANT.ONBOARDING.COMPLETED`
- `MERCHANT.PARTNER-CONSENT.REVOKED`

Two differences from Stripe shape the handler:

1. **There is no local HMAC.** Verification is a round trip to PayPal's
   `/v1/notifications/verify-webhook-signature`. `verifyPaypalWebhookSignature()`
   returns `false` rather than throwing on any error, so a caller cannot
   accidentally accept an event by catching. Anything not `SUCCESS` gets a 401.

2. **PayPal re-delivers.** Every event is claimed in `paypal_webhook_events`
   (UNIQUE on the PayPal event id) before any work happens. A duplicate loses
   that insert and returns 200 without reprocessing.

A handler that throws still returns 200, with the error recorded on the ledger
row — a PayPal retry would hit the same bug and only delay the queue. That table
is the thing to read when a payment is stuck.

## Refunds

```
POST /api/paypal/transactions/{id}/refund
{ "amount": 5.00 }   // omit for a full refund
```

Owner-only (`funds.move`). On a partner order PayPal proportionally reverses the
platform fee along with the payment, so CoinPay's commission unwinds by itself —
there is no `refund_application_fee` flag as on Stripe. The route writes an
optimistic view so the dashboard updates immediately; the
`PAYMENT.CAPTURE.REFUNDED` webhook carries the authoritative totals.

If PayPal accepts the refund but the local write fails, the route returns
**success with a warning** rather than an error. The money has moved; reporting
failure would invite the merchant to refund twice.

## API surface

| Route | Purpose | Stripe analogue |
|---|---|---|
| `POST /api/paypal/connect/onboard` | Start partner onboarding | `POST /api/stripe/connect/onboard` |
| `PATCH /api/paypal/connect/onboard` | Finish / re-check onboarding | (implicit in account retrieve) |
| `GET /api/paypal/connect/status/{businessId}` | Connection state | `GET /api/stripe/connect/status/{id}` |
| `POST /api/paypal/connect` | **Deprecated** — paste own credentials | — |
| `DELETE /api/paypal/connect` | Disconnect | `POST /api/stripe/connect/disconnect` |
| `POST /api/paypal/payments/create` | Open an order | `POST /api/stripe/payments/create` |
| `POST /api/paypal/payments/capture` | Capture (payer-facing, unauthenticated) | — |
| `POST /api/paypal/webhook` | Inbound PayPal events | `POST /api/stripe/webhook` |
| `GET /api/paypal/transactions` | List transactions | `GET /api/stripe/transactions` |
| `POST /api/paypal/transactions/{id}/refund` | Refund | same |
| `GET /api/paypal/balance` | Merchant balance | `GET /api/stripe/balance` |

`/api/paypal/payments/capture` is deliberately unauthenticated — the payer is
not a CoinPay user. It is safe because it has no free parameters: it captures
only an order that already exists as a row we created, with credentials the
caller never sees, for an amount they cannot influence, and settlement is
idempotent.

## Known gaps

- **Invoices still use self-serve only.** `createInvoicePaypalOrder()` and the
  invoice capture route call `getBusinessPaypalCredentials()`, which returns
  null for a partner-onboarded business. A business connected through partner
  mode can take PayPal payments through the payments API but not yet on an
  invoice. Invoicing is owned separately, so this was left alone deliberately
  rather than changed underneath it; the fix is to swap those two call sites to
  `resolvePaypalContext()`.
- **No disputes surface.** The onboarding referral requests the seller-dispute
  scopes, but no dispute routes or dashboard panel exist yet. The Stripe rail
  has both.
- **No 3-D Secure equivalent.** The fraud screen's `verify` decision forces 3DS
  on the Stripe rail. PayPal exposes no per-order step-up, so an elevated score
  is logged and allowed through rather than silently treated as stepped up.
- **Balance needs a scope the merchant can decline.** `GET /api/paypal/balance`
  returns `available: false` with a reason instead of failing.
