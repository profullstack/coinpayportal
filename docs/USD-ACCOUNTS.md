# Global USD accounts

Status: **shipped dark.** The feature is off unless `USD_ACCOUNTS_ENABLED=1` is
set AND a partner is configured. The page `/usd-account` is not in any nav.

## What it is

A user in Nigeria, Kenya, the Philippines, India, the EU or another supported
country gets a **named US bank account** (routing number and account number)
held by a licensed partner **in the user's own name**. US clients pay it by
ACH, wire, RTP or FedNow. The partner converts each deposit to USDC and delivers
it to a wallet address the user chose, for example their CoinPay payout wallet.

First target users: c0mpute / Infernet node operators and CoinPay merchants who
get paid in USD by clients who can only send a US bank transfer.

## The non-custodial rule

**CoinPay never holds, pools or moves user funds in this feature.** This is a
legal constraint, not a style choice.

- The partner opens the account in the user's name and runs KYC on its own
  hosted pages. CoinPay never sees documents, ID numbers or dates of birth.
- The partner receives the deposit, converts it and delivers it to the user's
  own wallet. The money never touches a CoinPay account.
- CoinPay stores references only: partner ids, status words, routing number,
  the last four of the account number and the destination wallet. The full
  account number is fetched live from the partner when the user views the page
  and is never written to the database (the table has no column for it).
- Deposits are recorded as the partner **reports** them by signed webhook.
  There is no balance, no ledger, no internal credit, no payout from a platform
  account and no "available to withdraw" figure.

Anything that changes one of those lines (a sweep into a CoinPay account, a
spendable in-app balance, a platform-funded advance) makes CoinPay a money
transmitter and needs counsel first.

## Provider status

| Provider | Status |
| --- | --- |
| Modern Treasury | Adapter written against public docs. KYB submitted 2026-11-22, pending. Not yet run against a sandbox. |
| Stub | Dev and tests only. Hard-off when `NODE_ENV=production`. |

## Configuration

| Variable | Meaning |
| --- | --- |
| `USD_ACCOUNTS_ENABLED` | Master flag. Must be `1`. Keys alone never turn the feature on. |
| `MODERN_TREASURY_ORG_ID` | MT organization id (HTTP Basic username). |
| `MODERN_TREASURY_API_KEY` | MT API key (HTTP Basic password). Sandbox or live; the key decides. |
| `MODERN_TREASURY_WEBHOOK_KEY` | MT webhook key, used to verify `X-Signature`. |
| `MODERN_TREASURY_CONNECTION_ID` | Optional. The PSP connection id, if the org has more than one connection. |
| `MODERN_TREASURY_USD_COUNTRIES` | Optional. Comma-separated ISO alpha-2 list that overrides the default country list. |
| `USD_ACCOUNTS_ENABLE_STUB` | Dev only. `1` enables the stub outside production. |
| `USD_ACCOUNTS_STUB_WEBHOOK_SECRET` | Dev only. HMAC key for stub webhooks (`x-stub-signature`). |

MT's webhook endpoint: `POST /api/webhooks/usd-accounts/modern_treasury`.

## Flow

1. `POST /api/usd-accounts` with `{ country, destination: { asset: "USDC", chain, address } }`.
   CoinPay writes a holder row and an account row first (unique per merchant
   and provider, deterministic idempotency keys), then creates a draft MT legal
   entity and a hosted onboarding flow. The response carries the onboarding URL.
2. The user finishes KYC on MT's hosted page.
3. MT sends `legal_entity.activated`. CoinPay opens the accounts, all owned by
   the user's legal entity: a USD internal account (the routing and account
   number), a USDC internal account, and a counterparty for the user's wallet.
4. MT sends `internal_account.activated`; the page shows routing and account
   number (the full number read live from MT).
5. Deposits: `incoming_payment_detail.completed` is recorded as
   `deposit.received`; a completed `book` payment order in USDC as
   `deposit.converted`; a completed `stablecoin` payment order as
   `deposit.delivered` (with the tx hash when MT sends one); a returned IPD as
   `deposit.returned`.

Every webhook is verified over the raw body before parsing, and deduped on
`(provider, event_id)`, where the event id for MT is `X-Webhook-ID` (stable
across MT's retries). Effects are applied before the event is recorded, so a
delivery that fails half-way is retried in full, and every effect is idempotent.

## How deposits reach the user's wallet

The partner moves the money: USD lands in the user's USD account, the partner
converts it to USDC and sends it to the user's wallet. CoinPay only records the
partner's reports.

**Open decision.** MT's public docs show conversion and delivery as payment
orders that the platform creates (one `book` order USD to USDC, then one
`stablecoin` order to the wallet). They do not document an automatic sweep.
So either MT offers auto-conversion for Global USD accounts, or CoinPay would
create those payment orders on the user's standing instruction. The second
keeps funds in user-named accounts end to end, but it means CoinPay instructs
movement of user funds. That is Anthony's and counsel's decision. Until it is
made, the adapter creates **no** payment orders.

## Chaining with remittance

Once USDC is in the user's wallet, `src/lib/remittance` (see
[REMITTANCE.md](./REMITTANCE.md)) can pay it out into a local rail (naira to a
bank account, shillings to M-Pesa, pesos to GCash) through a licensed payout
partner. The two features are independent: the USD account delivers USDC to
the user's wallet, and the user chooses whether to remit it. Neither leg
passes through a CoinPay balance.

## UNVERIFIED against MT (confirm in sandbox)

Each is a named constant in `src/lib/usd-accounts/modern-treasury.ts`.

1. `MT_DEFAULT_COUNTRIES`: MT publishes "more than 90 countries" with no list.
2. `MT_LEGAL_ENTITY_DRAFT_STATUS`: which required individual fields a `draft`
   legal entity may omit (date_of_birth, phone_numbers, addresses,
   identifications, terms_of_use).
3. `MT_FLOW_LEGAL_ENTITY_OPTION`: whether `POST /embeddable_flows` accepts
   `options.legal_entity_id` to resume an existing draft. It is documented only
   as a returned field.
4. `MT_ADDRESS_TYPE`: the non-Ethereum `*_address` values on counterparty
   wallet accounts (documented on internal accounts; the counterparty example
   shows only `ethereum_address`).
5. `MT_IPD_TYPE_TO_RAIL`: the `type` value MT uses for FedNow deposits
   (`fednow` is not in the documented enum).
6. `MT_TX_HASH_PATHS`: where a completed `stablecoin` payment order carries
   the on-chain tx hash.
7. `MT_DEPOSIT_LINK_METADATA_KEY`: how a conversion or delivery payment order
   links back to its incoming payment detail (needs metadata set by whoever
   creates the payment orders).
8. `MT_USDC_DECIMALS`: whether a USDC `book` payment order's `amount` is in
   USDC base units (6 decimals) or cents.
9. Whether MT auto-converts and delivers deposits for Global USD accounts, or
   the platform must create the payment orders (see the open decision above).
10. Whether the full `account_number` is returned on `GET /internal_accounts/{id}`
    for our org (MT hides it unless the Data Privacy setting is off). If it is
    hidden, the page shows only the last four, which is not enough to receive
    money.

Also note: MT Travel Rule enforcement starts 2026-11-30 for stablecoin payouts
of 3,000 USDC or more, which needs party name and address on the wallet
counterparty.
