import 'server-only';
import { getSupabaseAdmin } from '../supabase/server';
import { isValidTimeZone, zonedMidnight, wallClock, localDate, addDays } from './periods';
import { normalizeRecipients, sendBooksEmail, sendReportEmail, resolveBooksSelection, renderBooksFormat, booksEmailBlock, EmailingError, type SendOutcome } from './emailing';
import { booksSummary } from './books';
import type { EmailAttachment } from '../email';
import { audit } from './audit';

/**
 * Scheduled emails: a weekly digest on chosen weekdays.
 *
 * One row per merchant. The worker turns a due row into an `email_report`
 * job, which sends the previous seven days of the books (totals by tax
 * category, unreviewed count, the CPA pack attached) to the recipients.
 * Days and the hour are in the merchant's finance timezone; the next run
 * is computed from those, never from the server clock's day.
 */

export interface EmailScheduleRow {
  id: string;
  merchant_id: string;
  kind: 'weekly_digest';
  weekdays: number[];
  hour: number;
  timezone: string;
  recipients: string[];
  scope: 'business' | 'personal' | 'all';
  formats: string[];
  active: boolean;
  last_sent_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = 'id, merchant_id, kind, weekdays, hour, timezone, recipients, scope, formats, active, last_sent_at, next_run_at, created_at, updated_at';

export class ScheduleError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Local weekday (0 = Sunday) of an instant in a zone. */
export function localWeekday(instant: Date, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  return new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay();
}

/**
 * The first instant after `now` that lands on one of `weekdays` at `hour`
 * local time. Pure, exported for tests.
 */
export function nextRunAt(weekdays: number[], hour: number, timeZone: string, now: Date = new Date()): Date {
  const days = [...new Set(weekdays)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (days.length === 0) throw new ScheduleError('invalid_request', 'Pick at least one weekday', 400);
  let date = localDate(now, timeZone);
  for (let i = 0; i < 8; i += 1) {
    const [y, m, d] = date.split('-').map(Number);
    const midnight = zonedMidnight(y, m, d, timeZone);
    const candidate = new Date(midnight.getTime() + hour * 3_600_000);
    if (candidate > now && days.includes(localWeekday(candidate, timeZone))) return candidate;
    date = addDays(date, 1);
  }
  throw new ScheduleError('internal_error', 'Could not compute the next run', 500);
}

export function toPublicSchedule(row: EmailScheduleRow) {
  return {
    id: row.id,
    kind: row.kind,
    weekdays: row.weekdays,
    hour: row.hour,
    timezone: row.timezone,
    recipients: row.recipients,
    scope: row.scope,
    formats: row.formats,
    active: row.active,
    lastSentAt: row.last_sent_at,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
  };
}

export async function getSchedule(merchantId: string, kind: 'weekly_digest' = 'weekly_digest'): Promise<EmailScheduleRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_email_schedules')
    .select(COLUMNS)
    .eq('merchant_id', merchantId)
    .eq('kind', kind)
    .maybeSingle();
  if (error) throw new Error(`Could not read the schedule: ${error.message}`);
  return (data as EmailScheduleRow | null) ?? null;
}

export async function upsertSchedule(
  merchantId: string,
  input: { weekdays?: unknown; hour?: unknown; timezone?: unknown; recipients?: unknown; scope?: unknown; formats?: unknown; active?: unknown },
  defaults: { timezone: string; email: string },
): Promise<EmailScheduleRow> {
  const supabase = getSupabaseAdmin();
  const existing = await getSchedule(merchantId);

  const weekdays = input.weekdays === undefined
    ? existing?.weekdays ?? [1, 5]
    : (Array.isArray(input.weekdays) ? input.weekdays : []).map((v) => Number(v)).filter((v) => Number.isInteger(v) && v >= 0 && v <= 6);
  if (weekdays.length === 0) throw new ScheduleError('invalid_request', 'weekdays must be a list of 0 (Sunday) to 6 (Saturday)', 400);
  const hour = input.hour === undefined ? existing?.hour ?? 8 : Number(input.hour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new ScheduleError('invalid_request', 'hour must be 0 to 23', 400);
  const timezone = input.timezone === undefined ? existing?.timezone ?? defaults.timezone : String(input.timezone);
  if (!isValidTimeZone(timezone)) throw new ScheduleError('invalid_timezone', 'timezone must be an IANA name', 400);
  const recipients = input.recipients === undefined ? existing?.recipients ?? [defaults.email] : normalizeRecipients(input.recipients);
  const scope = input.scope === undefined ? existing?.scope ?? 'business' : input.scope;
  if (scope !== 'business' && scope !== 'personal' && scope !== 'all') throw new ScheduleError('invalid_request', 'scope must be business, personal or all', 400);
  const formats = input.formats === undefined
    ? existing?.formats ?? ['pdf', 'csv']
    : (Array.isArray(input.formats) ? input.formats : []).map(String).filter((f) => ['pdf', 'csv', 'html', 'json'].includes(f));
  if (formats.length === 0) throw new ScheduleError('invalid_request', 'formats must be among pdf, csv, html, json', 400);
  const active = input.active === undefined ? existing?.active ?? true : input.active === true;
  const next = active ? nextRunAt(weekdays, hour, timezone).toISOString() : null;

  const { data, error } = await supabase
    .from('finance_email_schedules')
    .upsert(
      { merchant_id: merchantId, kind: 'weekly_digest', weekdays, hour, timezone, recipients, scope, formats, active, next_run_at: next, updated_at: new Date().toISOString() },
      { onConflict: 'merchant_id,kind' },
    )
    .select(COLUMNS)
    .single();
  if (error) throw new Error(`Could not save the schedule: ${error.message}`);
  await audit(merchantId, 'email_schedule.save', 'schedule', (data as EmailScheduleRow).id, { weekdays: weekdays.join(','), hour, active, recipients: recipients.length });
  return data as EmailScheduleRow;
}

export async function deleteSchedule(merchantId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('finance_email_schedules').delete().eq('merchant_id', merchantId).eq('kind', 'weekly_digest').select('id');
  if (error) throw new Error(`Could not delete the schedule: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Send the digest for a schedule: the previous seven local days, ending at
 * local midnight today, so a Monday digest is last week and a Friday
 * digest is Saturday through Thursday.
 */
export async function sendDigest(schedule: EmailScheduleRow, now: Date = new Date()): Promise<SendOutcome & { rows: number; unreviewed: number }> {
  const today = localDate(now, schedule.timezone);
  const from = addDays(today, -7);
  const label = `${from} to ${addDays(today, -1)}`;
  const booksOnly = (why: string) =>
    sendBooksEmail({
      merchantId: schedule.merchant_id,
      selection: { from, to: today, timezone: schedule.timezone, scope: schedule.scope },
      to: schedule.recipients,
      formats: schedule.formats,
      subjectPrefix: 'CoinPay weekly digest',
      message: `Your ${schedule.scope} books for the seven days ${label}. ${why} Review anything still unconfirmed at /finances/books.`,
    });

  // The week's activity report, with its executive summary and charts. It
  // is generated by the report worker like any other; until it is ready
  // this throws `report_not_ready` and the email job retries shortly. The
  // idempotency key makes every retry find the same report.
  const { createReport, getReport, ReportError } = await import('./reports');
  let reportId: string;
  let status: string;
  try {
    const { report } = await createReport({
      merchantId: schedule.merchant_id,
      from,
      to: today,
      timezone: schedule.timezone,
      scope: schedule.scope,
      includePending: true,
      formats: ['pdf', 'csv', 'json', 'html'],
      idempotencyKey: `digest:${schedule.id}:${from}`,
    });
    reportId = report.id;
    status = report.status;
  } catch (err) {
    // No accounts in scope, or a period the report layer refuses: the books
    // still go out, and say why the report did not.
    if (err instanceof ReportError) return booksOnly(`(No activity report this week: ${err.message}.)`);
    throw err;
  }
  if (status !== 'ready' && status !== 'superseded') {
    const current = await getReport(reportId, schedule.merchant_id);
    status = current?.status ?? 'missing';
  }
  if (status === 'failed') return booksOnly('(The activity report for this week could not be generated; see /finances/reports.)');
  if (status !== 'ready' && status !== 'superseded') {
    throw new EmailingError('report_not_ready', `Weekly activity report ${reportId} is ${status}; the digest will retry once it is ready`, 409);
  }

  const bounded = resolveBooksSelection({ from, to: today, timezone: schedule.timezone, scope: schedule.scope });
  const summary = await booksSummary(schedule.merchant_id, { start: bounded.start, end: bounded.effectiveEnd, scope: schedule.scope });
  const extras: EmailAttachment[] = [];
  for (const format of schedule.formats) {
    const file = await renderBooksFormat(summary, format, { timezone: bounded.timezone, periodLabel: bounded.label });
    extras.push({ filename: file.filename, content: file.bytes, contentType: file.contentType });
  }
  const outcome = await sendReportEmail({
    merchantId: schedule.merchant_id,
    reportId,
    to: schedule.recipients,
    formats: schedule.formats,
    subjectPrefix: 'CoinPay weekly digest',
    message: `Your weekly digest for ${label}: the activity report with its executive summary and charts, and the ${schedule.scope} books for the same seven days. Review anything still unconfirmed at /finances/books.`,
    extraAttachments: extras,
    extraBody: booksEmailBlock(summary, label),
  });
  return { ...outcome, rows: summary.rows, unreviewed: summary.unreviewed };
}

/** Due schedules become `email_report` jobs; their next run moves on. */
export async function enqueueScheduledEmails(now: Date = new Date()): Promise<number> {
  if (process.env.FINANCES_EMAIL_SCHEDULES_ENABLED === 'false') return 0;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_email_schedules')
    .select(COLUMNS)
    .eq('active', true)
    .lte('next_run_at', now.toISOString())
    .limit(100);
  if (error) throw new Error(`Could not read email schedules: ${error.message}`);
  const { createJob } = await import('./jobs');
  let created = 0;
  for (const raw of data ?? []) {
    const row = raw as EmailScheduleRow;
    const next = nextRunAt(row.weekdays, row.hour, row.timezone, now).toISOString();
    await supabase.from('finance_email_schedules').update({ next_run_at: next, updated_at: now.toISOString() }).eq('id', row.id);
    await createJob({
      merchantId: row.merchant_id,
      kind: 'email_report',
      params: { scheduleId: row.id, kind: row.kind, slot: row.next_run_at },
      idempotencyKey: `digest:${row.id}:${row.next_run_at}`,
    });
    created += 1;
  }
  return created;
}

export async function markDigestSent(scheduleId: string, at: Date = new Date()): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase.from('finance_email_schedules').update({ last_sent_at: at.toISOString(), updated_at: at.toISOString() }).eq('id', scheduleId);
}

export async function getScheduleById(scheduleId: string, merchantId: string): Promise<EmailScheduleRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('finance_email_schedules').select(COLUMNS).eq('id', scheduleId).eq('merchant_id', merchantId).maybeSingle();
  if (error) throw new Error(`Could not read the schedule: ${error.message}`);
  return (data as EmailScheduleRow | null) ?? null;
}
