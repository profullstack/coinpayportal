import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockSupabase = vi.hoisted(() => ({ from: vi.fn() }));
const mockAuthResult = vi.hoisted(() => ({
  current: { success: true, context: { type: 'merchant', merchantId: 'merch_1' } } as any,
}));
const mockAuthorizeBusiness = vi.hoisted(() => vi.fn());

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockReturnValue(mockSupabase),
}));

vi.mock('@/lib/auth/middleware', () => ({
  authenticateRequest: vi.fn().mockImplementation(() => Promise.resolve(mockAuthResult.current)),
  isMerchantAuth: vi.fn().mockImplementation((context: any) => context?.type === 'merchant'),
}));

vi.mock('@/lib/auth/authz', () => ({
  authorizeBusiness: mockAuthorizeBusiness,
}));

import { DELETE, GET, PATCH } from './route';

const params = { params: Promise.resolve({ id: 'series_1' }) };

function makeSelectResult(series: any) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: series, error: null }),
      }),
    }),
  };
}

function makeUpdateResult(data: any) {
  return {
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data, error: null }),
        }),
      }),
    }),
  };
}

function setupSeriesQueries() {
  const series = { id: 'series_1', merchant_id: 'biz_1', status: 'active' };
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'escrow_series') return makeSelectResult(series);
    if (table === 'escrows') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  return series;
}

describe('/api/escrow/series/[id] authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    mockAuthResult.current = {
      success: true,
      context: { type: 'merchant', merchantId: 'merch_1' },
    };
    mockAuthorizeBusiness.mockResolvedValue({ ok: true, role: 'owner' });
  });

  it('authorizes reads against the series business', async () => {
    const series = setupSeriesQueries();
    const request = new NextRequest('http://localhost/api/escrow/series/series_1', {
      headers: { authorization: 'Bearer test' },
    });

    const response = await GET(request, params);

    expect(response.status).toBe(200);
    expect((await response.json()).series).toEqual(series);
    expect(mockAuthorizeBusiness).toHaveBeenCalledWith(
      mockSupabase,
      'merch_1',
      'biz_1',
      'business.read',
    );
  });

  it('does not expose another business series', async () => {
    setupSeriesQueries();
    mockAuthorizeBusiness.mockResolvedValue({
      ok: false,
      status: 404,
      error: 'Business not found',
    });
    const request = new NextRequest('http://localhost/api/escrow/series/series_1', {
      headers: { authorization: 'Bearer test' },
    });

    const response = await GET(request, params);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Business not found' });
  });

  it.each([
    ['PATCH', PATCH],
    ['DELETE', DELETE],
  ])('blocks %s before mutating another business series', async (method, handler) => {
    const series = { id: 'series_1', merchant_id: 'other_business', status: 'active' };
    const table = makeSelectResult(series);
    const update = vi.fn();
    (table as any).update = update;
    mockSupabase.from.mockReturnValue(table);
    mockAuthorizeBusiness.mockResolvedValue({
      ok: false,
      status: 404,
      error: 'Business not found',
    });
    const request = new NextRequest('http://localhost/api/escrow/series/series_1', {
      method,
      headers: { authorization: 'Bearer test', 'Content-Type': 'application/json' },
      body: method === 'PATCH' ? JSON.stringify({ status: 'cancelled' }) : undefined,
    });

    const response = await handler(request, params);

    expect(response.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
    expect(mockAuthorizeBusiness).toHaveBeenCalledWith(
      mockSupabase,
      'merch_1',
      'other_business',
      'invoice.write',
    );
  });

  it('updates an authorized series', async () => {
    const series = { id: 'series_1', merchant_id: 'biz_1', status: 'active' };
    const updated = { ...series, status: 'paused' };
    let call = 0;
    mockSupabase.from.mockImplementation(() => {
      call += 1;
      return call === 1 ? makeSelectResult(series) : makeUpdateResult(updated);
    });
    const request = new NextRequest('http://localhost/api/escrow/series/series_1', {
      method: 'PATCH',
      headers: { authorization: 'Bearer test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused' }),
    });

    const response = await PATCH(request, params);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(updated);
  });
});
