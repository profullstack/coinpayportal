import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/auth/admin-guard', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/stats/admin-escrow-stats', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stats/admin-escrow-stats')>(
    '@/lib/stats/admin-escrow-stats',
  );
  return {
    ...actual,
    getAdminEscrowStats: vi.fn(),
    getAdminEscrowSummary: vi.fn(),
  };
});

import { GET } from './route';
import { requireAdmin } from '@/lib/auth/admin-guard';
import { getAdminEscrowStats, getAdminEscrowSummary } from '@/lib/stats/admin-escrow-stats';

const admin = { id: 'admin-1', email: 'admin@example.com', is_admin: true as const };

const emptyPage = { rows: [], total: 0, limit: 50, offset: 0 };

function req(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/admin/escrows${query}`);
}

describe('GET /api/admin/escrows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue(admin);
    vi.mocked(getAdminEscrowStats).mockResolvedValue(emptyPage);
    vi.mocked(getAdminEscrowSummary).mockResolvedValue({ escrowsTotal: 7 } as never);
  });

  describe('authorization', () => {
    it('propagates the guard response for a non-admin and never reads any stats', async () => {
      vi.mocked(requireAdmin).mockResolvedValue(
        NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
      );

      const res = await GET(req());

      expect(res.status).toBe(403);
      expect(getAdminEscrowStats).not.toHaveBeenCalled();
      expect(getAdminEscrowSummary).not.toHaveBeenCalled();
    });

    it('propagates a 401 for an unauthenticated caller', async () => {
      vi.mocked(requireAdmin).mockResolvedValue(
        NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
      );

      const res = await GET(req());

      expect(res.status).toBe(401);
      expect(getAdminEscrowStats).not.toHaveBeenCalled();
    });
  });

  describe('query parameters', () => {
    it('defaults to newest first, no filters, first page', async () => {
      await GET(req());

      expect(getAdminEscrowStats).toHaveBeenCalledWith({
        search: null,
        status: null,
        chain: null,
        model: null,
        sort: 'created_at',
        direction: 'desc',
        limit: 50,
        offset: 0,
      });
    });

    it('passes through the filters, a recognised sort key and the direction', async () => {
      await GET(req('?sort=amount_usd&dir=asc&search=abc&status=settled&chain=SOL&model=custodial&limit=10&offset=20'));

      expect(getAdminEscrowStats).toHaveBeenCalledWith({
        search: 'abc',
        status: 'settled',
        chain: 'SOL',
        model: 'custodial',
        sort: 'amount_usd',
        direction: 'asc',
        limit: 10,
        offset: 20,
      });
    });

    it('falls back to the default sort when the key is not recognised', async () => {
      await GET(req('?sort=release_token&dir=sideways'));

      expect(getAdminEscrowStats).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'created_at', direction: 'desc' }),
      );
    });

    it('clamps an oversized limit and a negative offset', async () => {
      await GET(req('?limit=100000&offset=-5'));

      expect(getAdminEscrowStats).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 500, offset: 0 }),
      );
    });

    it('uses defaults when limit and offset are not numbers', async () => {
      await GET(req('?limit=abc&offset=xyz'));

      expect(getAdminEscrowStats).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50, offset: 0 }),
      );
    });
  });

  describe('summary', () => {
    it('includes all-time totals by default', async () => {
      const res = await GET(req());
      const body = await res.json();

      expect(getAdminEscrowSummary).toHaveBeenCalled();
      expect(body.summary).toEqual({ escrowsTotal: 7 });
    });

    it('skips the totals when summary=0', async () => {
      const res = await GET(req('?summary=0'));
      const body = await res.json();

      expect(getAdminEscrowSummary).not.toHaveBeenCalled();
      expect(body.summary).toBeNull();
    });
  });

  it('never caches — the response is custody data for every escrow', async () => {
    const res = await GET(req());

    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns 500 rather than an empty page when the query fails', async () => {
    // A silent empty page would read as "no escrows exist", which for a
    // custodial service is the opposite of the truth an admin is checking.
    vi.mocked(getAdminEscrowStats).mockRejectedValue(new Error('boom'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.escrows).toBeUndefined();
    spy.mockRestore();
  });
});
