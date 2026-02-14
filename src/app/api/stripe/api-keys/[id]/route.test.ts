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
