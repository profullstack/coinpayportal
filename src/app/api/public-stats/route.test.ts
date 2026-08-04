import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetPublicStats = vi.fn();

vi.mock('@/lib/stats/public-stats', () => ({
  getPublicStats: () => mockGetPublicStats(),
}));

import { GET } from './route';

const STATS = { paymentsSettled: 544, activeBusinesses: 103, settledVolumeUsd: 11360.15 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/public-stats', () => {
  it('returns the counters', async () => {
    mockGetPublicStats.mockResolvedValue(STATS);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, stats: STATS });
  });

  it('lets the edge hold the answer briefly rather than hitting the database per visitor', async () => {
    mockGetPublicStats.mockResolvedValue(STATS);

    const res = await GET();

    expect(res.headers.get('Cache-Control')).toContain('s-maxage=300');
  });

  it('503s when the counters are unavailable, without inventing them', async () => {
    mockGetPublicStats.mockResolvedValue(null);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.success).toBe(false);
    // No zeros, no last-known values, no placeholder shape at all.
    expect(body).not.toHaveProperty('stats');
  });

  it('does not let a cache memoise an absence as data', async () => {
    mockGetPublicStats.mockResolvedValue(null);

    const res = await GET();

    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
