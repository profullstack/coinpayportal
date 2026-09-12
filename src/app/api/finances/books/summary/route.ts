import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant } from '@/lib/auth/merchant-guard';
import { booksSummary, toPublicRow } from '@/lib/finances/books';
import { resolvePeriod, boundPeriod } from '@/lib/finances/periods';
import { resolveFinanceTimezone } from '@/lib/finances/settings';
import { financeError, financeErrorFromException, financeJson } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/finances/books/summary?period=2026-Q3|2026|2026-08&scope=business
 *
 * Totals by tax category for a period, plus the rows behind them. A bare
 * year (`2026`) means January 1 to January 1. Not an immutable report:
 * this reflects the books as they stand right now, including unreviewed
 * rows, and says how many those are.
 */
export async function GET(req: NextRequest) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;
  const q = req.nextUrl.searchParams;
  const scopeParam = q.get('scope');
  const scope: 'business' | 'personal' | 'all' = scopeParam === 'personal' ? 'personal' : scopeParam === 'all' ? 'all' : 'business';
  try {
    const tz = await resolveFinanceTimezone(guard.id, q.get('timezone'), { remember: false });
    if (!tz) return financeError('timezone_required', 'Pass an IANA timezone such as America/Los_Angeles', 400);
    const rawPeriod = q.get('period');
    let from = q.get('from');
    let to = q.get('to');
    let period = rawPeriod;
    if (rawPeriod && /^\d{4}$/.test(rawPeriod)) {
      const year = Number.parseInt(rawPeriod, 10);
      from = `${year}-01-01`;
      to = `${year + 1}-01-01`;
      period = null;
    }
    const bounded = boundPeriod(resolvePeriod({ period, from, to, timezone: tz.timezone }), new Date());
    const summary = await booksSummary(guard.id, { start: bounded.start, end: bounded.effectiveEnd, scope });
    return financeJson({
      period: { selector: rawPeriod ?? `${from}..${to}`, label: bounded.label, timezone: tz.timezone, start: bounded.start, end: bounded.effectiveEnd, periodToDate: bounded.periodToDate },
      scope,
      lines: summary.lines,
      totals: summary.totals,
      rows: summary.rows,
      unreviewed: summary.unreviewed,
      uncategorized: summary.uncategorized,
      notice: summary.notice,
      transactions: q.get('rows') === '1' ? summary.transactions.map(toPublicRow) : undefined,
    });
  } catch (err) {
    return financeErrorFromException(err, 'Could not build the summary');
  }
}
