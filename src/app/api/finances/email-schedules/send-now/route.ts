import { NextRequest, NextResponse } from 'next/server';
import { requireMerchantForWrite } from '@/lib/auth/merchant-guard';
import { getSchedule, sendDigest, markDigestSent, ScheduleError } from '@/lib/finances/schedules';
import { EmailingError } from '@/lib/finances/emailing';
import { financeError, financeErrorFromException, financeJson } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** POST /api/finances/email-schedules/send-now — send the digest immediately, as a test or on demand. */
export async function POST(req: NextRequest) {
  const guard = await requireMerchantForWrite(req);
  if (guard instanceof NextResponse) return guard;
  try {
    const schedule = await getSchedule(guard.id);
    if (!schedule) return financeError('not_found', 'No weekly digest is configured yet', 404);
    const outcome = await sendDigest(schedule);
    if (outcome.sent.length > 0) await markDigestSent(schedule.id);
    return financeJson(outcome, outcome.sent.length > 0 ? 200 : 502);
  } catch (err) {
    if (err instanceof ScheduleError || err instanceof EmailingError) return financeError(err.code as never, err.message, err.status);
    return financeErrorFromException(err, 'Could not send the digest');
  }
}
