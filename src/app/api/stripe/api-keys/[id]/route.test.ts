import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVerifyToken = vi.fn();
const mockGetJwtSecret = vi.fn();
const mockDelete = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) });

vi.mock('@/lib/auth/jwt', () => ({ verifyToken: (...args: unknown[]) => mockVerifyToken(...args) }));
vi.mock('@/lib/secrets', () => ({ getJwtSecret: () => mockGetJwtSecret() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'stripe_accounts') {
        return {
          select: () => ({
            eq: () => ({
              single: () => ({ data: { stripe_account_id: 'acct_test' } }),
            }),
          }),
        };
      }
      return { delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }) };
    },
  }),
}));


// Tenant scoping is now a shared helper (src/lib/auth/tenant-scope.ts). These
// routes used to take the caller-supplied business_id at face value; the helper
// authorizes it against the authenticated user. Stubbed here so each test states
// whether the caller is allowed, rather than reproducing the roles tables.
const mockResolveBusinessScope = vi.fn();
vi.mock('@/lib/auth/tenant-scope', () => ({
  resolveBusinessScope: (...args: unknown[]) => mockResolveBusinessScope(...args),
}));

import { DELETE } from './route';
import { NextRequest } from 'next/server';

function makeRequest(url: string, opts: any = {}) {
  return new NextRequest(new URL(url, 'http://localhost'), {
    headers: { authorization: 'Bearer test-token', ...opts.headers },
    method: 'DELETE',
    ...opts,
  });
}

describe('DELETE /api/stripe/api-keys/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveBusinessScope.mockResolvedValue({ ok: true, businessId: 'biz-1' });
    mockGetJwtSecret.mockReturnValue('secret');
    mockVerifyToken.mockReturnValue({ userId: 'user-1' });
  });

  it('deletes an API key', async () => {
    const req = makeRequest('http://localhost/api/stripe/api-keys/rk_123?business_id=biz-1');
    const res = await DELETE(req, { params: Promise.resolve({ id: 'rk_123' }) });
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const req = new NextRequest(new URL('http://localhost/api/stripe/api-keys/rk_123'), { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'rk_123' }) });
    expect(res.status).toBe(401);
  });
});
