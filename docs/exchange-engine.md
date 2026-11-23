# Exchange Engine

Provider-neutral crypto ↔ crypto quotes and orders in front of THORChain and
ChangeNOW, with fiat rails designed in but hard-disabled. Code:
`src/lib/exchange/`, routes `src/app/api/exchange/`, schema
`supabase/migrations/20261122140000_exchange_engine.sql`.

**Status: internal mode in prod (2026-11-23).** Only allowlisted test wallets
can use it; everyone else gets 503 `engine_disabled`. Public launch
(`EXCHANGE_ENGINE_ENABLED=true`) is a business/legal decision, not an
engineering one. See *Launch gate* below.

Prod end-to-end test (no funds move): `node scripts/exchange-e2e.mjs create`
once, put wallet A in `EXCHANGE_INTERNAL_WALLETS`, then
`node scripts/exchange-e2e.mjs run`. 27 checks passed on prod on 2026-11-23.
The quote route allows 15 requests per minute per IP, so wait a minute
between runs.

## Boundaries (enforced in code)

- Non-custodial. An order returns a `nextAction` the **user's wallet** signs and
  broadcasts. No endpoint accepts a key or seed phrase; CoinPay never signs.
- No identity data. CoinPay stores provider order ids, status words and tx
  hashes. A provider that wants KYC runs it on its own pages.
- No custodial ledger. There is no balance table; nothing routes through Mercury.
- Separate from escrow. No escrow table, contract or balance is touched.
- UI copy: never "no KYC" or "anonymous". The quote response carries the
  disclosure: *CoinPay does not collect identity documents for this flow. The
  selected provider may require verification under its own policy.*

## Architecture (as built)

The original plan assumed Bun + Hono. CoinPay is **Next.js 16 + Supabase
Postgres on dev2**, so the engine is a module inside the existing app:

| Module | File | Notes |
|---|---|---|
| Asset registry | `assets.ts` | Only assets the web wallet holds. THORChain pool ids checked against `/thorchain/pools` |
| Policy gate | `policy.ts` | Fail closed, kill switches, versioned decisions (`POLICY_VERSION`) |
| Quote router | `router.ts` | Parallel, 10 s per provider, ranked by **delivered amount** (exact decimals), ties prefer no-verification |
| Order manager | `orders.ts` | Insert-first idempotency, compare-and-set transitions, append-only events, 15 s poll throttle |
| State machine | `state.ts` | Terminal states never reopen; backwards reports are kept as evidence, not applied |
| THORChain | `providers/thorchain.ts` | Re-quotes at order time, checks the vault isn't halted or rotated, `send_with_memo` plan, status via `/thorchain/tx/status` |
| ChangeNOW | `providers/changenow.ts` | Wraps `src/lib/swap/changenow.ts`; `finished` without a `payoutHash` goes to `manual_review` |

Order states: `created → awaiting_user_action → submitted → pending → completed`,
plus `expired`, `cancelled`, `failed`, `refund_pending`, `refunded`, `manual_review`.
A provider "completed" without a payout tx hash is never accepted as completed.

## API

| Method | Path | Auth |
|---|---|---|
| GET | `/api/exchange/assets` | none |
| POST | `/api/exchange/quotes` `{from,to,amount,destinationAddress?,refundAddress?}` | none, 15/min/IP |
| POST | `/api/exchange/orders` `{quoteId,destinationAddress,refundAddress?}` + `Idempotency-Key` | wallet signature, 20/h/wallet |
| GET | `/api/exchange/orders` | wallet |
| GET | `/api/exchange/orders/:id` | wallet (polls provider) |
| POST | `/api/exchange/orders/:id/submit` `{txHash}` | wallet |
| POST | `/api/exchange/orders/:id/cancel` | wallet, only before funds move |
| GET | `/api/exchange/providers/status` | admin |

Quotes are stored and expire after the provider's expiry or 10 minutes,
whichever comes first. A stale quote is refused (`409 quote_expired`).

## Configuration

| Env | Default | Meaning |
|---|---|---|
| `EXCHANGE_ENGINE_ENABLED` | unset (off) | `internal` = allowlisted wallets only, `true` = public |
| `EXCHANGE_INTERNAL_WALLETS` | none | Comma-separated wallet ids admitted in `internal` mode |
| `EXCHANGE_DISABLED_PROVIDERS` | none | e.g. `thorchain,changenow` |
| `EXCHANGE_DISABLED_ASSETS` | none | e.g. `DOGE,USDT_SOL` |
| `EXCHANGE_BLOCKED_COUNTRIES` | `CU,IR,KP,SY` | Replaces the default when set |
| `EXCHANGE_FIAT_APPROVED_JURISDICTIONS` | none | Fiat stays denied even when set: no fiat adapter exists |
| `THORNODE_URL` | `https://gateway.liquify.com/chain/thorchain_api` | ninerealms stopped resolving in 2026 |
| `THORCHAIN_AFFILIATE` / `THORCHAIN_AFFILIATE_BPS` | unset | Affiliate fee only when both are set (bps 1–100) |
| `CHANGENOW_API_KEY` | existing | ChangeNOW is skipped as `not_configured` without it |

Country comes from `cf-ipcountry` only when `TRUST_VENDOR_IP_HEADERS=true`.
Unknown country is allowed for crypto and refused for fiat.

## Launch gate (not engineering)

Before `EXCHANGE_ENGINE_ENABLED=true` in production:

1. Written U.S./California analysis (DFAL licensing took effect 2026-07-01;
   FinCEN FIN-2013-G001) of this exact flow: CoinPay quotes, routes and earns
   any affiliate fee, and never takes custody.
2. A decision on the THORChain affiliate fee (it changes the revenue model
   counsel reviews).
3. Wallet support for `send_with_memo` (below), or ship ChangeNOW-only first.

Fiat (Coinbase / MoonPay on/off-ramp) remains Phase 2 and needs provider,
banking and legal approval on record first. P2P fiat is Phase 3, a separate
legal project.

## Not built yet (Phase 1 follow-ups)

- **Wallet execution of `send_with_memo`.** THORChain needs an OP_RETURN memo on
  UTXO chains and a `depositWithExpiry` router call on EVM. The web wallet's
  `prepare-tx` does plain sends only. Until it gains both, THORChain orders work
  from any external wallet that supports memos, not from the CoinPay wallet.
- Independent on-chain verification of the payout (amount and destination)
  rather than trusting THORNode / ChangeNOW's report.
- Background poller for open orders. Today, status advances when the order
  is read.
- LI.FI adapter for EVM same-chain and cross-chain routes.
- A CoinPay fee engine (deliberately not hard-coded before legal review).
- Wallet UI (SwapForm still calls the legacy `/api/swap/*` ChangeNOW routes),
  plus SDK, CLI and MCP surfaces.
