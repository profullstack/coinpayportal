import 'server-only';
import { getSupabaseAdmin } from '../supabase/server';

/**
 * What part of a period was ever fetched, per account.
 *
 * Coverage is a statement about requests, not about data. It is derived from
 * `finance_fetch_windows` — the intervals that were asked for and answered
 * cleanly — and never from the transactions themselves. An empty month with a
 * clean fetch window is `available_window_fetched`; an empty month nobody
 * ever asked for is `unknown`. They look identical in the ledger and mean
 * opposite things.
 *
 * `available_window_fetched` is deliberately not called "complete": the
 * bridge hands over whatever the institution gave it, which is not a promise
 * that the institution gave it everything.
 */

export type ProviderCoverage = 'unknown' | 'partial' | 'available_window_fetched';

export interface AccountCoverage {
  accountId: string;
  coverage: ProviderCoverage;
  /** Fraction of the interval covered by clean fetch windows, 0..1. */
  fraction: number;
  /** Intervals (ISO) inside the requested range that were never cleanly fetched. */
  gaps: Array<{ start: string; end: string }>;
  /** Sanitised provider warnings seen on windows touching this interval. */
  warnings: string[];
  capped: boolean;
  rowsRejected: number;
}

interface WindowRow {
  account_id: string;
  requested_start: string;
  requested_end: string;
  outcome: string;
  capped: boolean;
  rows_rejected: number;
  warnings: unknown;
}

/** Merge sorted intervals. */
function mergeIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
  const sorted = intervals.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** Pure form, exported for tests. */
export function coverageFromWindows(
  accountId: string,
  windows: WindowRow[],
  start: string,
  end: string,
): AccountCoverage {
  const s0 = Date.parse(start);
  const e0 = Date.parse(end);
  const clean: Array<[number, number]> = [];
  const warnings = new Set<string>();
  let capped = false;
  let rowsRejected = 0;

  for (const w of windows) {
    if (w.account_id !== accountId) continue;
    const ws = Date.parse(w.requested_start);
    const we = Date.parse(w.requested_end);
    if (we <= s0 || ws >= e0) continue;
    for (const warning of Array.isArray(w.warnings) ? w.warnings : []) {
      if (typeof warning === 'string' && warnings.size < 10) warnings.add(warning);
    }
    rowsRejected += w.rows_rejected ?? 0;
    if (w.outcome !== 'fetched') continue;
    // A capped answer covered less than it was asked for. Which part is
    // unknowable from here, so a capped window counts toward nothing —
    // the merchant is told the range was cut and can backfill it in chunks.
    if (w.capped) {
      capped = true;
      continue;
    }
    clean.push([Math.max(ws, s0), Math.min(we, e0)]);
  }

  const merged = mergeIntervals(clean);
  const covered = merged.reduce((acc, [s, e]) => acc + (e - s), 0);
  const total = Math.max(e0 - s0, 1);
  const fraction = Math.min(1, covered / total);

  const gaps: Array<{ start: string; end: string }> = [];
  let cursor = s0;
  for (const [s, e] of merged) {
    if (s > cursor) gaps.push({ start: new Date(cursor).toISOString(), end: new Date(s).toISOString() });
    cursor = Math.max(cursor, e);
  }
  if (cursor < e0) gaps.push({ start: new Date(cursor).toISOString(), end: new Date(e0).toISOString() });

  let coverage: ProviderCoverage;
  if (covered === 0) coverage = 'unknown';
  else if (gaps.length === 0) coverage = 'available_window_fetched';
  else coverage = 'partial';

  return { accountId, coverage, fraction, gaps, warnings: [...warnings], capped, rowsRejected };
}

/** Coverage for a set of accounts over an interval. Owner scoping is the caller's. */
export async function computeCoverage(
  accountIds: string[],
  start: string,
  end: string,
): Promise<AccountCoverage[]> {
  if (accountIds.length === 0) return [];
  const supabase = getSupabaseAdmin();
  const rows: WindowRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from('finance_fetch_windows')
      .select('account_id, requested_start, requested_end, outcome, capped, rows_rejected, warnings')
      .in('account_id', accountIds)
      .lt('requested_start', end)
      .gt('requested_end', start)
      .order('fetched_at', { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error(`Could not read fetch coverage: ${error.message}`);
    const page = (data ?? []) as WindowRow[];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return accountIds.map((id) => coverageFromWindows(id, rows, start, end));
}

/** The single coverage value a report carries, from its accounts' values. */
export function summarizeCoverage(items: AccountCoverage[]): ProviderCoverage {
  if (items.length === 0) return 'unknown';
  if (items.every((c) => c.coverage === 'available_window_fetched')) return 'available_window_fetched';
  if (items.every((c) => c.coverage === 'unknown')) return 'unknown';
  return 'partial';
}
