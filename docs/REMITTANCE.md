# Remittance

Crypto in, local fiat out, across 43 corridors: Latin America, Africa, South
and Southeast Asia, the Middle East, the euro area, Eastern Europe and Oceania.

Strategy: [`plans/fiat-onramp-strategy.md`](../plans/fiat-onramp-strategy.md).

## The shape, and why it is this shape

The sender funds with stablecoin they already hold. The recipient is paid in
pesos over SPEI, or Philippine pesos into GCash, a bank or a cash counter,
through a partner's licensed local rail.

We never take the sender's dollars. That is the whole design: **the US
money-transmission leg does not exist for us**, so what remains is a payout
integration operating under the partner's licence rather than a remittance
business needing its own. It is the same structural move as the on-ramp — let
the licensed party be the licensed party.

Quotes are ranked on the **local currency the recipient actually receives**, not
on the fee a partner discloses. On this market the FX margin is usually the
larger half of the cost: Xoom on a $200 send to the Philippines charges $4.99
and takes a further 4.49% in the rate. The router re-prices every quote against
mid-market FX and publishes the margin it recovers.

## What you are undercutting

| Corridor | Incumbent all-in | Payout rails | Partner |
|---|---|---|---|
| US→MX | ~4.5% | SPEI (24/7), cash pickup, DiMo | Bitso |
| US→PH | ~5–7% | GCash, Maya, InstaPay, PESONet, cash pickup | TransFi |
| US→NG | ~5.5% | NIP (every bank), OPay/PalmPay/Kuda | Yellow Card |
| US→VN | ~5% | NAPAS 247, VietQR, MoMo/ZaloPay/VNPay | TransFi |
| US→CA | **~0.75%** | Interac e-Transfer, EFT | Cybrid |
| US→IE | **~0.65%** | SEPA Instant, SCT | TransFi |

Canada and Ireland are the odd ones out and are marked `matureCorridor`. Wise
moves USD→CAD and USD→EUR for well under 1%, so the cost argument that carries
the other corridors does not carry there — we are at parity, and the page says
so rather than inventing a saving. What those corridors buy is settling from
stablecoin in minutes.

Measured against that, a live Bitso quote today is **1000 USDC → ~16,929 MXN at
17.02, on a $5.50 total fee** — around 0.55% all-in.

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `TRANSFI_API_KEY` | for most of the map | The breadth partner: 37 corridors across Asia, MENA, Europe and South America. One missing key takes all of them down together |
| `BITNOB_CLIENT_ID` / `BITNOB_CLIENT_SECRET` | for Africa | Six corridors — NG, KE, GH, ZA, UG, TZ. Both halves are required; signing needs the secret |
| `YELLOWCARD_API_KEY` / `YELLOWCARD_API_SECRET` | second partner for US→NG | Stablecoin into NGN over NIP. Both halves required |
| `CYBRID_API_KEY` | for US→CA | Stablecoin into CAD over Interac or EFT |
| `BITSO_API_KEY` / `BITSO_API_SECRET` | to settle MX | Quoting works without them; payouts will not |
| `BITSO_FEE_PCT` | no | Commercial rate, default `0.5` |
| `BITSO_FEE_FIXED_USD` | no | Default `0` |
| `BITSO_NETWORK_FEE_USD` | no | Default `0.5` |
| `REMITTANCE_ENABLE_STUB` | dev only | `1` enables synthetic quotes; ignored in production |

Keys belong in the `coinpayportal--prod` logicsrc vault and on the Railway
service, not in a `.env` file.

**Mexico quotes need no credentials at all.** Bitso's public ticker is the price
source, so that corridor is quotable today, against a real order book, before
anyone signs anything. The Philippines has no equivalent public rate and needs
TransFi.

## Coverage, and who covers it

| Region | Corridors | Partner |
|---|---|---|
| North America | MX, CA | Bitso, Cybrid |
| Africa | NG, KE, GH, ZA, UG, TZ | Bitnob, and Yellow Card for NG |
| South Asia | IN, PK, BD, LK, NP | TransFi |
| Southeast Asia | PH, VN, ID, TH, MY, SG | TransFi |
| Middle East, North Africa | AE, SA, TR, EG | TransFi |
| Euro area | IE, DE, FR, ES, IT, NL, PT | TransFi |
| Eastern Europe | PL, RO, UA, CZ, HU, BG, RS | TransFi |
| Oceania | AU | TransFi |
| South America | BR, AR, CO, CL, PE | TransFi |

Each corridor names the rail a recipient actually uses rather than "bank
transfer": UPI and IMPS in India, Pix in Brazil, PromptPay in Thailand, BLIK in
Poland, PayID over NPP in Australia, M-Pesa in Kenya and Tanzania, MTN MoMo in
Ghana and Uganda. In the African and South Asian corridors the mobile wallet is
the account of record, so `ewallet` is listed ahead of `bank`; paying into a
bank and leaving the recipient to reach a branch defeats the point.

**Two partners overlap on Nigeria on purpose.** Bitnob and Yellow Card both
quote NGN and the router ranks them on delivered naira, so whichever actually
pays more wins. Bitnob went in first for a practical reason: its sandbox keys
are self-serve, so the adapter can be verified against a real response, whereas
Yellow Card starts with a partnership call.

**Coverage is a claim until a key proves it.** TransFi's corridor list is taken
from its published payout countries and has not been confirmed key-in-hand for
each one. A corridor it turns out not to serve fails as an empty quote list, so
the cost of listing one too many is a corridor that reports as unavailable —
never a wrong price.

## A note on India

`US-IN` is a compliance question before it is an engineering one. Inbound
remittance to India runs under RBI rules, and INR is not freely convertible: a
partner paying into UPI or IMPS does so under its own authorisation, and the
crypto leg attracts its own treatment. The corridor and its rails are modelled
here so the routing works the day a partner is licensed for it. Do not enable
the corridor on the strength of a key alone.

## Endpoints

### `GET /api/remittance/quote`

`?asset=USDC&amount=1000&to=MX&method=bank&network=spei`

`method` and `network` are optional. Returns `best`, ranked `quotes`, the
`corridor`, `payoutCurrency`, `sendValueUsd`, the `midMarketFxRate` used, and
`unavailable`.

Each quote carries the partner's own figures plus the derived ones:

- `receiveAmount` — local currency delivered. The ranking key.
- `fees` — `{ provider, network, payout, total }`, in USD.
- `allInCostPct` — total cost against mid-market: fees *and* FX margin.
- `fxMarginPct` — `allInCostPct` minus the disclosed fee. The hidden half.
- `midMarketReceiveAmount` — what a zero-cost transfer would have delivered.

The derived fields are `null` when FX or crypto spot is unavailable, rather than
guessed. Ranking never depends on either, so a pricing outage degrades the
margin column without taking quoting down.

The send leg is priced at real spot rather than assumed 1:1 — a depegged or
mispriced stablecoin would otherwise distort every cost figure downstream.

**503** means no partner is configured for that corridor (our problem). **502**
means partners were asked and none could quote (theirs). The distinction is
deliberate.

### `GET /api/remittance/corridors`

Corridors, their payout rails and named networks, which have a live partner, and
which stablecoins may fund a transfer.

## The naira caveat

NGN has an official rate and a parallel-market rate a few percent apart. Our FX
reference quotes the official one, so a partner pricing off the market it
actually trades in can look like it has a *negative* margin. That is two
different markets being compared, not a bargain. `US-NG` carries
`fxReferenceContested`, and the router attaches a warning to every quote in that
corridor rather than publishing a confident wrong number.

The same effect shows up mildly on Mexico, where Bitso's book can beat the
reference by a few tenths of a percent. The UI never quotes a total cost below
the fee actually charged, so a reference disagreement can never make us look
cheaper than we are.

## The page

`/remittance` — pick a destination, enter an amount, see what lands, with the
fee and rate margin split out and the corridor's typical cost beside it.
Destinations come from `/api/remittance/corridors`, so a corridor with no
partner shows as unavailable instead of silently missing.

It quotes but cannot send, and says so.

## Adding a corridor or partner

Add a `CorridorSpec` to `CORRIDORS` in `types.ts`, implement
`RemittanceProvider`, and register it in `providers.ts`. Nothing else changes —
the router does the FX maths and the ranking uniformly, so a partner adapter
cannot flatter its own numbers.

## Status and what is deliberately missing

Quoting and corridor discovery are complete. **Transfer initiation is not
built**, and that is on purpose: actually moving money needs a persisted record,
authenticated senders, recipient details, and reconciliation against partner
webhooks. Shipping a route that instructs a partner to pay someone without first
recording that we did so would be worse than not having the route.

The Bitso adapter is verified against the live public API, including that Bitso
lists no `usdc_mxn` book. **Mexico is the only corridor proven end to end**, and
it is proven precisely because Bitso's public ticker needs no credentials.

Every other adapter is written against documented shapes and has **not** been
run against a real key. `parseQuote` drops anything it cannot interpret, so a
bad mapping shows up as a missing partner rather than a wrong price. Two
specific caveats worth carrying:

- **Bitnob's authentication is verified, its field names are not.** The signing
  scheme — `CLIENT_ID:TIMESTAMP:NONCE:PAYLOAD`, HMAC-SHA256 keyed with the
  client secret, hex-encoded, across four `X-Auth-*` headers — is taken from
  the published spec and pinned by a test that asserts the exact bytes. The
  quote request and response shapes are not. `buildQuoteBody` and `parseQuote`
  are the only two functions that should need correcting against a sandbox key.
- **Yellow Card's canonical string is a guess.** Their docs return 403 to
  automated fetches. The header format is right — `YcHmacV1 {apikey}:{sig}`
  plus an ISO8601 `X-YC-Timestamp` — and the previous `Bearer` token was
  definitively wrong, so this is closer. But the concatenation order inside
  `signRequest` is conventional rather than read off their page. A wrong
  signature fails as a 401, which the router reports as a partner that could
  not quote.

Corridor cost benchmarks come from secondary sources citing World Bank Q1 2025
data — the World Bank corridor pages refuse automated fetches. Verify the exact
percentages before using them in anything customer-facing.
