import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

const { rangeMock, authorizeWalletMock } = vi.hoisted(() => ({
  rangeMock: vi.fn(),
  authorizeWalletMock: vi.fn(),
}));

// The wallet id comes from the signed request, not from `?walletId=`.
// Ownership itself is covered in src/lib/swap/auth.test.ts.
vi.mock('@/lib/swap/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/swap/auth')>()),
  authorizeWallet: authorizeWalletMock,
}));

vi.mock('@/lib/web-wallet/rate-limit', () => ({
  checkRateLimitAsync: vi.fn().mockResolvedValue({ allowed: true, limit: 30, remaining: 29, resetAt: 0 }),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            range: rangeMock,
          })),
        })),
      })),
    })),
  })),
}));

const walletId = '123e4567-e89b-12d3-a456-426614174000';

describe('GET /api/swap/history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rangeMock.mockResolvedValue({ data: [], error: null, count: 0 });
    authorizeWalletMock.mockResolvedValue({ ok: true, walletId });
  });

  it.each(['abc', '-1', '0', '1.5', '1abc'])(
    'falls back to the default limit for %s',
    async (limit) => {
      const request = new NextRequest(
        `http://localhost/api/swap/history?limit=${limit}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(rangeMock).toHaveBeenCalledWith(0, 49);
      expect(data.pagination.limit).toBe(50);
    }
  );

  it.each(['abc', '-1', '1.5', '1abc'])(
    'falls back to zero offset for %s',
    async (offset) => {
      const request = new NextRequest(
        `http://localhost/api/swap/history?offset=${offset}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(rangeMock).toHaveBeenCalledWith(0, 49);
      expect(data.pagination.offset).toBe(0);
    }
  );

  it('clamps valid limits to 100', async () => {
    const request = new NextRequest(
      `http://localhost/api/swap/history?limit=101&offset=2`
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(rangeMock).toHaveBeenCalledWith(2, 101);
    expect(data.pagination).toMatchObject({ limit: 100, offset: 2 });
  });

  it('refuses an unauthenticated caller', async () => {
    // This endpoint used to return 200 with a full listing — including the
    // Boltz key material in provider_data — for any wallet id passed in the
    // query string.
    authorizeWalletMock.mockResolvedValue({ ok: false, status: 401, error: 'Authentication required' });

    const request = new NextRequest('http://localhost/api/swap/history');
    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(rangeMock).not.toHaveBeenCalled();
  });
});
