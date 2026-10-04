import { NextRequest, NextResponse } from 'next/server';
import { resolveShareLink, countShareDownload } from '@/lib/finances/share';
import { getReport, readArtifact, type ReportFormat } from '@/lib/finances/reports';
import { booksSummary } from '@/lib/finances/books';
import { renderBooksFormat } from '@/lib/finances/emailing';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const NOT_FOUND = () =>
  new NextResponse('This download link is not valid or has expired.', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });

/**
 * GET /api/finances/shared/[token]?format=pdf — a document sent by email,
 * for someone without a CoinPay login.
 *
 * No session, by design: the token is the whole credential. It is random,
 * stored hashed, expiring, revocable and counted. The bytes are exactly
 * what the merchant could download; a report link serves the frozen
 * revision, a books link renders the books as they stand now. Nothing is
 * cached and nothing is embedded.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await resolveShareLink(token).catch(() => null);
  if (!link) return NOT_FOUND();

  const requested = (req.nextUrl.searchParams.get('format') ?? link.formats[0] ?? 'pdf').toLowerCase();
  const format: ReportFormat | null = requested === 'pdf' ? 'pdf' : requested === 'csv' ? 'csv' : requested === 'html' ? 'html' : requested === 'json' ? 'json' : null;
  if (!format || !link.formats.includes(format)) return NOT_FOUND();

  let bytes: Buffer;
  let filename: string;
  let contentType: string;
  try {
    if (link.kind === 'report') {
      if (!link.report_id) return NOT_FOUND();
      const report = await getReport(link.report_id, link.merchant_id);
      if (!report || (report.status !== 'ready' && report.status !== 'superseded')) return NOT_FOUND();
      const artifact = await readArtifact({ ...report, status: 'ready' }, format);
      if (!artifact) return NOT_FOUND();
      bytes = artifact.bytes;
      filename = artifact.filename;
      contentType = artifact.contentType;
    } else {
      const p = link.params as { start?: string; end?: string; scope?: string; timezone?: string; label?: string };
      if (!p.start || !p.end) return NOT_FOUND();
      const scope: 'business' | 'personal' | 'all' = p.scope === 'personal' ? 'personal' : p.scope === 'all' ? 'all' : 'business';
      const summary = await booksSummary(link.merchant_id, { start: p.start, end: p.end, scope });
      const file = await renderBooksFormat(summary, format, { timezone: p.timezone ?? 'UTC', periodLabel: p.label ?? '' });
      bytes = file.bytes;
      filename = file.filename;
      contentType = format === 'csv' ? 'text/csv; charset=utf-8' : format === 'html' ? 'text/html; charset=utf-8' : format === 'json' ? 'application/json; charset=utf-8' : 'application/pdf';
    }
  } catch (err) {
    console.error('[finances/shared] failed', err instanceof Error ? err.message : err);
    return NOT_FOUND();
  }

  await countShareDownload(link);
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(bytes.length),
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
      ...(format === 'html' ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {}),
    },
  });
}
