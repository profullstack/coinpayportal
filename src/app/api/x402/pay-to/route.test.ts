import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const rows = vi.hoisted(() => ({ data: [] as unknown[], error: null as unknown }));
const eqCalls = vi.hoisted(() => [] as Array<[string, unknown]>);
const selected = vi.hoisted(() => ({ cols: '' }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      expect(table).toBe('business_wallets');
      const q: any = {
        select: (cols: string) => {
          selected.cols = cols;
          return q;
        },
        eq: (col: string, v: unknown) => {
          eqCalls.push([col, v]);
          return q;
        },
        then: (res: (v: unknown) => unknown) => res({ data: rows.data, error: rows.error }),
      };
      return q;
    },
  }),
}));

const mockResolve = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/scoped-keys', () => ({
  resolveScopedKey: mockResolve,
  scopesSatisfy: (granted: string[], required: string) =>
    granted.includes('*') || granted.includes(required),
}));

import { GET } from './route';

const BIZ = { id: 'b-1', merchant_id: 'm-1', name: 'c0mpute.com', active: true };

function req(headers: Record<string, string> = {}) {
  return new NextRequest('https://coinpayportal.com/api/x402/pay-to', { headers });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://sb';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  rows.data = [];
  rows.error = null;
  eqCalls.length = 0;
  mockResolve.mockReset();
});

describe('GET /api/x402/pay-to', () => {
  it('401 without a key', async () => {
    expect((await GET(req())).status).toBe(401);
  });

  it('401 for an unknown key', async () => {
    mockResolve.mockResolvedValue(null);
    expect((await GET(req({ 'x-api-key': 'cp_live_x' }))).status).toBe(401);
  });

  it('403 for a key without a payments scope', async () => {
    mockResolve.mockResolvedValue({ business: BIZ, scopes: ['webhooks:read'] });
    expect((await GET(req({ 'x-api-key': 'cp_live_x' }))).status).toBe(403);
  });

  it("answers the key's own business wallets, Base first, never secrets", async () => {
    mockResolve.mockResolvedValue({ business: BIZ, scopes: ['payments:create', 'payments:read'] });
    rows.data = [
      { cryptocurrency: 'USDC_ETH', wallet_address: '0xE' },
      { cryptocurrency: 'USDC_SOL', wallet_address: 'SoLaddr' },
      { cryptocurrency: 'USDC_BASE', wallet_address: '0xB' },
      { cryptocurrency: 'USDC_POL', wallet_address: '0xP' },
      { cryptocurrency: 'ETH', wallet_address: '0xNative' },
    ];
    const r = await GET(req({ authorization: 'Bearer cp_live_x' }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toEqual({
      business_id: 'b-1',
      business_name: 'c0mpute.com',
      pay_to: '0xB',
      networks: { 'eip155:8453': '0xB', 'eip155:137': '0xP', 'eip155:1': '0xE' },
    });
    expect(eqCalls).toContainEqual(['business_id', 'b-1']);
    expect(eqCalls).toContainEqual(['is_active', true]);
    expect(selected.cols).not.toMatch(/private/);
  });

  it('falls back to another EVM USDC wallet, or null', async () => {
    mockResolve.mockResolvedValue({ business: BIZ, scopes: ['*'] });
    rows.data = [{ cryptocurrency: 'USDC_POL', wallet_address: '0xP' }];
    expect((await (await GET(req({ 'x-api-key': 'k' }))).json()).pay_to).toBe('0xP');
    rows.data = [];
    expect((await (await GET(req({ 'x-api-key': 'k' }))).json()).pay_to).toBeNull();
  });
});
