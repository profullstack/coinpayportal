import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => ({}) }));

import { scheduledSyncIntervalMs, REQUEST_BUDGET_PER_DAY, BACKGROUND_BUDGET_PER_DAY } from './budget';

describe('scheduledSyncIntervalMs', () => {
  it('defaults to thirty minutes', () => {
    expect(scheduledSyncIntervalMs({})).toBe(30 * 60_000);
  });

  it('reads the environment in minutes', () => {
    expect(scheduledSyncIntervalMs({ FINANCES_SCHEDULED_SYNC_INTERVAL_MINUTES: '90' })).toBe(90 * 60_000);
    expect(scheduledSyncIntervalMs({ FINANCES_SCHEDULED_SYNC_INTERVAL_MINUTES: '1440' })).toBe(1440 * 60_000);
  });

  it('never goes below fifteen minutes or above a week, and ignores junk', () => {
    // A typo like "3" must not turn into a sync every three minutes.
    expect(scheduledSyncIntervalMs({ FINANCES_SCHEDULED_SYNC_INTERVAL_MINUTES: '3' })).toBe(15 * 60_000);
    expect(scheduledSyncIntervalMs({ FINANCES_SCHEDULED_SYNC_INTERVAL_MINUTES: '999999' })).toBe(7 * 1440 * 60_000);
    expect(scheduledSyncIntervalMs({ FINANCES_SCHEDULED_SYNC_INTERVAL_MINUTES: 'often' })).toBe(30 * 60_000);
  });

  it('keeps the background budget below the whole-day budget', () => {
    // Four requests a day stay reserved for the Sync button.
    expect(BACKGROUND_BUDGET_PER_DAY).toBeLessThan(REQUEST_BUDGET_PER_DAY);
  });
});
