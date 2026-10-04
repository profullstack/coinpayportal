/**
 * Calendar periods for finance reports.
 *
 * A "month" here is a real calendar month in a real timezone, never a rolling
 * thirty days. Every interval is half-open, `[start, end)`: the instant of
 * local midnight on the first day, up to but excluding local midnight on the
 * first day of the next period. A transaction posted at exactly the end
 * instant belongs to the next period, so two adjacent reports can never both
 * count it.
 *
 * Wall-clock to instant conversion is done with `Intl`, which every
 * supported Node carries, so no timezone library is needed. Daylight-saving
 * transitions are handled by resolving the offset at the guessed instant and
 * correcting once; the only case that still needs a decision is a midnight
 * that does not exist (a zone that springs forward at 00:00), where the first
 * valid instant after it is used.
 */

export type PeriodKind = 'month' | 'quarter' | 'custom';

export interface ResolvedPeriod {
  kind: PeriodKind;
  /** The selector as given, e.g. `2026-08`, `2026-Q2`, or `2026-04-01..2026-07-01`. */
  selector: string;
  /** Human label, e.g. `August 2026` or `Q2 2026`. */
  label: string;
  timezone: string;
  /** Local calendar date of the first day, `YYYY-MM-DD`. */
  startDate: string;
  /** Local calendar date the period ends BEFORE (exclusive), `YYYY-MM-DD`. */
  endDate: string;
  /** Instant of local midnight on `startDate`, ISO 8601. */
  start: string;
  /** Instant of local midnight on `endDate` (exclusive), ISO 8601. */
  end: string;
}

const SELECTOR_MONTH = /^(\d{4})-(\d{2})$/;
const SELECTOR_QUARTER = /^(\d{4})-Q([1-4])$/i;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Accept only unambiguous IANA names. `Intl` also accepts abbreviations such
 * as `EST`, which name an offset in one country and a different one in
 * another; a report stamped with one of those could not be reproduced.
 */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const tz = value.trim();
  // Bounded on purpose: an IANA name is at most three slash-separated
  // segments (America/Argentina/Buenos_Aires), and a fixed repeat count
  // keeps the pattern free of nested unbounded quantifiers on user input.
  if (tz.length > 64) return false;
  if (tz !== 'UTC' && !/^[A-Za-z]{1,32}(?:\/[A-Za-z0-9_+-]{1,32}){1,3}$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = partsCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsCache.set(timeZone, fmt);
  }
  return fmt;
}

/** Wall-clock fields of an instant in a zone. */
export function wallClock(instant: Date, timeZone: string) {
  const parts = formatter(timeZone).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Milliseconds the zone is ahead of UTC at this instant. */
function offsetAt(instant: Date, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant of local midnight on a calendar date in a zone.
 *
 * Correct across DST because the offset is recomputed at the candidate
 * instant. A non-existent midnight resolves to the first instant after it.
 */
export function zonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  let instant = new Date(guess - offsetAt(new Date(guess), timeZone));
  const correction = offsetAt(instant, timeZone);
  if (guess - correction !== instant.getTime()) {
    instant = new Date(guess - correction);
  }
  const onDay = (d: Date) => {
    const c = wallClock(d, timeZone);
    return c.year === year && c.month === month && c.day === day;
  };
  if (onDay(instant)) {
    const w = wallClock(instant, timeZone);
    if (w.hour === 0 && w.minute === 0 && w.second === 0) return instant;
  }

  // The midnight was skipped (a zone that springs forward at 00:00) or the
  // offset correction overshot into the previous day. Find the first instant
  // that falls on the requested local date: step forward until we are on it,
  // then binary-search back to the exact second the day began.
  let before = onDay(instant) ? new Date(instant.getTime() - 3_600_000) : instant;
  while (onDay(before)) before = new Date(before.getTime() - 3_600_000);
  let after = new Date(before.getTime() + 3_600_000);
  for (let i = 0; i < 48 && !onDay(after); i += 1) after = new Date(after.getTime() + 3_600_000);
  if (!onDay(after)) {
    throw new Error(`Could not resolve midnight for ${year}-${month}-${day} in ${timeZone}`);
  }
  let lo = before.getTime();
  let hi = after.getTime();
  while (hi - lo > 1000) {
    const mid = lo + Math.floor((hi - lo) / 2000) * 1000;
    if (onDay(new Date(mid))) hi = mid;
    else lo = mid;
  }
  return new Date(hi);
}

/** Local calendar date of an instant, `YYYY-MM-DD`. */
export function localDate(instant: Date, timeZone: string): string {
  const w = wallClock(instant, timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isValidDate(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** Add whole calendar months to a `YYYY-MM-DD`, clamping the day. */
export function addMonths(date: string, months: number): string {
  const m = ISO_DATE.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(Number(m[3]), daysInMonth(year, month));
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Add days to a `YYYY-MM-DD` using proleptic Gregorian arithmetic. */
export function addDays(date: string, days: number): string {
  const m = ISO_DATE.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function parseIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = ISO_DATE.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!isValidDate(year, month, day)) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export class PeriodError extends Error {
  code = 'invalid_period' as const;
}

export interface PeriodInput {
  /** `YYYY-MM` or `YYYY-Qn`. Mutually exclusive with `from`/`to`. */
  period?: string | null;
  /** Inclusive local start date `YYYY-MM-DD`. */
  from?: string | null;
  /** Exclusive local end date `YYYY-MM-DD`. */
  to?: string | null;
  timezone: string;
}

/**
 * Resolve a selector to instants.
 *
 * @throws {PeriodError} for a malformed selector, an invalid timezone,
 *         `period` combined with `from`/`to`, or `to` not after `from`.
 */
export function resolvePeriod(input: PeriodInput): ResolvedPeriod {
  if (!isValidTimeZone(input.timezone)) {
    throw new PeriodError(
      `Timezone must be an IANA name such as America/Los_Angeles (got ${JSON.stringify(input.timezone ?? null)})`,
    );
  }
  const timezone = input.timezone.trim();
  const period = input.period?.trim() || null;
  const from = input.from?.trim() || null;
  const to = input.to?.trim() || null;

  if (period && (from || to)) {
    throw new PeriodError('Use either a period selector or an explicit from/to range, not both');
  }

  let kind: PeriodKind;
  let selector: string;
  let label: string;
  let startDate: string;
  let endDate: string;

  if (period) {
    const month = SELECTOR_MONTH.exec(period);
    const quarter = SELECTOR_QUARTER.exec(period);
    if (month) {
      const y = Number(month[1]);
      const m = Number(month[2]);
      if (m < 1 || m > 12) throw new PeriodError(`Invalid month in period ${period}`);
      kind = 'month';
      selector = `${y}-${pad(m)}`;
      label = `${MONTH_NAMES[m - 1]} ${y}`;
      startDate = `${y}-${pad(m)}-01`;
      endDate = addMonths(startDate, 1);
    } else if (quarter) {
      const y = Number(quarter[1]);
      const q = Number(quarter[2]);
      kind = 'quarter';
      selector = `${y}-Q${q}`;
      label = `Q${q} ${y}`;
      startDate = `${y}-${pad((q - 1) * 3 + 1)}-01`;
      endDate = addMonths(startDate, 3);
    } else {
      throw new PeriodError(`Period must look like 2026-08 or 2026-Q2 (got ${period})`);
    }
  } else {
    if (!from || !to) {
      throw new PeriodError('A custom range needs both from (inclusive) and to (exclusive) dates');
    }
    const f = parseIsoDate(from);
    const t = parseIsoDate(to);
    if (!f) throw new PeriodError(`Invalid from date ${from}; expected YYYY-MM-DD`);
    if (!t) throw new PeriodError(`Invalid to date ${to}; expected YYYY-MM-DD`);
    if (t <= f) throw new PeriodError('The to date is exclusive and must be after the from date');
    kind = 'custom';
    selector = `${f}..${t}`;
    startDate = f;
    endDate = t;
    label = `${f} to ${addDays(t, -1)}`;
  }

  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const start = zonedMidnight(sy, sm, sd, timezone);
  const end = zonedMidnight(ey, em, ed, timezone);

  return {
    kind,
    selector,
    label,
    timezone,
    startDate,
    endDate,
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

export interface EffectivePeriod extends ResolvedPeriod {
  /** The instant the snapshot was taken; nothing after it can be included. */
  cutoff: string;
  /** `end`, or `cutoff` when the period is still running. */
  effectiveEnd: string;
  /** True when `effectiveEnd` is earlier than the requested `end`. */
  periodToDate: boolean;
}

/**
 * Bound a period by a cutoff instant.
 *
 * @throws {PeriodError} when the period has not started yet.
 */
export function boundPeriod(period: ResolvedPeriod, cutoff: Date): EffectivePeriod {
  const cutoffIso = cutoff.toISOString();
  if (period.start >= cutoffIso) {
    throw new PeriodError(`${period.label} has not started yet; a report cannot be generated for a future period`);
  }
  const periodToDate = period.end > cutoffIso;
  return {
    ...period,
    cutoff: cutoffIso,
    effectiveEnd: periodToDate ? cutoffIso : period.end,
    periodToDate,
  };
}

export interface FetchWindowPlan {
  /** Local date the chunk starts on (inclusive). */
  startDate: string;
  /** Local date the chunk ends before (exclusive). */
  endDate: string;
  start: string;
  end: string;
  days: number;
}

/**
 * Split a period into provider-safe chunks: one calendar month each, with an
 * overlap of `overlapDays` reaching back before the month so a late-posting
 * charge near a boundary is not missed. No chunk may exceed `maxDays`, and a
 * quarter is never expressed as a single 90-day request.
 */
export function planFetchWindows(
  period: Pick<ResolvedPeriod, 'startDate' | 'endDate' | 'timezone'>,
  { overlapDays = 5, maxDays = 45, cutoff }: { overlapDays?: number; maxDays?: number; cutoff?: Date } = {},
): FetchWindowPlan[] {
  const windows: FetchWindowPlan[] = [];
  const cutoffDate = cutoff ? addDays(localDate(cutoff, period.timezone), 1) : null;

  // Start from the first of the month containing startDate so chunks align
  // to calendar months, then clip the first one to the requested start.
  let monthStart = `${period.startDate.slice(0, 7)}-01`;
  while (monthStart < period.endDate) {
    const monthEnd = addMonths(monthStart, 1);
    let chunkStart = addDays(monthStart < period.startDate ? period.startDate : monthStart, -overlapDays);
    if (chunkStart < addDays(period.startDate, -overlapDays)) chunkStart = addDays(period.startDate, -overlapDays);
    let chunkEnd = monthEnd < period.endDate ? monthEnd : period.endDate;
    if (cutoffDate && chunkEnd > cutoffDate) chunkEnd = cutoffDate;

    if (chunkEnd > chunkStart) {
      // A month plus overlap is at most 36 days; split defensively anyway so a
      // wider maxDays policy change can never produce an over-long request.
      let s = chunkStart;
      while (s < chunkEnd) {
        const e = addDays(s, maxDays) < chunkEnd ? addDays(s, maxDays) : chunkEnd;
        const [sy, sm, sd] = s.split('-').map(Number);
        const [ey, em, ed] = e.split('-').map(Number);
        const startInstant = zonedMidnight(sy, sm, sd, period.timezone);
        const endInstant = zonedMidnight(ey, em, ed, period.timezone);
        windows.push({
          startDate: s,
          endDate: e,
          start: startInstant.toISOString(),
          end: endInstant.toISOString(),
          days: Math.round((endInstant.getTime() - startInstant.getTime()) / 86_400_000),
        });
        s = e;
      }
    }
    monthStart = monthEnd;
    if (cutoffDate && monthStart >= cutoffDate) break;
  }
  return windows;
}
