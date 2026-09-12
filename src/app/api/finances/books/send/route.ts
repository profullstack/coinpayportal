import { NextRequest, NextResponse } from 'next/server';
import { requireMerchantForWrite } from '@/lib/auth/merchant-guard';
import { sendBooksEmail, EmailingError } from '@/lib/finances/emailing';
import { resolveFinanceTimezone } from '@/lib/finances/settings';
import { financeError, financeErrorFromException, financeJson, readJsonBody } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/finances/books/send — email the CPA pack for a period.
 * Body: `{ to: [...], period?: "2026"|"2026-Q3"|"2026-08", from?, to?,
 * scope?: "business", formats?: ["pdf","csv"], message?, attach?, expiresInDays? }`.
 */
export async function POST(req: NextRequest) {
  const guard = await requireMerchantForWrite(req);
  if (guard instanceof NextResponse) return guard;
  const body = await readJsonBody<{
    to?: unknown; period?: unknown; from?: unknown; toDate?: unknown; scope?: unknown; timezone?: unknown;
    formats?: unknown; message?: unknown; attach?: unknown; expiresInDays?: unknown;
  }>(req);
  const scope: 'business' | 'personal' | 'all' = body.scope === 'personal' ? 'personal' : body.scope === 'all' ? 'all' : 'business';
  try {
    const tz = await resolveFinanceTimezone(guard.id, body.timezone);
    if (!tz) return financeError('timezone_required', 'Pass an IANA timezone such as America/Los_Angeles; it will be remembered.', 400);
    const outcome = await sendBooksEmail({
      merchantId: guard.id,
      selection: {
        period: typeof body.period === 'string' ? body.period : null,
        from: typeof body.from === 'string' ? body.from : null,
        to: typeof body.toDate === 'string' ? body.toDate : null,
        timezone: tz.timezone,
        scope,
      },
      to: body.to,
      formats: Array.isArray(body.formats) ? body.formats.map(String) : undefined,
      message: typeof body.message === 'string' ? body.message.slice(0, 2000) : null,
      attach: body.attach !== false,
      expiresInDays: typeof body.expiresInDays === 'number' ? body.expiresInDays : undefined,
    });
    return financeJson(outcome, outcome.sent.length > 0 ? 200 : 502);
  } catch (err) {
    if (err instanceof EmailingError) return financeError(err.code as never, err.message, err.status);
    return financeErrorFromException(err, 'Could not send the books');
  }
}
