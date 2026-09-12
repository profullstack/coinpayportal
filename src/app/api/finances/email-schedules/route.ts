import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant, requireMerchantForWrite } from '@/lib/auth/merchant-guard';
import { getSchedule, upsertSchedule, deleteSchedule, toPublicSchedule, ScheduleError } from '@/lib/finances/schedules';
import { getFinanceSettings } from '@/lib/finances/settings';
import { EmailingError } from '@/lib/finances/emailing';
import { financeError, financeErrorFromException, financeJson, readJsonBody } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/** GET /api/finances/email-schedules — the weekly digest schedule, if any. */
export async function GET(req: NextRequest) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;
  try {
    const schedule = await getSchedule(guard.id);
    return financeJson({ schedule: schedule ? toPublicSchedule(schedule) : null });
  } catch (err) {
    return financeErrorFromException(err, 'Could not read the schedule');
  }
}

/**
 * POST /api/finances/email-schedules — create or update the weekly digest.
 * Body: `{ weekdays?: [1,5], hour?: 8, timezone?, recipients?: [...],
 * scope?: "business", formats?: ["pdf","csv"], active?: true }`. Defaults:
 * Monday and Friday at 08:00 in the saved finance timezone, to the
 * merchant's own address.
 */
export async function POST(req: NextRequest) {
  const guard = await requireMerchantForWrite(req);
  if (guard instanceof NextResponse) return guard;
  const body = await readJsonBody<Record<string, unknown>>(req);
  try {
    const settings = await getFinanceSettings(guard.id);
    const schedule = await upsertSchedule(guard.id, body, { timezone: settings?.timezone ?? 'UTC', email: guard.email });
    return financeJson({ schedule: toPublicSchedule(schedule) });
  } catch (err) {
    if (err instanceof ScheduleError || err instanceof EmailingError) return financeError(err.code as never, err.message, err.status);
    return financeErrorFromException(err, 'Could not save the schedule');
  }
}

/** DELETE /api/finances/email-schedules — stop the weekly digest. */
export async function DELETE(req: NextRequest) {
  const guard = await requireMerchantForWrite(req);
  if (guard instanceof NextResponse) return guard;
  try {
    const removed = await deleteSchedule(guard.id);
    return financeJson({ success: removed });
  } catch (err) {
    return financeErrorFromException(err, 'Could not delete the schedule');
  }
}
