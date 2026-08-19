import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => ({}) }));

import { isAdvisory, DEFAULT_SYNC_DAYS, MAX_SYNC_DAYS } from './sync';

describe('isAdvisory', () => {
  it('treats the bridge’s range notices as advisories, not failures', () => {
    // Both of these are real messages the bridge returned during development,
    // and both arrive in the same array as genuine institution errors.
    expect(
      isAdvisory('Requested date range exceeds recommended range of 45 days. In the future, this may be capped.'),
    ).toBe(true);
    expect(isAdvisory('Requested date range exceeds limit of 90 days and was capped.')).toBe(true);
  });

  it('leaves a real institution failure alone', () => {
    // The signal that must never be swallowed: a bank that stopped answering.
    expect(isAdvisory('Connection to Chase Bank needs to be re-authenticated')).toBe(false);
    expect(isAdvisory('Account temporarily unavailable')).toBe(false);
    expect(isAdvisory('')).toBe(false);
  });
});

describe('sync windows', () => {
  it('defaults inside the range the bridge recommends', () => {
    expect(DEFAULT_SYNC_DAYS).toBeLessThanOrEqual(45);
  });

  it('never allows a request that would trip the 90-day cap', () => {
    expect(MAX_SYNC_DAYS).toBeLessThan(90);
  });
});
