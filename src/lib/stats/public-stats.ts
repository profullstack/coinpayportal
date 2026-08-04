/**
 * Live counters for the public landing page.
 *
 * These used to be literals in `page.tsx` — "47K+" transactions, "1,200+"
 * merchants, "$8.2M+" volume, "45+" countries — none derived from anything.
 * Measured against production they were overstated between 9x and 720x. Two
 * further stats, uptime and average processing time, had no possible source at
 * all: nothing records either.
 *
 * So the rule this module exists to enforce: a number on the marketing page
 * either comes from the database or does not appear. When the query fails,
 * `getPublicStats` returns null and the page omits the whole block rather than
 * falling back to a plausible-looking constant — a stale constant is precisely
 * what went wrong before, and a missing section is cheaper than a false claim.
 */

import { getSupabaseAdmin } from '@/lib/supabase/server';

export interface PublicStats {
  /** Payments that actually moved money: confirmed, or confirmed and forwarded. */
  paymentsSettled: number;
  /** Businesses currently marked active. */
  activeBusinesses: number;
  /** Gross USD across settled payments. */
  settledVolumeUsd: number;
}

/** Shape returned by the `public_landing_stats()` Postgres function. */
interface RawStats {
  payments_settled: number | string | null;
  active_businesses: number | string | null;
  settled_volume_usd: number | string | null;
}

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Read the live counters, or null when they cannot be read.
 *
 * Never throws: a marketing section is not worth failing a page render over,
 * and the caller treats null as "render nothing".
 */
export async function getPublicStats(): Promise<PublicStats | null> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc('public_landing_stats');

    if (error || !data) {
      console.error('[stats] public_landing_stats failed:', error);
      return null;
    }

    const raw = data as RawStats;
    return {
      paymentsSettled: toNumber(raw.payments_settled),
      activeBusinesses: toNumber(raw.active_businesses),
      settledVolumeUsd: toNumber(raw.settled_volume_usd),
    };
  } catch (err) {
    console.error('[stats] public_landing_stats threw:', err);
    return null;
  }
}

/** `1743` → `"1,743"`. */
export function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

/**
 * Whole dollars with separators. No "+" suffix and no rounding up to a
 * friendlier magnitude — the point of this module is that the figure is the
 * figure.
 */
export function formatUsd(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}
