import { describe, it, expect } from 'vitest';
import { divideAmount, multiplyAmount, estimateLeadingGap, combineWithEstimate } from './estimates';

const LA = 'America/Los_Angeles';

describe('divideAmount / multiplyAmount', () => {
  it('divides at four decimals, rounding half away from zero', () => {
    expect(divideAmount('100', 3)).toBe('33.3333');
    expect(divideAmount('-100', 3)).toBe('-33.3333');
    expect(divideAmount('1', 8)).toBe('0.125');
    expect(divideAmount('0.0001', 2)).toBe('0.0001');
    expect(() => divideAmount('1', 0)).toThrow();
  });

  it('multiplies exactly', () => {
    expect(multiplyAmount('33.3333', 3)).toBe('99.9999');
    expect(multiplyAmount('-0.5', 4)).toBe('-2');
  });
});

describe('estimateLeadingGap', () => {
  it('extrapolates the observed daily mean over the days the bank supplied nothing for', () => {
    // Report Jan 1 to a cutoff of Sep 12 at 10:52 PDT; first posting Feb 20.
    const e = estimateLeadingGap({
      currency: 'USD',
      start: '2026-01-01T08:00:00.000Z',
      end: '2026-09-12T17:52:11.000Z',
      timezone: LA,
      firstPosted: '2026-02-20T12:00:00.000Z',
      observedCredits: '46240.57',
      observedDebits: '90677.08',
    });
    expect(e).not.toBeNull();
    expect(e!.gapStart).toBe('2026-01-01');
    expect(e!.gapEnd).toBe('2026-02-20');
    expect(e!.missingDays).toBe(50);
    // Feb 20 through Sep 12 inclusive: the cutoff day counts as observed.
    expect(e!.observedStart).toBe('2026-02-20');
    expect(e!.observedEnd).toBe('2026-09-13');
    expect(e!.observedDays).toBe(205);
    expect(e!.dailyMeanCredits).toBe(divideAmount('46240.57', 205));
    expect(e!.estimatedCredits).toBe(multiplyAmount(e!.dailyMeanCredits, 50));
    expect(e!.estimatedDebits).toBe(multiplyAmount(divideAmount('90677.08', 205), 50));
    expect(e!.basis).toMatch(/Not observed transactions/);
  });

  it('treats an end at local midnight as exclusive of that day', () => {
    const e = estimateLeadingGap({
      currency: 'USD',
      start: '2026-01-01T08:00:00.000Z',
      end: '2026-03-01T08:00:00.000Z',
      timezone: LA,
      firstPosted: '2026-02-01T12:00:00.000Z',
      observedCredits: '28',
      observedDebits: '0',
    });
    expect(e!.observedDays).toBe(28);
    expect(e!.dailyMeanCredits).toBe('1');
    expect(e!.missingDays).toBe(31);
    expect(e!.estimatedCredits).toBe('31');
  });

  it('returns null when there is no gap worth estimating', () => {
    const base = { currency: 'USD', start: '2026-01-01T08:00:00.000Z', end: '2026-02-01T08:00:00.000Z', timezone: LA, observedCredits: '10', observedDebits: '5' };
    expect(estimateLeadingGap({ ...base, firstPosted: null })).toBeNull();
    expect(estimateLeadingGap({ ...base, firstPosted: '2026-01-01T20:00:00.000Z' })).toBeNull();
    expect(estimateLeadingGap({ ...base, firstPosted: '2026-01-02T20:00:00.000Z' })).toBeNull();
  });

  it('combines observed and estimated totals exactly', () => {
    const e = estimateLeadingGap({
      currency: 'USD', start: '2026-01-01T08:00:00.000Z', end: '2026-03-01T08:00:00.000Z', timezone: LA,
      firstPosted: '2026-02-01T12:00:00.000Z', observedCredits: '28', observedDebits: '14',
    })!;
    expect(combineWithEstimate({ credits: '28', debits: '14' }, e)).toEqual({ credits: '59', debits: '29.5', net: '29.5' });
  });
});
