import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@/lib/finances/access';
import { upsertSchedule, deleteSchedule, listSchedules, toPublicSchedule, isScheduleKind, ScheduleError, type ScheduleKind } from '@/lib/finances/schedules';
import { getFinanceSettings } from '@/lib/finances/settings';
import { getEmailPreferences, parseSpendTarget, setDailySpendTarget } from '@/lib/finances/daily-subscriptions';
import { EmailingError } from '@/lib/finances/emailing';
import { financeError, financeErrorFromException, financeJson, readJsonBody } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/** `?kind=` (or body `kind`) picks the schedule; the weekly digest by default. */
function kindOf(req: NextRequest, body?: Record<string, unknown>): ScheduleKind | null {
  const raw = body?.kind ?? req.nextUrl.searchParams.get('kind');
  if (raw === undefined || raw === null || raw === '') return 'weekly_digest';
  return isScheduleKind(raw) ? raw : null;
}

/**
 * GET /api/finances/email-schedules — the schedule of `?kind=` (weekly
 * digest by default) as `schedule`, and every schedule as `schedules`.
 */
export async function GET(req: NextRequest) {
  const guard = await requireFinanceAccess(req, 'finance.read');
  if (guard instanceof NextResponse) return guard;
  const kind = kindOf(req);
  if (!kind) return financeError('invalid_request', 'kind must be weekly_digest or daily_summary', 400);
  try {
    const all = await listSchedules(guard.id);
    const schedule = all.find((s) => s.kind === kind) ?? null;
    const prefs = await getEmailPreferences(guard.id);
    return financeJson({
      schedule: schedule ? toPublicSchedule(schedule) : null,
      schedules: all.map(toPublicSchedule),
      dailySpendTarget: prefs?.daily_spend_target ?? null,
      dailySummaryOptedOutAt: prefs?.daily_summary_opted_out_at ?? null,
      weeklyDigestOptedOutAt: prefs?.weekly_digest_opted_out_at ?? null,
      // The weekly digest and the daily summary are the default account
      // reports: on for every merchant with a linked bank unless turned off.
      defaultReports: ['weekly_digest', 'daily_summary'],
    });
  } catch (err) {
    return financeErrorFromException(err, 'Could not read the schedule');
  }
}

/**
 * POST /api/finances/email-schedules — create or update a schedule.
 * Body: `{ kind?: "weekly_digest" | "daily_summary", weekdays?: [1,5],
 * hour?: 8, timezone?, recipients?: [...], scope?: "business",
 * formats?: ["pdf","csv"], active?: true }`. Weekly digest defaults: Monday
 * and Friday at 08:00; daily summary: every day at 07:00, all accounts.
 * Both in the saved finance timezone, to the merchant's own address.
 *
 * `target` (daily summary only): the $/day spend target, or null to clear
 * it. A body with `target` and no schedule fields sets the target alone and
 * does not turn the summary on.
 */
const SCHEDULE_FIELDS = ['weekdays', 'hour', 'timezone', 'recipients', 'scope', 'formats', 'active'];
export async function POST(req: NextRequest) {
  const guard = await requireFinanceAccess(req, 'finance.manage', { write: true });
  if (guard instanceof NextResponse) return guard;
  const body = await readJsonBody<Record<string, unknown>>(req);
  const kind = kindOf(req, body);
  if (!kind) return financeError('invalid_request', 'kind must be weekly_digest or daily_summary', 400);
  const hasTarget = body !== null && typeof body === 'object' && 'target' in body;
  if (hasTarget && kind !== 'daily_summary') return financeError('invalid_request', 'target applies to the daily summary only', 400);
  let target: number | null = null;
  if (hasTarget) {
    try {
      target = parseSpendTarget(body.target);
    } catch (err) {
      return financeError('invalid_request', err instanceof Error ? err.message : 'Invalid target', 400);
    }
  }
  try {
    if (hasTarget) await setDailySpendTarget(guard.id, target);
    const touchesSchedule = !hasTarget || SCHEDULE_FIELDS.some((f) => body[f] !== undefined);
    if (!touchesSchedule) {
      const all = await listSchedules(guard.id);
      const current = all.find((s) => s.kind === kind) ?? null;
      return financeJson({ schedule: current ? toPublicSchedule(current) : null, dailySpendTarget: target });
    }
    const settings = await getFinanceSettings(guard.id);
    const schedule = await upsertSchedule(guard.id, body, { timezone: settings?.timezone ?? 'UTC', email: guard.email }, kind);
    return financeJson({ schedule: toPublicSchedule(schedule), ...(hasTarget ? { dailySpendTarget: target } : {}) });
  } catch (err) {
    if (err instanceof ScheduleError || err instanceof EmailingError) return financeError(err.code as never, err.message, err.status);
    return financeErrorFromException(err, 'Could not save the schedule');
  }
}

/**
 * DELETE /api/finances/email-schedules — stop the weekly digest, or
 * `?kind=daily_summary`. Either is an opt-out that nothing automatic undoes.
 */
export async function DELETE(req: NextRequest) {
  const guard = await requireFinanceAccess(req, 'finance.manage', { write: true });
  if (guard instanceof NextResponse) return guard;
  const kind = kindOf(req);
  if (!kind) return financeError('invalid_request', 'kind must be weekly_digest or daily_summary', 400);
  try {
    const removed = await deleteSchedule(guard.id, kind);
    return financeJson({ success: removed });
  } catch (err) {
    return financeErrorFromException(err, 'Could not delete the schedule');
  }
}
