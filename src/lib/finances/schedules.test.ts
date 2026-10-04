import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => ({}) }));

import { nextRunAt, localWeekday } from './schedules';
import { normalizeRecipients } from './emailing';

const LA = 'America/Los_Angeles';

describe('nextRunAt', () => {
  it('picks the next Monday or Friday at the local hour', () => {
    // Saturday 2026-09-12 10:00 PDT
    const now = new Date('2026-09-12T17:00:00Z');
    const next = nextRunAt([1, 5], 8, LA, now);
    // Monday 2026-09-14 08:00 PDT = 15:00 UTC
    expect(next.toISOString()).toBe('2026-09-14T15:00:00.000Z');
    expect(localWeekday(next, LA)).toBe(1);
  });

  it('skips today when the hour has passed, and keeps today when it has not', () => {
    // Friday 2026-09-11 09:00 PDT: 08:00 already passed → next is Monday.
    expect(nextRunAt([1, 5], 8, LA, new Date('2026-09-11T16:00:00Z')).toISOString()).toBe('2026-09-14T15:00:00.000Z');
    // Friday 2026-09-11 07:00 PDT: 08:00 still ahead → today.
    expect(nextRunAt([1, 5], 8, LA, new Date('2026-09-11T14:00:00Z')).toISOString()).toBe('2026-09-11T15:00:00.000Z');
  });

  it('respects DST when crossing the change', () => {
    // Saturday 2026-10-31 → Monday 2026-11-02 08:00 PST (DST ended Nov 1) = 16:00 UTC
    expect(nextRunAt([1], 8, LA, new Date('2026-10-31T20:00:00Z')).toISOString()).toBe('2026-11-02T16:00:00.000Z');
  });

  it('rejects an empty weekday list', () => {
    expect(() => nextRunAt([], 8, LA)).toThrow(/weekday/);
  });
});

describe('normalizeRecipients', () => {
  it('accepts a list or a comma string, lower-cases and de-duplicates', () => {
    expect(normalizeRecipients('CPA@Example.com, me@example.com; cpa@example.com')).toEqual(['cpa@example.com', 'me@example.com']);
    expect(normalizeRecipients(['a@b.co'])).toEqual(['a@b.co']);
  });

  it('rejects nothing, junk, and too many', () => {
    expect(() => normalizeRecipients('')).toThrow(/at least one/i);
    expect(() => normalizeRecipients('not-an-email')).toThrow(/not a valid/i);
    expect(() => normalizeRecipients(['1@x.co', '2@x.co', '3@x.co', '4@x.co', '5@x.co', '6@x.co'])).toThrow(/at most/i);
  });
});
