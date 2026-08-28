# Fiat On-Ramp

Buying crypto with fiat, routed across several providers and ranked on the
amount that actually lands in the wallet.

Strategy and rationale: [`plans/fiat-onramp-strategy.md`](../plans/fiat-onramp-strategy.md).

## Why it is a router and not an integration

A ramp's disclosed fee is not its cost. MoonPay advertises bank transfer at
about 1%, but most of the margin lives in the rate it quotes, and that spread
has been reported as high as ~4.3%. A user comparing "1%" against "1.9%" can
easily pick the worse deal.

So this module never ranks on fee percentage. Every provider is asked what it
will actually deliver, the answer is re-priced against mid-market spot, and the
quotes are sorted by `receiveAmount`. The spread each provider took falls out of
that arithmetic and is published on the quote.

Two other things follow from routing rather than integrating:

- **No single point of failure.** A source that is down, slow or has no
  corridor for a country drops out of the ranking and is reported in
  `unavailable`. It never fails the request.
- **Chargebacks are not ours.** The user pays the ramp and the ramp delivers to
  the user's own address. The ramp is merchant of record, so a dispute is
  theirs. We never take custody, which is also what keeps this outside money
  transmission.

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `ONRAMPER_API_KEY` | for Onramper | Aggregator key; one credential reaches 30+ ramps |
| `TRANSAK_API_KEY` | for Transak | Second, independent source |
| `ONRAMP_ENABLE_STUB` | dev only | `1` enables synthetic quotes; ignored in production |

Keys belong in the `coinpayportal--prod` logicsrc vault and on the Railway
service, not in a `.env` file.

With no key set, the endpoints return **503** with a message naming the missing
variable — deliberately distinct from "no provider could quote this" (**502**),
so an outage on our side never reads as the user asking for something
unavailable.

## Endpoints

### `GET /api/onramp/quote`

`?fiat=USD&amount=500&asset=BTC&method=bank_transfer&country=US`

`method` and `country` are optional. Returns `best`, the full ranked `quotes`
array, the `spotRate` used to price them, and `unavailable`.

Each quote carries the provider's own figures plus the derived ones:

- `receiveAmount` — crypto units delivered. The ranking key.
- `fees` — `{ provider, network, payment, total }`, in fiat.
- `allInCostPct` — total cost against mid-market, fees *and* spread.
- `spreadPct` — `allInCostPct` minus the disclosed fee. The hidden half.
- `midMarketReceiveAmount` — what a zero-fee fill would have delivered.

The three derived fields are `null` when spot is unavailable rather than
guessed. Ranking never depends on spot, so a pricing outage degrades the spread
column without taking quoting down.

### `POST /api/onramp/session`

```json
{ "asset": "BTC", "amount": 500, "walletAddress": "bc1q…", "fiat": "USD" }
```

Optional: `source`, `provider`, `method`, `country`, `redirectUrl`,
`externalId`. Returns a hosted-flow URL to send the user to.

Unauthenticated by design: it creates no record, moves no money and holds no
custody — it composes a URL to a third party. It is rate limited because it is
otherwise a cheap way to burn provider quota.

The destination address is validated against the asset's settlement chain where
`validateAddress` can judge it (BTC, BCH, ETH, POL, SOL). For other chains the
address is passed through unchecked rather than rejected, because a validator
with no opinion must not break a supported asset.

### `GET /api/onramp/assets`

Assets we can receive, payment methods, and which sources are configured.
Reports our supported list rather than the union of provider catalogues: an
asset a provider sells but the wallet cannot receive is not purchasable.

## National payment rails

Onramper names each country's instant rail rather than calling it a generic
bank transfer, so the adapter maps them explicitly: Interac (CA), SPEI (MX),
InstaPay and PESONet (PH), NIP (NG), NAPAS and VietQR (VN), SEPA (IE and the
euro area), Faster Payments (UK), ACH (US), UPI (IN).

Without those entries each one falls through to `other`, and a
`method=bank_transfer` filter silently drops the only rail a local buyer would
reach for — the rail people actually use is never the generic one.

Wallets are a separate method (`ewallet`), not a bank transfer: GCash and Maya
in the Philippines, MoMo, ZaloPay and VNPay in Vietnam, OPay and PalmPay in
Nigeria. In several of those markets the wallet is the dominant way to pay.

## Adding a source

Implement `OnrampProvider` (`src/lib/onramp/types.ts`) and add it to the
registry in `providers.ts`. Nothing else changes — the router does the spread
maths and the ranking for every source uniformly, which is deliberate: a
provider adapter must not be able to flatter its own numbers.

## Status

Both live adapters are written against documented API shapes but have **not**
been exercised against a real key. Field mapping — particularly Onramper's fee
breakdown — should be verified against a live response before the numbers are
trusted. `parseQuote` in each adapter drops anything it cannot interpret rather
than emitting a quote with invented values, so the failure mode is a missing
provider, not a wrong price.
