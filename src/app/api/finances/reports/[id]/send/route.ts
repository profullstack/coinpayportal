import { NextRequest, NextResponse } from 'next/server';
import { requireMerchantForWrite } from '@/lib/auth/merchant-guard';
import { sendReportEmail, EmailingError } from '@/lib/finances/emailing';
import { financeError, financeErrorFromException, financeJson, isUuid, readJsonBody } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/finances/reports/[id]/send — email a ready report.
 * Body: `{ to: ["cpa@example.com", "me@example.com"], formats?: ["pdf","csv"],
 * message?, attach?: true, expiresInDays?: 14 }`. The recipients get the
 * files attached (when they fit) and an expiring download link that needs
 * no login. Sending is the merchant's decision each time.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMerchantForWrite(req);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return financeError('not_found', 'Report not found', 404);
  const body = await readJsonBody<{ to?: unknown; formats?: unknown; message?: unknown; attach?: unknown; expiresInDays?: unknown }>(req);
  try {
    const outcome = await sendReportEmail({
      merchantId: guard.id,
      reportId: id,
      to: body.to,
      formats: Array.isArray(body.formats) ? body.formats.map(String) : undefined,
      message: typeof body.message === 'string' ? body.message.slice(0, 2000) : null,
      attach: body.attach !== false,
      expiresInDays: typeof body.expiresInDays === 'number' ? body.expiresInDays : undefined,
    });
    return financeJson(outcome, outcome.sent.length > 0 ? 200 : 502);
  } catch (err) {
    if (err instanceof EmailingError) return financeError(err.code as never, err.message, err.status);
    return financeErrorFromException(err, 'Could not send the report');
  }
}
