import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant } from '@/lib/auth/merchant-guard';
import { booksSummary, renderBooksCsv, renderBooksHtml, renderBooksPdf, toPublicRow } from '@/lib/finances/books';
import { resolvePeriod, boundPeriod } from '@/lib/finances/periods';
import { resolveFinanceTimezone } from '@/lib/finances/settings';
import { financeError, financeErrorFromException, isUuid } from '@/lib/finances/api';
import { canonicalJson } from '@/lib/finances/render';
import { audit } from '@/lib/finances/audit';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * GET /api/finances/books/export?period=2026&scope=business&format=csv|pdf|html|json
 *
 * The CPA pack: totals by tax category plus every row behind them, as an
 * attachment. Built from the books as they stand now, with the unreviewed
 * count printed on it; not an immutable report revision.
 */
export async function GET(req: NextRequest) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;
  const q = req.nextUrl.searchParams;
  const format = (q.get('format') ?? 'csv').toLowerCase();
  if (!['csv', 'pdf', 'html', 'json'].includes(format)) return financeError('invalid_request', 'format must be csv, pdf, html or json', 400);
  const scopeParam = q.get('scope');
  const scope = scopeParam === 'personal' || scopeParam === 'all' ? scopeParam : 'business';
  void isUuid;
  try {
    const tz = await resolveFinanceTimezone(guard.id, q.get('timezone'), { remember: false });
    if (!tz) return financeError('timezone_required', 'Pass an IANA timezone such as America/Los_Angeles', 400);
    const rawPeriod = q.get('period');
    let from = q.get('from');
    let to = q.get('to');
    let period = rawPeriod;
    if (rawPeriod && /^\d{4}$/.test(rawPeriod)) {
      from = `${rawPeriod}-01-01`;
      to = `${Number(rawPeriod) + 1}-01-01`;
      period = null;
    }
    const bounded = boundPeriod(resolvePeriod({ period, from, to, timezone: tz.timezone }), new Date());
    const summary = await booksSummary(guard.id, { start: bounded.start, end: bounded.effectiveEnd, scope });
    const label = (rawPeriod ?? `${from}_${to}`).replace(/[^0-9A-Za-z_.-]/g, '_');

    let bytes: Buffer;
    let contentType: string;
    if (format === 'csv') {
      bytes = Buffer.from(renderBooksCsv(summary), 'utf8');
      contentType = 'text/csv; charset=utf-8';
    } else if (format === 'html') {
      bytes = Buffer.from(renderBooksHtml(summary), 'utf8');
      contentType = 'text/html; charset=utf-8';
    } else if (format === 'json') {
      bytes = Buffer.from(canonicalJson({ ...summary, transactions: summary.transactions.map(toPublicRow), timezone: tz.timezone, periodLabel: bounded.label }), 'utf8');
      contentType = 'application/json; charset=utf-8';
    } else {
      bytes = await renderBooksPdf(summary);
      contentType = 'application/pdf';
    }
    await audit(guard.id, 'books.export', 'merchant', guard.id, { format, rows: summary.rows, scope });
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(bytes.length),
        'Content-Disposition': `attachment; filename="coinpay-books-${label}-${scope}.${format}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Unreviewed-Rows': String(summary.unreviewed),
      },
    });
  } catch (err) {
    return financeErrorFromException(err, 'Could not export the books');
  }
}
