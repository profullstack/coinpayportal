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

function setupSelect(data: any[] = [], error: any = null) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error }),
  };
  mockSupabase.from.mockReturnValue(query);
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

  it('returns 400 for invalid payment_method', async () => {
    const res = await POST(makeReq({ ...validBody, payment_method: 'paypal' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/payment_method/);
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

  it('returns 400 for card without stripe_account_id', async () => {
    const res = await POST(makeReq({ ...validBody, payment_method: 'card', coin: undefined }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/stripe_account_id/);
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

  it('returns 400 without business_id', async () => {
    const req = new NextRequest('http://localhost:3000/api/escrow/series', {
      headers: { authorization: 'Bearer test' },
    });
    const res = await GET(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/business_id/);
  });

  it('returns series list on success', async () => {
    const seriesList = [{ id: 's1' }, { id: 's2' }];
    setupSelect(seriesList);
    const req = new NextRequest('http://localhost:3000/api/escrow/series?business_id=biz_1', {
      headers: { authorization: 'Bearer test' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ series: seriesList });
  });
});
