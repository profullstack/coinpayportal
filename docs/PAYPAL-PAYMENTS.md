# PayPal payments

PayPal is a first-class payment rail in CoinPayPortal, alongside crypto and
Stripe Connect. This document covers how it works, how it differs from the
Stripe rail, and what has to be configured before it can take money.

## Three ways a merchant can take PayPal

Ordered by setup cost, cheapest first. All three coexist.

### 1. PayPal.Me — no integration at all

The merchant saves a PayPal.Me link the way they save Venmo / Cash App / Zelle
handles, under Business → 3rd Party. The customer pays them directly and the
merchant marks the invoice paid. CoinPay is display and bookkeeping only; it
never touches the money and takes no fee.

This is entirely catalog-driven: the `paypal_manual` row in
`payment_method_catalog` (migration `20260902160000_paypal_manual_method.sql`)
is the whole feature. It is a **separate `method_id` from `paypal`** on purpose
— the manual list selects on `integration_type = 'manual'`, so overloading the
automated row would either hide that rail or drag this one into the payment
resolver. Two products that share a brand.

### 2. Own API credentials — the default automated rail

The merchant creates a REST app in their own PayPal Developer Dashboard and
pastes the Client ID and Secret. Minutes of work, entirely on their side, and
**it needs nothing from PayPal beyond a developer account**. They get the full
rail: order creation, capture, webhooks, refunds, transactions dashboard.

CoinPay earns **0%** here, because PayPal rejects `platform_fees` on a
first-party order. That is the accepted trade for it working without
underwriting, and it is why this is the mode the dashboard leads with.

### 3. Connect with PayPal — OAuth, and the only mode that earns

PayPal Partner Referrals: the merchant signs in to their own PayPal account and
approves CoinPay, with nothing to copy or paste. CoinPay then acts on their
behalf via `PayPal-Auth-Assertion` and takes a tiered `platform_fees` cut, the
same economics as the Stripe destination charge.

**This requires CoinPay to be an approved PayPal Commerce Platform partner** —
an application, an integration checklist, videos, and a review, not a config
toggle. The button therefore only appears when the server actually holds partner
credentials; offering it otherwise sends the merchant to something that cannot
work.

| | **2. Own credentials** | **3. Connect with PayPal** |
|---|---|---|
| Merchant effort | Paste 2 values | Sign in, approve |
| Needs PayPal approval of CoinPay | No | **Yes** |
| Who CoinPay authenticates as | The merchant | The platform, acting on the merchant |
| Where funds land | Merchant's PayPal, directly | Merchant's PayPal, directly |
| **CoinPay commission** | **0%** | **1% free / 0.5% paid** |

Modes 2 and 3 write the same tables. `paypal_accounts.connection_mode` records
which a row is, and `resolvePaypalContext()` in `src/lib/paypal/accounts.ts`
resolves either into one calling context, so no payment code branches on mode.
That is what lets mode 2 ship now and mode 3 arrive later without rework —
existing merchants can be migrated when approval lands.

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

With none of these set the app works normally: merchants connect with their own
credentials (mode 2), the "Connect with PayPal" button is hidden, and the webhook
endpoint returns 503. Only the commission-bearing mode is unavailable.

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
| `POST /api/paypal/connect` | Connect own credentials (default) | — |
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
