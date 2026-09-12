import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant } from '@/lib/auth/merchant-guard';
import { booksSummary, renderBooksCsv, renderBooksHtml, renderBooksPdf, toPublicRow } from '@/lib/finances/books';
import { resolvePeriod, boundPeriod } from '@/lib/finances/periods';
import { resolveFinanceTimezone } from '@/lib/finances/settings';
import { financeError, financeErrorFromException } from '@/lib/finances/api';
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

  // Request values are compared, never reused: everything that reaches the
  // response body below is a literal, an Intl canonical name, or an instant.
  const formatParam = (q.get('format') ?? 'csv').toLowerCase();
  const format: 'csv' | 'pdf' | 'html' | 'json' | null =
    formatParam === 'csv' ? 'csv' : formatParam === 'pdf' ? 'pdf' : formatParam === 'html' ? 'html' : formatParam === 'json' ? 'json' : null;
  if (!format) return financeError('invalid_request', 'format must be csv, pdf, html or json', 400);
  const scopeParam = q.get('scope');
  const scope: 'business' | 'personal' | 'all' = scopeParam === 'personal' ? 'personal' : scopeParam === 'all' ? 'all' : 'business';

  try {
    const tz = await resolveFinanceTimezone(guard.id, q.get('timezone'), { remember: false });
    if (!tz) return financeError('timezone_required', 'Pass an IANA timezone such as America/Los_Angeles', 400);
    // The canonical zone name from Intl, not the request string.
    const timezone = new Intl.DateTimeFormat('en-US', { timeZone: tz.timezone }).resolvedOptions().timeZone;
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
    const bounded = boundPeriod(resolvePeriod({ period, from, to, timezone }), new Date());
    const summary = await booksSummary(guard.id, { start: bounded.start, end: bounded.effectiveEnd, scope });
    const fileLabel = `${bounded.start.slice(0, 10)}_${bounded.effectiveEnd.slice(0, 10)}`;

    let bytes: Buffer;
    let contentType: string;
    const extraHeaders: Record<string, string> = {};
    if (format === 'csv') {
      bytes = Buffer.from(renderBooksCsv(summary), 'utf8');
      contentType = 'text/csv; charset=utf-8';
    } else if (format === 'html') {
      bytes = Buffer.from(renderBooksHtml(summary), 'utf8');
      contentType = 'text/html; charset=utf-8';
      extraHeaders['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
    } else if (format === 'json') {
      bytes = Buffer.from(
        canonicalJson({ ...summary, transactions: summary.transactions.map(toPublicRow), timezone, periodStart: bounded.start, periodEnd: bounded.effectiveEnd, periodToDate: bounded.periodToDate }),
        'utf8',
      );
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
        'Content-Disposition': `attachment; filename="coinpay-books-${fileLabel}-${scope}.${format}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Unreviewed-Rows': String(summary.unreviewed),
        ...extraHeaders,
      },
    });
  } catch (err) {
    return financeErrorFromException(err, 'Could not export the books');
  }
}
