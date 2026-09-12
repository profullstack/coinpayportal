import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant, requireMerchantForWrite } from '@/lib/auth/merchant-guard';
import { createReport, listReports, listArtifacts, toPublicReport, ReportError, REPORT_FORMATS, type ReportFormat } from '@/lib/finances/reports';
import { toPublicJob } from '@/lib/finances/jobs';
import { resolveFinanceTimezone } from '@/lib/finances/settings';
import { financeError, financeErrorFromException, financeJson, idempotencyKeyFrom, isFeatureEnabled, isUuid, readJsonBody } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/finances/reports — create an immutable report revision. Answers
 * 202 with the report and the job generating it; poll the report until
 * `status` is `ready`, then download a format.
 *
 * Body: `{ period?: "2026-Q2", from?, to?, timezone?, accountIds?: [],
 * scope?: "all"|"business"|"personal", includeHidden?, includePendingAppendix?,
 * formats?: ["pdf","csv","json","html"], strict? }`.
 */
export async function POST(req: NextRequest) {
  const guard = await requireMerchantForWrite(req);
  if (guard instanceof NextResponse) return guard;
  if (!isFeatureEnabled('FINANCES_REPORTS_ENABLED')) return financeError('feature_disabled', 'Reports are disabled on this deployment', 503);

  const body = await readJsonBody<{
    period?: unknown; from?: unknown; to?: unknown; timezone?: unknown; accountIds?: unknown; scope?: unknown;
    includeHidden?: unknown; includePendingAppendix?: unknown; includePending?: unknown; formats?: unknown; strict?: unknown; estimateGaps?: unknown;
  }>(req);

  const accountIds = Array.isArray(body.accountIds) ? body.accountIds.filter((v): v is string => typeof v === 'string') : null;
  if (accountIds && accountIds.some((id) => !isUuid(id))) return financeError('invalid_request', 'accountIds must be uuids', 400);
  const scope = body.scope === 'business' || body.scope === 'personal' ? body.scope : body.scope === undefined || body.scope === 'all' ? 'all' : null;
  if (scope === null) return financeError('invalid_request', 'scope must be all, business or personal', 400);
  const formats = Array.isArray(body.formats)
    ? (body.formats.filter((f): f is ReportFormat => typeof f === 'string' && (REPORT_FORMATS as string[]).includes(f)))
    : undefined;
  if (Array.isArray(body.formats) && formats && formats.length !== body.formats.length) {
    return financeError('invalid_request', `formats must be among ${REPORT_FORMATS.join(', ')}`, 400);
  }

  try {
    const tz = await resolveFinanceTimezone(guard.id, body.timezone);
    if (!tz) {
      return financeError('timezone_required', 'No finance timezone is saved yet. Pass an IANA timezone such as America/Los_Angeles; it will be remembered.', 400);
    }
    const { report, job } = await createReport({
      merchantId: guard.id,
      period: typeof body.period === 'string' ? body.period : null,
      from: typeof body.from === 'string' ? body.from : null,
      to: typeof body.to === 'string' ? body.to : null,
      timezone: tz.timezone,
      accountIds,
      scope,
      includeHidden: body.includeHidden === true,
      includePending: body.includePendingAppendix !== false && body.includePending !== false,
      formats,
      strict: body.strict === true,
      estimateGaps: body.estimateGaps === true,
      idempotencyKey: idempotencyKeyFrom(req),
    });
    return financeJson({ report: toPublicReport(report), job: toPublicJob(job), timezone: tz }, 202);
  } catch (err) {
    if (err instanceof ReportError) return financeError(err.code as never, err.message, err.status);
    return financeErrorFromException(err, 'Could not create the report');
  }
}

/** GET /api/finances/reports — report history, newest first. */
export async function GET(req: NextRequest) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;
  const q = req.nextUrl.searchParams;
  const parsedLimit = Number.parseInt(q.get('limit') ?? '', 10);
  const parsedOffset = Number.parseInt(q.get('offset') ?? '', 10);
  try {
    const { reports, total } = await listReports(guard.id, {
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 50,
      offset: Number.isFinite(parsedOffset) ? parsedOffset : 0,
    });
    const withArtifacts = await Promise.all(
      reports.map(async (r) => toPublicReport(r, r.status === 'ready' ? await listArtifacts(r.id) : [])),
    );
    return financeJson({ reports: withArtifacts, total });
  } catch (err) {
    return financeErrorFromException(err, 'Could not list reports');
  }
}
