/**
 * A business API key must see only its own business, never another
 * business's api_key or webhook_secret. Before this, any key (including an
 * x402 key with payments scopes) was widened to its merchant and listed every
 * business with its credentials.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const OWN = {
  id: 'b-own',
  merchant_id: 'm-1',
  name: 'c0mpute.com',
  api_key: 'fixture-api-key-not-real',
  webhook_secret: 'fixture-webhook-secret-not-real',
};

const authState = vi.hoisted(() => ({ ctx: null as any }));
vi.mock('@/lib/auth/middleware', () => ({
  authenticateRequest: vi.fn(async () => ({ success: true, context: authState.ctx })),
  isMerchantAuth: (c: any) => c?.type === 'merchant',
}));

const listAccessibleBusinesses = vi.hoisted(() => vi.fn());
const createBusiness = vi.hoisted(() => vi.fn());
vi.mock('@/lib/business/service', () => ({ listAccessibleBusinesses, createBusiness }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      expect(table).toBe('businesses');
      let id: unknown;
      const q: any = {
        select: () => q,
        eq: (_c: string, v: unknown) => {
          id = v;
          return q;
        },
        single: async () => ({ data: id === 'b-own' ? OWN : null, error: id === 'b-own' ? null : { message: 'nf' } }),
      };
      return q;
    },
  }),
}));

import { GET, POST } from './route';

const req = (method = 'GET', body?: unknown) =>
  new NextRequest('https://coinpayportal.com/api/businesses', {
    method,
    headers: { 'x-api-key': 'fixture-key', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://sb';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  listAccessibleBusinesses.mockReset();
  createBusiness.mockReset();
});

describe('GET /api/businesses with a business API key', () => {
  it('returns only its own business, without secrets', async () => {
    authState.ctx = { type: 'business', businessId: 'b-own', merchantId: 'm-1', businessName: 'c0mpute.com', scopes: ['payments:create', 'payments:read'] };
    const r = await GET(req());
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.businesses).toHaveLength(1);
    expect(body.businesses[0].id).toBe('b-own');
    expect(body.businesses[0]).not.toHaveProperty('api_key');
    expect(body.businesses[0]).not.toHaveProperty('webhook_secret');
    expect(listAccessibleBusinesses).not.toHaveBeenCalled();
  });

  it('a legacy all-scope key is also limited to its own business', async () => {
    authState.ctx = { type: 'business', businessId: 'b-own', merchantId: 'm-1', businessName: 'x', scopes: ['*'] };
    const body = await (await GET(req())).json();
    expect(body.businesses.map((b: any) => b.id)).toEqual(['b-own']);
    expect(JSON.stringify(body)).not.toContain('fixture-api-key-not-real');
  });
});

describe('POST /api/businesses with a business API key', () => {
  it('403 for a scoped key', async () => {
    authState.ctx = { type: 'business', businessId: 'b-own', merchantId: 'm-1', businessName: 'x', scopes: ['payments:create'] };
    const r = await POST(req('POST', { name: 'new' }));
    expect(r.status).toBe(403);
    expect(createBusiness).not.toHaveBeenCalled();
  });

  it('a legacy all-scope key can still create (agent onboarding)', async () => {
    authState.ctx = { type: 'business', businessId: 'b-own', merchantId: 'm-1', businessName: 'x', scopes: ['*'] };
    createBusiness.mockResolvedValue({ success: true, business: { id: 'b-new', name: 'new' } });
    const r = await POST(req('POST', { name: 'new' }));
    expect(r.status).toBe(201);
    expect(createBusiness).toHaveBeenCalledWith(expect.anything(), 'm-1', { name: 'new' });
  });
});

describe('GET /api/businesses with a merchant session', () => {
  it('still lists the merchant businesses', async () => {
    authState.ctx = { type: 'merchant', merchantId: 'm-1', via: 'session' };
    listAccessibleBusinesses.mockResolvedValue({ success: true, businesses: [{ id: 'a' }, { id: 'b' }] });
    const body = await (await GET(req())).json();
    expect(body.businesses).toHaveLength(2);
  });
});
