import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatMoney, formatCompact, formatDate, formatRelative, percentOf } from './format';

describe('formatMoney', () => {
  it('formats positive and negative amounts', () => {
    expect(formatMoney(1234.5, 'USD')).toBe('$1,234.50');
    expect(formatMoney(-2653.49, 'USD')).toBe('-$2,653.49');
  });

  it('never renders negative zero as a debt', () => {
    // -0 through Intl gives "-$0.00", which reads as owing money that is not owed.
    expect(formatMoney(-0, 'USD')).toBe('$0.00');
    expect(formatMoney(0, 'USD')).toBe('$0.00');
  });

  it('adds an explicit plus only when asked', () => {
    expect(formatMoney(20, 'USD', { signed: true })).toBe('+$20.00');
    expect(formatMoney(-20, 'USD', { signed: true })).toBe('-$20.00');
    expect(formatMoney(20, 'USD')).toBe('$20.00');
  });

  it('renders an em dash for missing values', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
    expect(formatMoney(Number.NaN)).toBe('—');
  });

  it('falls back rather than throwing on an unknown currency code', () => {
    expect(formatMoney(10, 'NOTACURRENCY')).toContain('10.00');
  });
});

describe('formatCompact', () => {
  it('stays exact below the compact threshold', () => {
    expect(formatCompact(999.5, 'USD')).toBe('$999.50');
  });

  it('compacts larger amounts and keeps the sign', () => {
    expect(formatCompact(33998.35, 'USD')).toBe('$34K');
    expect(formatCompact(-33998.35, 'USD')).toBe('-$34K');
  });
});

describe('formatDate', () => {
  it('formats an ISO instant as a UTC calendar day', () => {
    expect(formatDate('2026-08-19T00:00:00.000Z')).toBe('19 Aug 2026');
  });

  it('handles missing and unparseable input', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not a date')).toBe('—');
  });
});

describe('formatRelative', () => {
  afterEach(() => vi.useRealTimers());

  it('describes recent instants in the largest sensible unit', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-19T12:00:00.000Z'));

    expect(formatRelative('2026-08-19T11:59:30.000Z')).toBe('just now');
    expect(formatRelative('2026-08-19T11:00:00.000Z')).toBe('1 hour ago');
    expect(formatRelative('2026-08-17T12:00:00.000Z')).toBe('2 days ago');
    expect(formatRelative('2026-08-05T12:00:00.000Z')).toBe('2 weeks ago');
  });

  it('says never for a connection that has not synced', () => {
    expect(formatRelative(null)).toBe('never');
  });
});

describe('percentOf', () => {
  it('computes a bounded percentage', () => {
    expect(percentOf(25, 100)).toBe(25);
    expect(percentOf(150, 100)).toBe(100);
  });

  it('returns 0 instead of NaN when the total is zero', () => {
    // A NaN width silently collapses every bar in the chart.
    expect(percentOf(10, 0)).toBe(0);
    expect(percentOf(Number.NaN, 100)).toBe(0);
  });
});
