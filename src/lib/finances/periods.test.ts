import { describe, it, expect } from 'vitest';
import {
  resolvePeriod,
  boundPeriod,
  planFetchWindows,
  isValidTimeZone,
  zonedMidnight,
  localDate,
  addMonths,
  PeriodError,
} from './periods';

const LA = 'America/Los_Angeles';

describe('isValidTimeZone', () => {
  it('accepts IANA names and rejects abbreviations', () => {
    expect(isValidTimeZone('America/Los_Angeles')).toBe(true);
    expect(isValidTimeZone('Europe/London')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('EST')).toBe(false);
    expect(isValidTimeZone('PST8PDT')).toBe(false);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
  });
});

describe('zonedMidnight', () => {
  it('resolves local midnight across the year, including DST', () => {
    // PST (UTC-8) in January, PDT (UTC-7) in July.
    expect(zonedMidnight(2026, 1, 15, LA).toISOString()).toBe('2026-01-15T08:00:00.000Z');
    expect(zonedMidnight(2026, 7, 15, LA).toISOString()).toBe('2026-07-15T07:00:00.000Z');
    // The day of the spring-forward (2026-03-08) starts at PST midnight.
    expect(zonedMidnight(2026, 3, 8, LA).toISOString()).toBe('2026-03-08T08:00:00.000Z');
    // The day after is PDT.
    expect(zonedMidnight(2026, 3, 9, LA).toISOString()).toBe('2026-03-09T07:00:00.000Z');
    expect(zonedMidnight(2026, 11, 1, LA).toISOString()).toBe('2026-11-01T07:00:00.000Z');
    expect(zonedMidnight(2026, 11, 2, LA).toISOString()).toBe('2026-11-02T08:00:00.000Z');
  });

  it('handles a zone that springs forward at midnight', () => {
    // Santiago moves clocks at 00:00 → 01:00 on 2026-09-06; that midnight
    // does not exist, and the day begins at the first valid instant.
    const d = zonedMidnight(2026, 9, 6, 'America/Santiago');
    expect(localDate(d, 'America/Santiago')).toBe('2026-09-06');
    const before = new Date(d.getTime() - 1000);
    expect(localDate(before, 'America/Santiago')).toBe('2026-09-05');
  });

  it('is UTC when asked', () => {
    expect(zonedMidnight(2024, 2, 29, 'UTC').toISOString()).toBe('2024-02-29T00:00:00.000Z');
  });
});

describe('resolvePeriod', () => {
  it('resolves a calendar month as a half-open interval', () => {
    const p = resolvePeriod({ period: '2026-08', timezone: LA });
    expect(p.kind).toBe('month');
    expect(p.label).toBe('August 2026');
    expect(p.startDate).toBe('2026-08-01');
    expect(p.endDate).toBe('2026-09-01');
    expect(p.start).toBe('2026-08-01T07:00:00.000Z');
    expect(p.end).toBe('2026-09-01T07:00:00.000Z');
  });

  it('resolves quarters with their real lengths', () => {
    const q2 = resolvePeriod({ period: '2026-Q2', timezone: 'UTC' });
    expect(q2.startDate).toBe('2026-04-01');
    expect(q2.endDate).toBe('2026-07-01');
    const days = (Date.parse(q2.end) - Date.parse(q2.start)) / 86_400_000;
    expect(days).toBe(91);

    const q3 = resolvePeriod({ period: '2026-q3', timezone: 'UTC' });
    expect(q3.selector).toBe('2026-Q3');
    expect((Date.parse(q3.end) - Date.parse(q3.start)) / 86_400_000).toBe(92);
  });

  it('handles leap February and December rollover', () => {
    const feb = resolvePeriod({ period: '2024-02', timezone: 'UTC' });
    expect(feb.endDate).toBe('2024-03-01');
    expect((Date.parse(feb.end) - Date.parse(feb.start)) / 86_400_000).toBe(29);
    const dec = resolvePeriod({ period: '2025-12', timezone: 'UTC' });
    expect(dec.endDate).toBe('2026-01-01');
    expect(resolvePeriod({ period: '2025-Q4', timezone: 'UTC' }).endDate).toBe('2026-01-01');
  });

  it('treats --to as exclusive on custom ranges', () => {
    const p = resolvePeriod({ from: '2026-04-01', to: '2026-07-01', timezone: 'UTC' });
    expect(p.kind).toBe('custom');
    expect(p.label).toBe('2026-04-01 to 2026-06-30');
    expect(p.end).toBe('2026-07-01T00:00:00.000Z');
  });

  it('rejects incompatible or malformed input', () => {
    expect(() => resolvePeriod({ period: '2026-08', from: '2026-01-01', to: '2026-02-01', timezone: 'UTC' })).toThrow(PeriodError);
    expect(() => resolvePeriod({ period: '2026-13', timezone: 'UTC' })).toThrow(/month/i);
    expect(() => resolvePeriod({ period: 'august', timezone: 'UTC' })).toThrow(/2026-08/);
    expect(() => resolvePeriod({ from: '2026-02-30', to: '2026-03-01', timezone: 'UTC' })).toThrow(/from date/i);
    expect(() => resolvePeriod({ from: '2026-03-01', to: '2026-03-01', timezone: 'UTC' })).toThrow(/exclusive/i);
    expect(() => resolvePeriod({ period: '2026-08', timezone: 'EST' })).toThrow(/IANA/);
    expect(() => resolvePeriod({ timezone: 'UTC' })).toThrow(/from/);
  });
});

describe('boundPeriod', () => {
  it('marks a running period as period-to-date and clamps the end to the cutoff', () => {
    const p = resolvePeriod({ period: '2026-09', timezone: 'UTC' });
    const b = boundPeriod(p, new Date('2026-09-12T10:00:00Z'));
    expect(b.periodToDate).toBe(true);
    expect(b.effectiveEnd).toBe('2026-09-12T10:00:00.000Z');
    expect(b.end).toBe('2026-10-01T00:00:00.000Z');
  });

  it('leaves a finished period alone and rejects a future one', () => {
    const p = resolvePeriod({ period: '2026-08', timezone: 'UTC' });
    const b = boundPeriod(p, new Date('2026-09-12T10:00:00Z'));
    expect(b.periodToDate).toBe(false);
    expect(b.effectiveEnd).toBe(p.end);
    expect(() => boundPeriod(resolvePeriod({ period: '2027-01', timezone: 'UTC' }), new Date('2026-09-12T10:00:00Z'))).toThrow(/future/);
  });
});

describe('planFetchWindows', () => {
  it('splits a quarter into monthly chunks with overlap, none near 90 days', () => {
    const q2 = resolvePeriod({ period: '2026-Q2', timezone: 'UTC' });
    const windows = planFetchWindows(q2);
    expect(windows.map((w) => [w.startDate, w.endDate])).toEqual([
      ['2026-03-27', '2026-05-01'],
      ['2026-04-26', '2026-06-01'],
      ['2026-05-27', '2026-07-01'],
    ]);
    for (const w of windows) expect(w.days).toBeLessThanOrEqual(45);
    // The union covers the whole quarter, through the last day of June.
    expect(windows[windows.length - 1].end).toBe(q2.end);
  });

  it('covers a Q3 (92 days) completely', () => {
    const q3 = resolvePeriod({ period: '2026-Q3', timezone: LA });
    const windows = planFetchWindows(q3);
    expect(windows[0].start <= q3.start).toBe(true);
    expect(windows[windows.length - 1].end).toBe(q3.end);
    expect(windows).toHaveLength(3);
  });

  it('stops at the cutoff for a running period', () => {
    const p = resolvePeriod({ period: '2026-Q3', timezone: 'UTC' });
    const windows = planFetchWindows(p, { cutoff: new Date('2026-08-10T12:00:00Z') });
    expect(windows).toHaveLength(2);
    expect(windows[1].endDate).toBe('2026-08-11');
  });
});

describe('addMonths', () => {
  it('clamps the day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15');
  });
});
