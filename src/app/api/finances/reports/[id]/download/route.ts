import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant } from '@/lib/auth/merchant-guard';
import { getReport, readArtifact, ReportError, REPORT_FORMATS, type ReportFormat } from '@/lib/finances/reports';
import { financeError, financeErrorFromException, isUuid } from '@/lib/finances/api';
import { audit } from '@/lib/finances/audit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/finances/reports/[id]/download?format=pdf|html|csv|json
 *
 * The bytes, as an attachment, with `Cache-Control: no-store`. A report that
 * is still generating answers 409 with its state rather than a partial file.
 * Ownership is rechecked here; nothing about the URL is a capability.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return financeError('not_found', 'Report not found', 404);

  const format = (req.nextUrl.searchParams.get('format') ?? 'pdf').toLowerCase();
  if (!(REPORT_FORMATS as string[]).includes(format)) {
    return financeError('invalid_request', `format must be one of ${REPORT_FORMATS.join(', ')}`, 400);
  }

  try {
    const report = await getReport(id, guard.id);
    if (!report) return financeError('not_found', 'Report not found', 404);
    if (report.status === 'failed') {
      return financeError((report.error_code as never) ?? 'report_not_ready', report.error_message ?? 'Report generation failed', 409, { reportId: report.id });
    }
    if (report.status !== 'ready' && report.status !== 'superseded') {
      return financeError('report_not_ready', `Report is ${report.status}`, 409, { retryable: true, reportId: report.id, jobId: report.job_id ?? undefined });
    }
    const artifact = await readArtifact({ ...report, status: 'ready' }, format as ReportFormat);
    if (!artifact) return financeError('report_not_ready', 'This format is not available', 409, { reportId: report.id });

    await audit(guard.id, 'report.download', 'report', report.id, { format, bytes: artifact.bytes.length });
    return new NextResponse(new Uint8Array(artifact.bytes), {
      status: 200,
      headers: {
        'Content-Type': artifact.contentType,
        'Content-Length': String(artifact.bytes.length),
        'Content-Disposition': `attachment; filename="${artifact.filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Report-Revision': String(report.revision),
        'X-Content-SHA256': artifact.sha256,
        'X-Local-Export-Complete': String(report.local_export_complete ?? false),
        'X-Provider-Coverage': report.provider_coverage ?? 'unknown',
      },
    });
  } catch (err) {
    if (err instanceof ReportError) return financeError(err.code as never, err.message, err.status);
    return financeErrorFromException(err, 'Could not download the report');
  }
}
