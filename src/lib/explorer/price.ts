/**
 * USD valuation for explorer amounts.
 *
 * Reuses the platform's existing rate service rather than adding a price
 * feed: it already caches, and it already falls back from Tatum to Kraken,
 * which means prices resolve even where no Tatum key is configured.
 *
 * Every function here degrades to null rather than throwing. A price is
 * decoration on an explorer page — the chain data is the point, and a rate
 * provider having a bad minute must not take a transaction page down with it.
 */

import { getExchangeRate } from '@/lib/rates/tatum';
import { getChain } from './chains';

/** USD rate for a chain's native asset, or null if it cannot be priced. */
export async function getUsdRate(chainId: string): Promise<number | null> {
  const chain = getChain(chainId);
  if (!chain) return null;
  try {
    const rate = await getExchangeRate(chain.symbol, 'USD');
    // The upstream has been seen to answer NaN for some symbols; a NaN would
    // propagate into every rendered figure as "$NaN".
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

/** USD rates for several chains at once, keyed by chain id. */
export async function getUsdRates(chainIds: string[]): Promise<Record<string, number | null>> {
  const entries = await Promise.all(
    chainIds.map(async (id) => [id, await getUsdRate(id)] as const)
  );
  return Object.fromEntries(entries);
}

/**
 * Render a native amount as USD.
 *
 * Returns null when there is no rate or the amount is not a number, so
 * callers can omit the line entirely rather than printing a placeholder.
 */
export function toUsd(amount: string | null | undefined, rate: number | null): string | null {
  if (!amount || rate === null) return null;
  const value = Number(amount);
  if (!Number.isFinite(value)) return null;
  return formatUsd(value * rate);
}

/**
 * Format a USD figure for display.
 *
 * Sub-cent amounts keep more precision instead of collapsing to "$0.00":
 * a dust transaction reading as zero dollars looks like a bug, and on chains
 * like DOGE and ADA a genuine transfer can land there.
 */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '$0.00';
  const abs = Math.abs(value);
  if (abs < 0.01) {
    return `$${value.toPrecision(2)}`;
  }
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Format a unit price, which may be well under a cent (DOGE, ADA). */
export function formatUnitPrice(rate: number | null): string {
  if (rate === null) return '—';
  if (rate < 1) return `$${rate.toPrecision(3)}`;
  return `$${rate.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
