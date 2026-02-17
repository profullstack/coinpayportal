import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSupabase = vi.hoisted(() => {
  const mock = {
    from: vi.fn(),
  };
  return mock;
});

const mockAuthResult = vi.hoisted(() => ({
  current: { success: true, context: { type: 'merchant', merchantId: 'merch_1' } } as any,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockReturnValue(mockSupabase),
}));

vi.mock('@/lib/auth/middleware', () => ({
  authenticateRequest: vi.fn().mockImplementation(() => Promise.resolve(mockAuthResult.current)),
  isMerchantAuth: vi.fn().mockImplementation((ctx: any) => ctx?.type === 'merchant'),
}));

// Mock createEscrow + isBusinessPaidTier (used in POST)
vi.mock('@/lib/escrow', () => ({
  createEscrow: vi.fn().mockResolvedValue({ success: true, escrow: { id: 'esc_1' } }),
}));

vi.mock('@/lib/entitlements/service', () => ({
  isBusinessPaidTier: vi.fn().mockResolvedValue(false),
}));

import { POST, GET } from './route';

function setupInsert(data: any = { id: 'series_1' }, error: any = null) {
  mockSupabase.from.mockReturnValue({
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data, error }),
      }),
    }),
  });
}

function setupSelectChained(data: any[] = [], error: any = null) {
  // The GET route chains: .select().order() then conditionally .eq() or .in()
  // Each method must return the query object; the final call resolves as a thenable
  const makeQuery = (resolveData: any[], resolveError: any) => {
    const q: any = {};
    q.select = vi.fn().mockReturnValue(q);
    q.eq = vi.fn().mockReturnValue(q);
    q.in = vi.fn().mockReturnValue(q);
    q.order = vi.fn().mockReturnValue(q);
    // Make it thenable so await works on the final chained call
    q.then = (resolve: any, reject?: any) => {
      return Promise.resolve({ data: resolveData, error: resolveError }).then(resolve, reject);
    };
    return q;
  };
  mockSupabase.from.mockReturnValue(makeQuery(data, error));
}

describe('POST /api/escrow/series', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    mockAuthResult.current = { success: true, context: { type: 'merchant', merchantId: 'merch_1' } };
    setupInsert();
  });

  const validBody = {
    business_id: 'biz_1',
    payment_method: 'crypto',
    amount: 100,
    interval: 'monthly',
    coin: 'BTC',
  };

  const makeReq = (body: any) =>
    new NextRequest('http://localhost:3000/api/escrow/series', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: 'Bearer test' },
      body: JSON.stringify(body),
    });

  it('returns 400 for missing required fields', async () => {
    const res = await POST(makeReq({ amount: 100 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Required/);
  });

  it('returns 400 for non-crypto payment_method', async () => {
    const res = await POST(makeReq({ ...validBody, payment_method: 'paypal' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/crypto/i);
  });

  it('returns 400 for invalid interval', async () => {
    const res = await POST(makeReq({ ...validBody, interval: 'daily' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/interval/);
  });

  it('returns 400 for crypto without coin', async () => {
    const res = await POST(makeReq({ ...validBody, coin: undefined }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/coin/);
  });

  it('returns 400 for card payment method (not supported)', async () => {
    const res = await POST(makeReq({ ...validBody, payment_method: 'card', coin: undefined }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/crypto/i);
  });

  it('returns 401 when unauthorized', async () => {
    mockAuthResult.current = { success: false, context: null };
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(401);
  });

  it('returns 201 with series data on success', async () => {
    const seriesData = { id: 'series_1', amount: 100, coin: 'BTC', interval: 'monthly', status: 'active' };
    setupInsert(seriesData);
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.series).toEqual(seriesData);
    expect(json).toHaveProperty('escrow');
  });
});

describe('GET /api/escrow/series', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    mockAuthResult.current = { success: true, context: { type: 'merchant', merchantId: 'merch_1' } };
  });

  it('returns series scoped to merchant businesses when no business_id', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'businesses') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [{ id: 'biz_1' }], error: null }),
          }),
        };
      }
      // escrow_series — needs thenable query object
      const q: any = {};
      q.select = vi.fn().mockReturnValue(q);
      q.eq = vi.fn().mockReturnValue(q);
      q.in = vi.fn().mockReturnValue(q);
      q.order = vi.fn().mockReturnValue(q);
      q.then = (resolve: any, reject?: any) => {
        return Promise.resolve({ data: [{ id: 's1' }], error: null }).then(resolve, reject);
      };
      return q;
    });

    const req = new NextRequest('http://localhost:3000/api/escrow/series', {
      headers: { authorization: 'Bearer test' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.series).toEqual([{ id: 's1' }]);
  });

  it('returns series list filtered by business_id', async () => {
    const seriesList = [{ id: 's1' }, { id: 's2' }];
    setupSelectChained(seriesList);
    const req = new NextRequest('http://localhost:3000/api/escrow/series?business_id=biz_1', {
      headers: { authorization: 'Bearer test' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ series: seriesList });
  });
});
