import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant } from '@/lib/auth/merchant-guard';
import { listAccounts } from '@/lib/finances/summary';
import { computeCoverage, summarizeCoverage } from '@/lib/finances/coverage';
import { resolvePeriod, boundPeriod } from '@/lib/finances/periods';
import { resolveFinanceTimezone } from '@/lib/finances/settings';
import { financeError, financeErrorFromException, financeJson } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/finances/coverage?period=2026-Q2&timezone=…&account=…&account=…
 *
 * Which part of the interval was ever fetched, per owned account. Reads only
 * `finance_fetch_windows`; never the provider. `from`/`to` (exclusive) may
 * replace `period`.
 */
export async function GET(req: NextRequest) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;
  const q = req.nextUrl.searchParams;

  try {
    const tz = await resolveFinanceTimezone(guard.id, q.get('timezone'), { remember: false });
    if (!tz) return financeError('timezone_required', 'Pass an IANA timezone such as America/Los_Angeles', 400);

    const period = boundPeriod(
      resolvePeriod({ period: q.get('period'), from: q.get('from'), to: q.get('to'), timezone: tz.timezone }),
      new Date(),
    );

    const accounts = await listAccounts(guard.id, { includeHidden: q.get('hidden') === '1' });
    const requested = q.getAll('account');
    const selected = requested.length > 0 ? accounts.filter((a) => requested.includes(a.id)) : accounts;
    if (requested.length > 0 && selected.length !== new Set(requested).size) {
      return financeError('not_found', 'One or more accounts were not found', 404);
    }

    const coverage = await computeCoverage(selected.map((a) => a.id), period.start, period.effectiveEnd);
    return financeJson({
      period: {
        selector: period.selector,
        label: period.label,
        timezone: period.timezone,
        start: period.start,
        end: period.end,
        effectiveEnd: period.effectiveEnd,
        periodToDate: period.periodToDate,
      },
      provider_coverage: summarizeCoverage(coverage),
      accounts: coverage.map((c) => {
        const account = selected.find((a) => a.id === c.accountId);
        return { ...c, name: account?.name ?? null, org_name: account?.org_name ?? null, currency: account?.currency ?? null };
      }),
    });
  } catch (err) {
    return financeErrorFromException(err, 'Could not compute coverage');
  }
}
