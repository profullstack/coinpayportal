# ACH pay-in

Buyers pay from a US bank account instead of a card. Stripe's `us_bank_account`
method on Checkout, on the existing Connect destination-charge flow, with a hold
before the merchant is told the payment landed.

## Why there is a hold at all

A card is authorised before it clears. An ACH debit is not. Stripe reports the
PaymentIntent as succeeded once the debit is *submitted*, and the bank can still
return it afterwards — R01 (insufficient funds) and R02 (account closed)
typically two to five business days later, administrative returns up to sixty
days out.

The failure that matters is a merchant reading "paid", shipping the goods, and
the debit coming back. The hold breaks that sequence: on the ACH rail the
transaction lands as `held` and the merchant webhook does not fire until it is
released.

## What the hold does not do

**It does not hold the money.** These are destination charges — funds route to
the merchant's connected account on Stripe's schedule whatever we record. To
actually hold funds we would have to take them onto the platform account and
transfer them out later, and a platform holding merchant money is doing money
transmission. `plans/fiat-onramp-strategy.md` rules that out in as many words:
an MSB with ~48 state licences is "not a CoinPay project". That is a licensing
decision, not a config value.

**Twenty-four hours does not cover the return window.** It is the configured
policy, not a safe one. It stops a merchant fulfilling in the first minutes
against a debit that has not begun to clear. It does nothing about an R01 four
days later. `ACH_HOLD_HOURS` exists so the window can be widened without a
deploy — set it to `120` and you cover the common return codes.

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `STRIPE_ACH_ENABLED` | to offer ACH at all | `1` turns the rail on. Off by default |
| `ACH_HOLD_HOURS` | no | Hold window, default `24`. A missing or unparseable value falls back to the default rather than disabling the hold |

`STRIPE_ACH_ENABLED` is a rollout gate rather than decoration. Naming
`payment_method_types` on a Checkout Session overrides whatever the merchant has
configured in their Stripe dashboard, so a connected account without ACH enabled
would fail session creation outright. Turn it on per environment once an account
is known good.

## Who is offered ACH

Three conditions, all required — see `achPayInEnabled` in
`src/lib/payments/ach-hold.ts`:

1. `STRIPE_ACH_ENABLED=1`.
2. The charge is in USD. Stripe's ACH is USD-only, and offering it elsewhere is
   an error at session creation rather than a declined payment.
3. The fraud layer returned `allow`. A `verify` decision forces 3-D Secure,
   which moves liability for a stolen card to the issuer — there is no
   equivalent for a bank debit, so a buyer we have already flagged must not be
   handed the one rail where we carry the loss.

## The event flow

ACH is a delayed-notification method, so the Checkout Session completes before
the money does:

| Event | `payment_status` | What we do |
|---|---|---|
| `checkout.session.completed` | `unpaid` | Nothing. Leave the placeholder pending |
| `checkout.session.async_payment_succeeded` | `paid` | Record `held` with a `hold_until` |
| `checkout.session.async_payment_failed` | — | Mark `failed` |
| payments cron, after `hold_until` | — | Flip to `completed`, fire the merchant webhook |

The guard on the first row matters: without it the existing handler would mark
an ACH session completed and notify the merchant at the moment the buyer clicked
pay, which is the exact thing this rail is meant to prevent.

Releasing filters on `status = 'held'` as well as on the timestamp, so two
overlapping cron ticks cannot release the same row and notify twice. The webhook
is sent by the cron rather than inside `releaseExpiredAchHolds`, because a
delivery failure must not roll the release back — the money settled either way,
and an undelivered notification is the retry queue's problem.

## Rails are now read, not assumed

The webhook used to write `rail: 'card'` on every row. Harmless while card was
the only rail; a mislabelled bank debit in the merchant dashboard and the fraud
history the moment ACH is on. `railFromCharge` reads
`payment_method_details.type` instead, and anything unrecognised is still
recorded as card.

## Status

Wired end to end and unit tested, but **not exercised against a live ACH
payment**. Stripe's test mode has account numbers that simulate success and
each return code; run one of each through a sandbox merchant before enabling the
flag in production, and confirm in particular that
`checkout.session.async_payment_succeeded` arrives with the metadata the handler
expects.
