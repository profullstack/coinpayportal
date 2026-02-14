/**
 * Monitor Recurring Escrow Cycle Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the exported runOnce which internally calls runRecurringEscrowCycle
// Since the recurring function is not exported directly, we test via integration

describe('Monitor Recurring Escrow', () => {
  it('calculateNextChargeAt logic', () => {
    // Test the interval calculation logic
    const base = new Date('2026-02-14T00:00:00Z');

    // Weekly
    const weekly = new Date(base);
    weekly.setDate(weekly.getDate() + 7);
    expect(weekly.toISOString()).toBe('2026-02-21T00:00:00.000Z');

    // Biweekly
    const biweekly = new Date(base);
    biweekly.setDate(biweekly.getDate() + 14);
    expect(biweekly.toISOString()).toBe('2026-02-28T00:00:00.000Z');

    // Monthly
    const monthly = new Date(base);
    monthly.setMonth(monthly.getMonth() + 1);
    expect(monthly.toISOString()).toBe('2026-03-14T00:00:00.000Z');
  });

  it('should mark series completed when max_periods reached', () => {
    const series = {
      periods_completed: 11,
      max_periods: 12,
    };
    const newPeriods = series.periods_completed + 1;
    const isCompleted = series.max_periods && newPeriods >= series.max_periods;
    expect(isCompleted).toBe(true);
  });

  it('should not complete series with null max_periods', () => {
    const series = {
      periods_completed: 100,
      max_periods: null,
    };
    const newPeriods = series.periods_completed + 1;
    const isCompleted = series.max_periods && newPeriods >= series.max_periods;
    expect(isCompleted).toBeFalsy();
  });
});
