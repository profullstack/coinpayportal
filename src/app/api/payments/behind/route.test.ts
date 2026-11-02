import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockFrom = vi.fn();
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ from: mockFrom })) }));
vi.mock('@/lib/auth/merchant', () => ({ resolveMerchant: vi.fn() }));
vi.mock('@/lib/auth/authz', () => ({ listAccessibleBusinessIds: vi.fn() }));

import { GET } from './route';
import { resolveMerchant } from '@/lib/auth/merchant';
import { listAccessibleBusinessIds } from '@/lib/auth/authz';

function chain(result: { data: unknown; error: unknown }) {
  const c: any = {};
  for (const m of ['select', 'in', 'eq', 'order', 'limit']) c[m] = vi.fn().mockReturnValue(c);
  c.then = (resolve: any) => Promise.resolve(result).then(resolve);
  return c;
}

const req = (qs = '') => new NextRequest(`http://localhost/api/payments/behind${qs}`, { headers: { authorization: 'Bearer t' } });

describe('GET /api/payments/behind', () => {
  let cards: any;
  let invoices: any;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    (resolveMerchant as any).mockResolvedValue({ merchantId: 'm-1', apiKeyBusinessId: null });
    (listAccessibleBusinessIds as any).mockResolvedValue(['biz-1', 'biz-2']);
    cards = chain({
      data: [
        {
          id: 'c1', business_id: 'biz-1', amount: 39000, currency: 'gbp', status: 'failed',
          customer_email: 'ops@n.example', customer_name: 'Northgate', failure_code: 'insufficient_funds',
          created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), businesses: { name: 'Acme' },
        },
      ],
      error: null,
    });
    invoices = chain({ data: [], error: null });
    mockFrom.mockImplementation((t: string) => (t === 'stripe_transactions' ? cards : invoices));
  });

  it('rejects an unauthenticated caller', async () => {
    (resolveMerchant as any).mockResolvedValue({ error: 'Missing authorization header', status: 401 });
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('scopes both queries to every accessible business and returns the report', async () => {
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(cards.in).toHaveBeenCalledWith('business_id', ['biz-1', 'biz-2']);
    expect(invoices.in).toHaveBeenCalledWith('business_id', ['biz-1', 'biz-2']);
    expect(body.success).toBe(true);
    expect(body.groups[0].action).toBe('retry');
    expect(body.groups[0].customers[0].name).toBe('Northgate');
    expect(body.summary).toContain('£390.00');
  });

  it('refuses a business the caller cannot access', async () => {
    const res = await GET(req('?business_id=biz-9'));
    expect(res.status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('pins an API key to its own business', async () => {
    (resolveMerchant as any).mockResolvedValue({ merchantId: 'm-1', apiKeyBusinessId: 'biz-2' });
    expect((await GET(req('?business_id=biz-1'))).status).toBe(403);
    await GET(req());
    expect(cards.in).toHaveBeenCalledWith('business_id', ['biz-2']);
    expect(listAccessibleBusinessIds).not.toHaveBeenCalled();
  });

  it('returns an empty report, not an error, when the caller has no businesses', async () => {
    (listAccessibleBusinessIds as any).mockResolvedValue([]);
    const body = await (await GET(req())).json();
    expect(body.success).toBe(true);
    expect(body.counts.customers).toBe(0);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('does not leak the database error text', async () => {
    invoices = chain({ data: null, error: { message: 'relation "invoices" secret detail' } });
    mockFrom.mockImplementation((t: string) => (t === 'stripe_transactions' ? cards : invoices));
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to load payments');
  });
});
