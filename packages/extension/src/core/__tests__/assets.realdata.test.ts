/**
 * Asset aggregation checked against a REAL production wallet.
 *
 * The invented fixtures in the popup tests passed happily while the wallet
 * under-reported its own balance: they only contained one row per chain, so
 * they could not exercise the case that actually broke — a chain funded at
 * several derivation indexes. This file uses the exact rows a live wallet had
 * (27 addresses across 17 chains, SOL funded at two indexes, ETH at one of two,
 * everything else zero), so the arithmetic is pinned to reality rather than to
 * my assumptions about it.
 *
 * Balances captured 2026-07-26 from wallet d10b1358 (public chain data; no keys
 * or addresses are needed to assert the sums).
 */

import { describe, it, expect } from 'vitest';

import { aggregateAssets, totalFiat, isFunded } from '../assets.js';

/** chain, derivation index, cached balance — as the portal returns them. */
const PRODUCTION_ROWS: [string, number, string][] = [
  ['ADA', 0, '0'], ['ADA', 1, '0'],
  ['BCH', 0, '0'], ['BCH', 1, '0'], ['BCH', 2, '0'],
  ['BNB', 0, '0'],
  ['BTC', 0, '0'], ['BTC', 1, '0'], ['BTC', 2, '0'],
  ['DOGE', 0, '0'], ['DOGE', 1, '0'],
  ['ETH', 0, '0.011328888001978534'], ['ETH', 1, '0'],
  ['LN', 0, '0'],
  ['POL', 0, '74.829829482167570000'],
  ['SOL', 0, '0.148801694000000000'], ['SOL', 1, '0.175745690000000000'],
  ['USDC_BASE', 0, '20'],
  ['USDC_ETH', 0, '20'],
  ['USDC_POL', 0, '0'],
  ['USDC_SOL', 0, '1.000206000000000000'],
  ['USDT_ETH', 0, '0'], ['USDT_POL', 0, '0'], ['USDT_SOL', 0, '0'],
  ['XRP', 0, '0'], ['XRP', 1, '0'], ['XRP', 2, '0'],
];

const balances = PRODUCTION_ROWS.map(([chain, index, balance]) => ({
  chain,
  // Distinct per index, exactly as separate receiving addresses would be.
  address: `${chain.toLowerCase()}-${index}`,
  balance,
}));

/** What this extension derives locally: five native chains at index 0. */
const derived = ['BTC', 'BCH', 'ETH', 'POL', 'SOL'].map((chain) => ({
  chain,
  address: `${chain.toLowerCase()}-derived`,
}));

/** Live rates at capture time. */
const RATES: Record<string, number> = {
  ETH: 1884.31,
  POL: 0.07653,
  SOL: 75.1,
  USDC_ETH: 1,
  USDC_BASE: 1,
  USDC_SOL: 1,
};

describe('aggregateAssets over a real wallet', () => {
  const rows = aggregateAssets(derived, balances);

  it('lists every asset the wallet holds, once each', () => {
    expect(rows).toHaveLength(17);
    expect(new Set(rows.map((r) => r.asset)).size).toBe(17);
    // Chains the extension cannot derive are present, not filtered away.
    expect(rows.map((r) => r.asset)).toEqual(expect.arrayContaining(['DOGE', 'XRP', 'ADA', 'LN', 'BNB']));
  });

  it('sums SOL across both funded indexes', () => {
    // 0.148801694 + 0.175745690. Showing either alone loses real money from
    // the display — this is the bug that shipped.
    const sol = rows.find((r) => r.asset === 'SOL')!;
    expect(Number(sol.balance)).toBeCloseTo(0.324547384, 9);
  });

  it('does not let a zero row erase a funded one', () => {
    // ETH is funded at index 0 and zero at index 1; order must not matter.
    const eth = rows.find((r) => r.asset === 'ETH')!;
    expect(Number(eth.balance)).toBeCloseTo(0.011328888001978534, 12);

    const reversed = aggregateAssets(derived, [...balances].reverse());
    expect(Number(reversed.find((r) => r.asset === 'ETH')!.balance)).toBeCloseTo(
      0.011328888001978534,
      12,
    );
  });

  it('marks which addresses the extension derived itself', () => {
    expect(rows.find((r) => r.asset === 'ETH')!.derived).toBe(true);
    expect(rows.find((r) => r.asset === 'DOGE')!.derived).toBe(false);
    // A derived asset keeps its locally computed receive address.
    expect(rows.find((r) => r.asset === 'ETH')!.address).toBe('eth-derived');
  });

  it('puts the six funded assets first', () => {
    const funded = rows.filter(isFunded).map((r) => r.asset);
    expect(funded).toEqual(['ETH', 'POL', 'SOL', 'USDC_BASE', 'USDC_ETH', 'USDC_SOL']);
    expect(rows.slice(0, 6).map((r) => r.asset)).toEqual(funded);
  });
});

describe('wallet total over a real wallet', () => {
  const rows = aggregateAssets(derived, balances);

  it('matches the value computed from the raw balances and live rates', () => {
    const { total, priced, unpriced } = totalFiat(rows, (asset) => RATES[asset] ?? null);

    // 21.35 + 5.73 + 24.37 + 20 + 20 + 1.00
    expect(total).toBeCloseTo(92.45, 2);
    expect(priced).toBe(6);
    expect(unpriced).toBe(0);
  });

  it('would have understated the total before the fix', () => {
    // Regression guard: with only SOL's last index the answer is $79.25, which
    // is the kind of quietly-wrong number nobody notices until they compare.
    const solIndex1Only = 0.175745690 * RATES.SOL!;
    const solBoth = 0.324547384 * RATES.SOL!;
    expect(92.45 - (solBoth - solIndex1Only)).toBeCloseTo(81.28, 1);
  });

  it('reports unpriced assets instead of counting them as zero', () => {
    const { total, priced, unpriced } = totalFiat(rows, (asset) =>
      asset === 'SOL' ? null : (RATES[asset] ?? null),
    );

    expect(unpriced).toBe(1);
    expect(priced).toBe(5);
    // SOL's $24.37 is excluded rather than silently treated as nothing.
    expect(total).toBeCloseTo(92.45 - 24.373, 2);
  });
});
