/**
 * A business API key belongs to ONE business. These pin the refusals added
 * after an audit found keys acting as the whole merchant account:
 *  - getAuthUser (passkeys, OAuth apps) refuses keys unless a route opts in
 *  - keyMayActOnAccount: no merchant-wide wallet / payee writes by key
 *  - vaultMerchant: key needs payouts:create, and never creates the vault
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const lookups = vi.hoisted(() => ({ n: 0 }));
vi.mock('@/lib/auth/apikey', () => ({
  isApiKey: (t: string) => t.startsWith('cp_live_') || t.startsWith('cp_test_'),
  getBusinessByApiKey: vi.fn(async () => {
    lookups.n++;
    return { success: true, business: { id: 'b-1', merchant_id: 'm-1' } };
  }),
}));
vi.mock('@/lib/auth/jwt', () => ({
  verifyToken: (t: string) => {
    if (t === 'session-jwt') return { userId: 'm-1' };
    throw new Error('bad');
  },
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));

const authState = vi.hoisted(() => ({ ctx: null as any }));
vi.mock('../auth/middleware', () => ({
  authenticateRequest: vi.fn(async () => ({ success: true, context: authState.ctx })),
}));
vi.mock('../supabase/server', () => ({ getSupabaseAdmin: () => ({}) }));
vi.mock('../auth/oauth-funds', () => ({ isOAuthCaller: (c: any) => c?.via === 'oauth' }));

import { getAuthUser } from '@/lib/oauth/auth';
import { keyMayActOnAccount, keyMayActOnBusiness } from '@/lib/auth/merchant';
import { vaultMerchant } from '@/lib/vault/route-auth';

const req = (h: Record<string, string>) => new NextRequest('https://coinpayportal.com/api/x', { headers: h });

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://sb';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  process.env.JWT_SECRET = 's';
  lookups.n = 0;
});

describe('getAuthUser', () => {
  it('refuses a business key by default (x-api-key and Bearer)', async () => {
    expect(await getAuthUser(req({ 'x-api-key': 'cp_live_abc' }))).toBeNull();
    expect(await getAuthUser(req({ authorization: 'Bearer cp_live_abc' }))).toBeNull();
    expect(lookups.n).toBe(0);
  });

  it('accepts a key only when the route opts in', async () => {
    expect(await getAuthUser(req({ 'x-api-key': 'cp_live_abc' }), { allowApiKey: true })).toEqual({ id: 'm-1' });
  });

  it('still accepts the dashboard session', async () => {
    expect(await getAuthUser(req({ authorization: 'Bearer session-jwt' }))).toEqual({ id: 'm-1' });
  });
});

describe('keyMayActOnAccount', () => {
  it('is false for any business key, true for a session', () => {
    expect(keyMayActOnAccount({ apiKeyBusinessId: 'b-1' })).toBe(false);
    expect(keyMayActOnAccount({ apiKeyBusinessId: null })).toBe(true);
    // the gap it closes: a null business passed keyMayActOnBusiness
    expect(keyMayActOnBusiness({ apiKeyBusinessId: 'b-1' }, null)).toBe(true);
  });
});

describe('vaultMerchant', () => {
  const key = (scopes: string[]) => ({ type: 'business', businessId: 'b-1', merchantId: 'm-1', businessName: 'x', scopes });

  it('never lets a key create or rewrap the vault (default policy)', async () => {
    authState.ctx = key(['*']);
    const r = await vaultMerchant(req({ authorization: 'Bearer cp_live_x' }));
    expect(r).toBeInstanceOf(Response);
    expect((r as Response).status).toBe(403);
  });

  it('lets a payouts key read/unlock, not a payments-only key', async () => {
    authState.ctx = key(['payouts:create']);
    expect(await vaultMerchant(req({}), { apiKey: 'payouts' })).toEqual({ merchantId: 'm-1' });
    authState.ctx = key(['payments:read', 'payments:create']);
    const r = await vaultMerchant(req({}), { apiKey: 'payouts' });
    expect((r as Response).status).toBe(403);
  });

  it('a session may do everything', async () => {
    authState.ctx = { type: 'merchant', merchantId: 'm-1', via: 'session' };
    expect(await vaultMerchant(req({}))).toEqual({ merchantId: 'm-1' });
  });
});
