import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

const { rangeMock } = vi.hoisted(() => ({
  rangeMock: vi.fn(),
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
  });

  it.each(['abc', '-1', '0', '1.5', '1abc'])(
    'falls back to the default limit for %s',
    async (limit) => {
      const request = new NextRequest(
        `http://localhost/api/swap/history?walletId=${walletId}&limit=${limit}`
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
        `http://localhost/api/swap/history?walletId=${walletId}&offset=${offset}`
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
      `http://localhost/api/swap/history?walletId=${walletId}&limit=101&offset=2`
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(rangeMock).toHaveBeenCalledWith(2, 101);
    expect(data.pagination).toMatchObject({ limit: 100, offset: 2 });
  });
});
