# Fiat On-Ramp Strategy — Can We Beat MoonPay?

> **DECISION: Rent the on-ramp, own the off-ramp.** Do not attempt to replicate MoonPay.
> Ship a provider-aggregating on-ramp module first (Play 1), then take the merchant
> off-ramp onto wholesale stablecoin rails (Play 2).
>
> Shareable one-pager: https://claude.ai/code/artifact/9e217903-c9c7-4ad0-a689-f35c00f28899
> Written 2026-08-28.

## Context

Exodus desktop routes its fiat on-ramp through MoonPay. The question was whether CoinPay
can beat that on both execution and value.

## Executive Summary

**On the licence: no.** MoonPay's moat is not the ~1% ACH fee, it is being a registered
MSB with roughly 48 US state money-transmitter licences plus EU/UK coverage. Replicating
that is a multi-million-dollar, 18–30 month programme. It is not a CoinPay project.

**On execution and value: yes, at the leg that matters to us.** Not by rebuilding the
on-ramp, but by routing around it — aggregate the buy side so we are never single-vendor,
and own the merchant sell side where the cost gap is an order of magnitude.

---

## The Cost Picture

MoonPay's bank transfer is advertised at about 1%. That is the visible half; the spread
on the quoted rate is where the revenue sits, and reviewers report it as high as ~4.3%.
Card is 4.5% with a $3.99 floor and a $20 minimum buy. Exodus takes a revenue share on
top of whatever the user pays.

| Route | Disclosed fee | Reported spread | Notes |
|---|---|---|---|
| MoonPay — card | 4.5% (min $3.99) | up to ~4.3% | Consumer wallet default |
| MoonPay — bank transfer | ~1% | up to ~4.3% | ACH / SEPA / Faster Payments |
| Stripe onramp | ~1.5% + $0.30 | — | Lowest-fee mainstream US retail route |
| Bridge — B2B off-ramp | ~0.1% at volume | — | Stablecoin → USD, ACH/wire |

**The gap between what retail ramps charge and what the rails underneath cost is 10–20×.
That gap is the entire opportunity.**

Figures are provider-published rates and third-party reported spreads, not measured
transactions. Treat the spread band as an upper bound and re-verify before quoting
externally.

---

## What We Already Have

The machinery for the buy-side router already exists — we built it once for
crypto-to-crypto.

| Capability | Where |
|---|---|
| Crypto ↔ crypto swaps | `src/lib/swap/` — ChangeNOW, SideShift, Boltz behind a shared `types.ts`, quote endpoint at `/api/swap/quote` |
| Payouts | `src/lib/payouts/service.ts`, Stripe + crypto payout tabs |
| Bank visibility | SimpleFIN on `/finances` |
| **Fiat on-ramp** | **Nothing. No provider anywhere in the codebase.** |

---

## Play 1 — Route, Don't Build (ship first, ~2–3 weeks)

Add `src/lib/onramp/` mirroring the swap module's provider abstraction, backed by an
aggregator. Onramper carries 30+ providers behind one API and is already the engine
behind Exodus's own cross-chain swaps; Transak and Coinbase Onramp are the direct
alternatives.

The value beat is quoting in **delivered amount, not fee percentage** — "you pay $500,
you receive 0.0xxx BTC", every provider ranked on the number that actually lands in the
wallet. MoonPay's spread hides inside the rate; a delivered-amount comparator drags it
into the open. Nobody in the wallet space quotes honestly. That is the wedge.

Secondary execution wins available from routing:
- Retry on decline against a second provider. Single-provider approval rates are the main
  reason aggregators exist, and Exodus-on-MoonPay does not get this.
- Honest per-route ETA instead of an opaque "pending" while ACH clears.
- Route small buys away from the $3.99 card floor and the $20 minimum, which are punitive
  under ~$50.

**Blocked on:** an Onramper (or Transak) partner key. Everything above the provider
interface can be built and tested against a stub first.

## Play 2 — Own the Off-Ramp (highest margin)

Exodus needs an on-ramp because it is a consumer wallet with no fiat relationship.
CoinPay is a processor. Our merchants' pain is not "buy crypto with my bank", it is
"I accepted USDC, get me USD".

That is the leg where the cost gap is 10–20×, where `src/lib/payouts/` already lives, and
where we operate as a platform under the provider's licence rather than our own.

**Do not build this on Bridge.** See the constraint below.

## Play 3 — Hold the Lane MoonPay Cannot Enter (already shipped)

`src/lib/swap/index.ts` opens with "no-KYC coin swaps — works in USA". KYC on every
transaction is the price of MoonPay's licence; they cannot follow us here. Pairing the
existing no-KYC crypto lane with a licensed-partner fiat lane gives a coverage map they
cannot match from either direction.

---

## The Constraint That Reframes All Of It

Our Stripe Connect account is **terminated and under appeal** (filed 2026-08-27). 992
charges, 38 disputes, a 3.83% dispute rate — 36 of those 38 traceable to a single
operator running two businesses off a shared webhook endpoint. Strip that operator out
and the rest of the platform is one dispute across 101 charges.

Two consequences:

1. **Do not build settlement on Bridge.** It is Stripe-owned and we are mid-dispute with
   Stripe. Dual-source it (Brale, Sphere) or resolve the appeal first.
2. **This makes Play 1 urgent, not optional.** When a user buys through a ramp widget the
   ramp provider is merchant of record — the chargeback lands on *them*. Routing fiat
   entry through an aggregator restores fiat capability while moving dispute liability
   entirely off our books. Given what just killed the Connect account, that is the
   strongest argument in this document.

---

## Where We Lose, And Should Not Pretend Otherwise

- **Coverage.** 175+ local payment methods across dozens of jurisdictions. Rent it.
- **Brand trust at the bank-login screen.** The name above the credential field matters.
  Rent it.
- **Fraud and chargeback absorption.** We have direct, recent evidence of what happens
  when we carry this ourselves. Rent it.

---

## Sources

- [MoonPay — payment methods, settlement times and limits](https://support.moonpay.com/en/articles/389117-payment-methods-settlement-times-and-limits)
- [MoonPay review — fees and spread](https://milkroad.com/reviews/moonpay-review/)
- [Best stablecoin onramps 2026 — MoonPay, Transak, Coinbase Onramp compared](https://eco.com/support/en/articles/15210390-best-stablecoin-onramps-2026-moonpay-transak-coinbase-onramp-compared)
- [Bridge.xyz — stablecoin API for payouts and orchestration](https://eco.com/support/en/articles/15083178-bridge-xyz-stablecoin-api-for-payouts-and-orchestration)
- [Onramper and Exodus launch cross-chain swaps](https://onramper.com/blog/onramper-and-exodus-launch-cross-chain-swaps)
