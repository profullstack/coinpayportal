import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@/lib/finances/access';
import { getSchedule, sendDigest, sendDailySummary, sendWeeklyPayments, markDigestSent, isScheduleKind, ScheduleError } from '@/lib/finances/schedules';
import { EmailingError } from '@/lib/finances/emailing';
import { financeError, financeErrorFromException, financeJson } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/finances/email-schedules/send-now — send a scheduled email
 * immediately, as a test or on demand. `?kind=daily_summary` sends the daily
 * summary; the default is the weekly digest.
 */
export async function POST(req: NextRequest) {
  const guard = await requireFinanceAccess(req, 'finance.manage', { write: true });
  if (guard instanceof NextResponse) return guard;
  const kindParam = req.nextUrl.searchParams.get('kind');
  const kind = isScheduleKind(kindParam) ? kindParam : 'weekly_digest';
  try {
    const schedule = await getSchedule(guard.id, kind);
    if (!schedule) return financeError('not_found', `No ${kind.replace('_', ' ')} is configured yet`, 404);
    if (kind === 'weekly_payments') {
      const weekly = await sendWeeklyPayments(schedule);
      if (weekly.skipped) return financeJson({ ...weekly, message: 'No payments or invoices in the last seven days; nothing sent' });
      if (weekly.sent.length > 0) await markDigestSent(schedule.id);
      return financeJson(weekly, weekly.sent.length > 0 ? 200 : 502);
    }
    if (kind === 'daily_summary') {
      const daily = await sendDailySummary(schedule);
      if (daily.sent.length > 0) await markDigestSent(schedule.id);
      return financeJson(daily, daily.sent.length > 0 ? 200 : 502);
    }
    const outcome = await sendDigest(schedule);
    if (outcome.sent.length > 0) await markDigestSent(schedule.id);
    return financeJson(outcome, outcome.sent.length > 0 ? 200 : 502);
  } catch (err) {
    if (err instanceof ScheduleError || err instanceof EmailingError) return financeError(err.code as never, err.message, err.status);
    return financeErrorFromException(err, 'Could not send the digest');
  }
}
