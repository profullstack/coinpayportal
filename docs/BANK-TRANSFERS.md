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

The intended originator: a nationally chartered bank exposing ACH primitives
directly, chosen over a processor on top of a sponsor bank because there is no
intermediary whose risk appetite can withdraw the rail underneath us.

**The HTTP adapter is not written yet, on purpose.** Verified from Column's
published ACH transfer object: field names, `CREDIT`/`DEBIT`, `amount` in
cents, `currency_code`, `effective_on`, `entry_class_code`, the counterparty
references, and the status lifecycle — all of which are mapped and tested in
`src/lib/banking/column.ts`. Not verified: the wire format, authentication and
base URL, which their object reference does not state.

Three adapters in this repo were written blind against documentation and two
had real defects; Yellow Card's could never have authenticated at all. Doing
that again on a rail that moves money out of customers' bank accounts, rather
than one that returns a price, is not a trade worth making. The adapter goes in
when there is a sandbox key to check it against, and `providers.ts` does not
register Column until then — an unimplemented originator reporting itself
configured is worse than an absent one.

An unrecognised Column status maps to `pending`, never to a terminal state.
They can add statuses without asking us, and guessing `completed` would release
funds on a transfer whose real state we cannot read.

## Configuration

| Variable | Purpose |
|---|---|
| `BANKING_ENABLE_STUB` | `1` enables the in-memory stub. Ignored in production |

No Column variables yet; they land with the adapter.

## The stub

`StubBankProvider` validates identically to the real domain, honours
idempotency the way the originators promise, and can be driven through
settlement and then a **return**. That last path is the one most bank
integrations never exercise before launch, because triggering it with a real
bank is tedious — and it is also the one that loses money. Here it is one call,
so the handling code is tested from the start.

## Status

Domain, registry, stub, Column status mapping, schema and tests are in. No
money can move: no originator is registered, `getActiveBankProvider()` returns
null, and callers must handle that. Next step is a Column sandbox account,
then the adapter.
