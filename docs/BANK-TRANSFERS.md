# Bank transfers

Money in and out of a user's own bank account. The leg CoinPay was missing.

## ACH does not cross borders

Worth stating first, because it determines the shape of everything else. NACHA
ACH is a US-domestic network. There is no ACH transfer from a US bank to a
Nigerian or Indian one, and no configuration makes there be.

A cross-border transfer is therefore always three legs:

| Leg | Rail | Where it lives |
|---|---|---|
| 1. Pull USD from a US bank | ACH debit | **this module** |
| 2. Carry the value across the border | stablecoin | already built |
| 3. Pay into the recipient's local bank | NIP, UPI, Pix, SEPA… | `src/lib/remittance` |

Legs 2 and 3 already exist across 43 corridors. This module is only ever one
end of a transfer, and naming it *bank transfers* rather than *ACH* is
deliberate: a non-US domestic rail can implement the same interface later.

## Why a provider interface, not one integration

The card rail was written directly against a single processor, and losing
access to that processor left no path to money at all. That is the reason this
module exists, so it does not repeat the mistake. Everything is expressed in
our own vocabulary and an adapter translates; swapping originators is an
adapter, not a migration.

`src/lib/banking/types.ts` holds the domain, `providers.ts` the registry, and
one originator is active at a time. There is nothing to rank — unlike
remittance, where partners compete on price, a transfer either goes out on the
rail we are set up for or it does not go out at all.

## The two distinctions that carry the money safety

**`settled` is not `completed`.** Settled means the funds moved. Completed is
*our* decision to stop waiting for a return, not a promise from the network. An
ACH debit can be returned for up to sixty days on an administrative code, so
`canStillBeReturned()` deliberately returns true for `completed`. Code that
treats completion as final will eventually be wrong about real money.

**Direction is always from CoinPay's point of view.** "Debit" means opposite
things to a bank and to its customer, so it is pinned: `debit` pulls from the
user's bank into us, `credit` pushes out to them. Adapters translate rather
than passing the word through. Column additionally distinguishes a debit *we*
originate from one originated *against* us with `is_incoming`, and dropping
that flag books returns with the wrong sign — see `fromColumnType`.

## Idempotency is mandatory

`idempotencyKey` is a required field, never defaulted, and there is a unique
index on it in the database as well as a check in code. A retried create that
originates a second debit is the worst failure here, network timeouts guarantee
retries happen, and application-level checks race where a unique index does
not. A key generated on the retry would differ from the first attempt, which is
the exact case it exists to prevent — hence required rather than optional.

## Column

The originator: a nationally chartered bank exposing ACH primitives directly,
chosen over a processor on top of a sponsor bank because there is no
intermediary whose risk appetite can withdraw the rail underneath us.

`src/lib/banking/column-provider.ts` is written against a live sandbox, not
against documentation, after three adapters in this repo were written blind
and two had defects. Two things the sandbox corrected: counterparty
`account_type` is lowercase while transfer `type` is uppercase in the same API,
and NACHA caps `receiver_name` at 22 and `receiver_id` at 15 characters on
`WEB`, enforced by rejection. Auth is HTTP Basic with an empty username and
the key as the password. Column echoes `Idempotency-Key`, so a retried create
returns the original transfer.

## The caller

`src/lib/banking/service.ts` is what moves money, over the `/api/banking`
routes and from the payments cron.

**Insert first, originate second.** A transfer row is written as `initiated`
with its idempotency key before the originator is called. The unique index on
that key is therefore what stops two racing requests from originating twice,
which no application-level check can promise. If the provider rejects the
transfer, the row is marked `failed` with the reason. If the process dies
between the insert and the provider call, the row is left without a provider
id and the sweep re-submits it two minutes later under the same key, so an
originator that did receive the first attempt returns it rather than debiting
again.

**The sweep** (`sweepBankTransfers`, called from `/api/cron/monitor-payments`)
polls every in-flight transfer. When the provider reports settlement it
records `settled_at`, starts a hold of `BANK_TRANSFER_HOLD_DAYS`, and marks
the transfer `completed` once the hold passes. Completed transfers are
re-checked once a day for sixty days, and a return in that window is recorded
as a return with its code, after completion. A `failed` or `canceled` word
from the provider never un-settles money that has moved.

**Bank accounts** are linked through `POST /api/banking/accounts`. The
account number goes to the originator and is not stored: `bank_counterparties`
holds the provider's reference, the routing number and the last four digits.
The routing number is checked against the ABA checksum before any provider
call.

| Route | Purpose |
|---|---|
| `GET /api/banking` | Whether a rail is enabled, which originator, the hold |
| `GET/POST /api/banking/accounts` | Linked bank accounts; link one |
| `DELETE /api/banking/accounts/:id` | Stop using an account (kept for history) |
| `GET/POST /api/banking/transfers` | Transfers; originate one. `idempotencyKey` required, or an `Idempotency-Key` header |
| `GET /api/banking/transfers/:id` | One transfer |

Direction is always from CoinPay's point of view: `debit` pulls from the
user's bank into us, `credit` pays out to them. `/banking` is the merchant
page over these routes.

## Paying by bank, wherever a payment is taken

ACH is offered as a way to pay on the payment page and the invoice page, next
to crypto, card and PayPal. The buyer enters the name on the account, routing
number, account number and type; the routing number is checked against the ABA
checksum, the fraud layer must say `allow`, and the charge must be in USD.

A pay-in is a bank transfer of kind `payin` tied to `payment_id` or
`invoice_id`, with the platform fee recorded at the merchant's tier. The
payer's account becomes a counterparty with role `payer`: it is never listed
on the merchant's page and can never be a payout destination.

**A submitted debit is not a paid invoice.** Nothing happens to the payment or
invoice until the transfer is `completed` (settled and past the hold). Then the
payment is `confirmed` or the invoice `paid` with `settlement_method: 'ach'`,
and the merchant webhook fires (`payment.confirmed` / `invoice.paid`). A return
that lands after completion reverses it: the payment becomes `failed`, the
invoice goes back to `sent`, and the merchant is told again
(`payment.failed` / `invoice.payment_returned`) with the return code. Both
writes are conditional on the current status, so a repeated cron tick cannot
confirm or notify twice. See `src/lib/banking/payin.ts`.

| Route | Purpose |
|---|---|
| `GET/POST /api/payments/:id/ach` | Is bank payment offered; start one; poll it |
| `GET/POST /api/invoices/:id/ach` | The same for an invoice |

## Balance and payouts

`balanceFromLedger` in `service.ts` is what a merchant may pay out: completed
pay-ins and funding count in (net of fee), payouts count out from the moment
they are originated, and a pay-in returned after completion counts out again.
A payout above the balance is refused with 409. Two concurrent payouts can
both pass the check; the ledger then goes negative and the next is refused,
which is the accepted bound until a reservation exists.

**Where the money sits.** Every debit lands in the account
`COLUMN_BANK_ACCOUNT_ID` names and every payout leaves it, so that account
holds merchants' money between the two. `plans/fiat-onramp-strategy.md` is
explicit that holding merchant funds is money transmission. The way out is
Column's platform model, where each merchant is a Column entity with its own
account and a pay-in lands there directly; that needs Column to approve the
platform structure and a per-merchant KYB flow, neither of which is built.
Until then this is the exposure, and it is the reason the rail is not switched
on by a config value alone.

## Configuration

| Variable | Purpose |
|---|---|
| `COLUMN_API_KEY` | Column API key. A `test_` key is the sandbox; the base URL is the same |
| `COLUMN_BANK_ACCOUNT_ID` | The Column bank account transfers originate from. Required with the key: a key alone authenticates and then fails every transfer |
| `BANK_TRANSFER_HOLD_DAYS` | Days after settlement before a transfer is reported complete. Default 5 |
| `BANKING_ENABLE_STUB` | `1` enables the in-memory stub. Ignored in production |

## The stub

`StubBankProvider` validates identically to the real domain, honours
idempotency the way the originators promise, and can be driven through
settlement and then a **return**. That last path is the one most bank
integrations never exercise before launch, because triggering it with a real
bank is tedious — and it is also the one that loses money. Here it is one call,
so the handling code is tested from the start.

## Status

Domain, registry, stub, Column adapter, the caller, routes, sweep, page,
pay-by-bank on the payment and invoice pages, the balance ledger and tests
are in. What is not: a Column production account. Column onboards the
originating entity (KYB) and issues the bank account that
`COLUMN_BANK_ACCOUNT_ID` names; until both env vars are set,
`getActiveBankProvider()` returns null, `/api/banking` reports
`enabled: false`, and no money can move. Wires and the stablecoin to USD
payout leg remain unbuilt.
