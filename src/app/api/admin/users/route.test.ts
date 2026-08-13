import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/auth/admin-guard', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/stats/admin-user-stats', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stats/admin-user-stats')>(
    '@/lib/stats/admin-user-stats',
  );
  return {
    ...actual,
    getAdminUserStats: vi.fn(),
    getAdminPlatformStats: vi.fn(),
  };
});

import { GET } from './route';
import { requireAdmin } from '@/lib/auth/admin-guard';
import { getAdminUserStats, getAdminPlatformStats } from '@/lib/stats/admin-user-stats';

const admin = { id: 'admin-1', email: 'admin@example.com', is_admin: true as const };

const emptyPage = { rows: [], total: 0, limit: 50, offset: 0 };

function req(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/admin/users${query}`);
}

describe('GET /api/admin/users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue(admin);
    vi.mocked(getAdminUserStats).mockResolvedValue(emptyPage);
    vi.mocked(getAdminPlatformStats).mockResolvedValue({ usersTotal: 3 } as never);
  });

  describe('authorization', () => {
    it('propagates the guard response for a non-admin and never reads any stats', async () => {
      vi.mocked(requireAdmin).mockResolvedValue(
        NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
      );

      const res = await GET(req());

      expect(res.status).toBe(403);
      expect(getAdminUserStats).not.toHaveBeenCalled();
      expect(getAdminPlatformStats).not.toHaveBeenCalled();
    });

    it('propagates a 401 for an unauthenticated caller', async () => {
      vi.mocked(requireAdmin).mockResolvedValue(
        NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
      );

      const res = await GET(req());

      expect(res.status).toBe(401);
      expect(getAdminUserStats).not.toHaveBeenCalled();
    });
  });

  describe('query parameters', () => {
    it('defaults to last activity, descending, first page', async () => {
      await GET(req());

      expect(getAdminUserStats).toHaveBeenCalledWith({
        search: null,
        sort: 'last_activity_at',
        direction: 'desc',
        limit: 50,
        offset: 0,
      });
    });

    it('passes through a recognised sort key and direction', async () => {
      await GET(req('?sort=total_volume_usd&dir=asc&search=acme&limit=10&offset=20'));

      expect(getAdminUserStats).toHaveBeenCalledWith({
        search: 'acme',
        sort: 'total_volume_usd',
        direction: 'asc',
        limit: 10,
        offset: 20,
      });
    });

    it('falls back to the default sort when the key is not recognised', async () => {
      await GET(req('?sort=password_hash&dir=sideways'));

      expect(getAdminUserStats).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'last_activity_at', direction: 'desc' }),
      );
    });

    it('clamps an oversized limit and a negative offset', async () => {
      await GET(req('?limit=100000&offset=-5'));

      expect(getAdminUserStats).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 500, offset: 0 }),
      );
    });

    it('uses defaults when limit and offset are not numbers', async () => {
      await GET(req('?limit=abc&offset=xyz'));

      expect(getAdminUserStats).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50, offset: 0 }),
      );
    });
  });

  describe('summary', () => {
    it('includes platform totals by default', async () => {
      const res = await GET(req());
      const body = await res.json();

      expect(getAdminPlatformStats).toHaveBeenCalled();
      expect(body.summary).toEqual({ usersTotal: 3 });
    });

    it('skips the platform totals when summary=0', async () => {
      const res = await GET(req('?summary=0'));
      const body = await res.json();

      expect(getAdminPlatformStats).not.toHaveBeenCalled();
      expect(body.summary).toBeNull();
    });
  });

  it('never caches — the response is every user on the platform', async () => {
    const res = await GET(req());

    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns 500 rather than an empty page when the query fails', async () => {
    vi.mocked(getAdminUserStats).mockRejectedValue(new Error('boom'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.users).toBeUndefined();
    spy.mockRestore();
  });
});
