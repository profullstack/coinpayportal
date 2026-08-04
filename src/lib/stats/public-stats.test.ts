/**
 * The landing page's numbers must either be real or absent.
 *
 * These pin the fail-closed contract: any failure path returns null so the page
 * drops the section, rather than substituting a constant. Falling back to a
 * plausible-looking number is the exact failure this module replaced.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseAdmin: () => ({ rpc: mockRpc }),
}));

import { getPublicStats, formatCount, formatUsd } from './public-stats';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('getPublicStats', () => {
  it('maps the counters the database returns', async () => {
    mockRpc.mockResolvedValue({
      data: { payments_settled: 544, settled_volume_usd: 11360.15, active_businesses: 103 },
      error: null,
    });

    await expect(getPublicStats()).resolves.toEqual({
      paymentsSettled: 544,
      activeBusinesses: 103,
      settledVolumeUsd: 11360.15,
    });
  });

  it('accepts numerics arriving as strings', async () => {
    // Postgres numeric comes back as a string through PostgREST.
    mockRpc.mockResolvedValue({
      data: { payments_settled: '544', settled_volume_usd: '11360.15', active_businesses: '103' },
      error: null,
    });

    const stats = await getPublicStats();

    expect(stats?.settledVolumeUsd).toBe(11360.15);
    expect(stats?.paymentsSettled).toBe(544);
  });

  it('returns null when the query errors, so the page omits the section', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(getPublicStats()).resolves.toBeNull();
  });

  it('returns null rather than throwing when the client blows up', async () => {
    mockRpc.mockRejectedValue(new Error('connection refused'));
    await expect(getPublicStats()).resolves.toBeNull();
  });

  it('never substitutes a fallback number', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const stats = await getPublicStats();

    // The failure mode being guarded against is a plausible-looking constant.
    expect(stats).toBeNull();
    expect(stats).not.toMatchObject({ paymentsSettled: expect.any(Number) });
  });

  it('treats missing fields as zero rather than NaN', async () => {
    mockRpc.mockResolvedValue({ data: {}, error: null });

    await expect(getPublicStats()).resolves.toEqual({
      paymentsSettled: 0,
      activeBusinesses: 0,
      settledVolumeUsd: 0,
    });
  });
});

describe('formatters', () => {
  it('groups thousands', () => {
    expect(formatCount(544)).toBe('544');
    expect(formatCount(1743)).toBe('1,743');
    expect(formatCount(0)).toBe('0');
  });

  it('renders whole dollars without inflating the figure', () => {
    expect(formatUsd(11360.15)).toBe('$11,360');
    expect(formatUsd(0)).toBe('$0');
    // No rounding up to a friendlier magnitude — no "$8.2M+" from $11k.
    expect(formatUsd(11360.15)).not.toContain('M');
    expect(formatUsd(11360.15)).not.toContain('+');
  });
});
