import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant, requireMerchantForWrite } from '@/lib/auth/merchant-guard';
import { getReport, listArtifacts, deleteReport, toPublicReport } from '@/lib/finances/reports';
import { getJob, toPublicJob } from '@/lib/finances/jobs';
import { financeError, financeErrorFromException, financeJson, isUuid } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/finances/reports/[id] — snapshot metadata, totals, warnings and
 * which formats are ready. Never touches the provider.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return financeError('not_found', 'Report not found', 404);
  try {
    const report = await getReport(id, guard.id);
    if (!report) return financeError('not_found', 'Report not found', 404);
    const artifacts = report.status === 'ready' ? await listArtifacts(report.id) : [];
    const job = report.job_id ? await getJob(report.job_id, guard.id) : null;
    return financeJson({ report: toPublicReport(report, artifacts), job: job ? toPublicJob(job) : null });
  } catch (err) {
    return financeErrorFromException(err, 'Could not read the report');
  }
}

/** DELETE /api/finances/reports/[id] — remove the dataset and artifacts. Source rows stay. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMerchantForWrite(req);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return financeError('not_found', 'Report not found', 404);
  try {
    const removed = await deleteReport(id, guard.id);
    if (!removed) return financeError('not_found', 'Report not found', 404);
    return financeJson({ success: true, note: 'The report and its files were removed. Synced account data was not.' });
  } catch (err) {
    return financeErrorFromException(err, 'Could not delete the report');
  }
}
