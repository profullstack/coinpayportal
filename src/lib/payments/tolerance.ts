/**
 * Whether an observed on-chain balance settles an expected amount.
 *
 * The previous rule was `balance >= expected - expected * 0.01`, applied in six
 * separate monitoring flows. That 1% discount was an economic concession, not a
 * numeric one: a payer could send 99% of the invoice, unlock the goods, and
 * leave the forwarder trying to send 100% out of an address holding 99% — so
 * the forward failed and the funds stranded at the intermediary address.
 *
 * Confirmation now requires the full amount. The only slack retained is a
 * relative epsilon that absorbs IEEE-754 representation error when an amount
 * has been round-tripped through decimal strings and JSON — it is roughly nine
 * orders of magnitude smaller than the old discount, far below one satoshi on
 * any realistic invoice, and cannot be used to underpay.
 *
 * One more slack was added on 2026-09-24: a shortfall smaller than a single
 * atomic unit of the asset, when the caller says which asset it is. A quote
 * written to more decimals than the token has cannot be paid exactly — the
 * closest a USDC wallet can get to 6.44064406 is 6.440644 — so without this the
 * payment sits pending, expires, and strands the customer's money at the
 * deposit address. New quotes are rounded to the asset's precision at creation
 * (lib/payments/asset-decimals.ts); this is what lets the ones already written
 * settle. It is bounded by the smallest amount the chain can move (a millionth
 * of a dollar in USDC), so it is not an economic concession either.
 */

import { atomicUnit } from './asset-decimals';

/**
 * Relative slack for floating-point round-tripping. At 1e-9, a 1 BTC invoice
 * tolerates 1e-9 BTC (100 satoshi) of representation drift and nothing more.
 */
export const SETTLEMENT_EPSILON_RATIO = 1e-9;

/**
 * Minimum settlement threshold for `expected`: the smallest balance that counts
 * as paid in full.
 */
export function settlementThreshold(expected: number, asset?: string | null): number {
  if (!Number.isFinite(expected) || expected <= 0) return Number.POSITIVE_INFINITY;
  const floatingPointSlack = expected * SETTLEMENT_EPSILON_RATIO;
  // An amount below one atomic unit is unpayable, not unpaid.
  const unpayableRemainder = asset ? atomicUnit(asset) * (1 - Number.EPSILON) : 0;
  return expected - Math.max(floatingPointSlack, unpayableRemainder);
}

/**
 * True when `balance` settles `expected` in full.
 *
 * Returns false — never true — when `expected` is null, undefined, NaN, zero,
 * or negative. A missing expected amount used to make the comparison NaN, and
 * `balance < NaN` is false, so the "insufficient funds" guard never fired and
 * the payment confirmed at a zero balance. Fail closed instead.
 */
export function isSufficientPayment(
  balance: number | string | null | undefined,
  expected: number | string | null | undefined,
  asset?: string | null
): boolean {
  const bal = toFiniteNumber(balance);
  const exp = toFiniteNumber(expected);

  if (bal === null || exp === null) return false;
  if (exp <= 0) return false;
  if (bal <= 0) return false;

  return bal >= settlementThreshold(exp, asset);
}

/**
 * Parse a numeric amount that may arrive as a string from Postgres `numeric`
 * columns. Returns null for anything that is not a finite number, so callers
 * cannot accidentally compare against NaN.
 */
export function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : null;
}
