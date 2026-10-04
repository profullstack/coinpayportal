import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVerifyToken = vi.fn();
const mockGetJwtSecret = vi.fn();
const mockInsert = vi.fn().mockResolvedValue({ error: null });

vi.mock('@/lib/auth/jwt', () => ({ verifyToken: (...args: unknown[]) => mockVerifyToken(...args) }));
vi.mock('@/lib/secrets', () => ({ getJwtSecret: () => mockGetJwtSecret() }));
vi.mock('stripe', () => ({
  default: vi.fn(() => ({
    apps: { secrets: { create: vi.fn().mockRejectedValue(new Error('not available')) } },
  })),
}));
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
      return {
        select: () => ({
          eq: () => ({
            order: () => ({ data: [{ id: 'k1', name: 'Test', stripe_key_id: 'rk_1', created_at: '2025-01-01', livemode: true }] }),
          }),
        }),
        insert: mockInsert,
      };
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

import { GET, POST } from './route';
import { NextRequest } from 'next/server';

function makeRequest(url: string, opts: any = {}) {
  return new NextRequest(new URL(url, 'http://localhost'), {
    headers: { authorization: 'Bearer test-token', ...opts.headers },
    ...opts,
  });
}

describe('GET /api/stripe/api-keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveBusinessScope.mockResolvedValue({ ok: true, businessId: 'biz-1' });
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    mockGetJwtSecret.mockReturnValue('secret');
    mockVerifyToken.mockReturnValue({ userId: 'user-1' });
  });

  it('returns keys and account_id', async () => {
    const res = await GET(makeRequest('http://localhost/api/stripe/api-keys?business_id=biz-1'));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.account_id).toBe('acct_test');
    expect(json.keys).toHaveLength(1);
  });
});

describe('POST /api/stripe/api-keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveBusinessScope.mockResolvedValue({ ok: true, businessId: 'biz-1' });
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    mockGetJwtSecret.mockReturnValue('secret');
    mockVerifyToken.mockReturnValue({ userId: 'user-1' });
  });

  it('creates a key', async () => {
    const req = makeRequest('http://localhost/api/stripe/api-keys', {
      method: 'POST',
      body: JSON.stringify({ business_id: 'biz-1', name: 'My Key', permissions: ['charges'] }),
    });
    const res = await POST(req);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.secret).toBeTruthy();
  });

  it('rejects missing name', async () => {
    const req = makeRequest('http://localhost/api/stripe/api-keys', {
      method: 'POST',
      body: JSON.stringify({ business_id: 'biz-1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe('/api/stripe/api-keys - tenant scoping (B-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    mockGetJwtSecret.mockReturnValue('secret');
    mockVerifyToken.mockReturnValue({ userId: 'user-1' });
  });

  it('refuses to list keys for a business the caller cannot manage', async () => {
    // getStripeAccountId(businessId || authResult) put the query-string value
    // ahead of the authenticated user, so a supplied business_id read another
    // merchant's Stripe restricted keys.
    mockResolveBusinessScope.mockResolvedValue({ ok: false, error: 'Insufficient permissions', status: 403 });
    const res = await GET(makeRequest('http://localhost/api/stripe/api-keys?business_id=someone-else'));
    expect(res.status).toBe(403);
  });

  it('refuses to mint a key for a business the caller cannot manage', async () => {
    mockResolveBusinessScope.mockResolvedValue({ ok: false, error: 'Business not found', status: 404 });
    const res = await POST(
      makeRequest('http://localhost/api/stripe/api-keys', {
        method: 'POST',
        body: JSON.stringify({ business_id: 'someone-else', name: 'stolen' }),
      })
    );
    expect(res.status).toBe(404);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('authorizes against the authenticated user, not the supplied id', async () => {
    await GET(makeRequest('http://localhost/api/stripe/api-keys?business_id=biz-1'));
    expect(mockResolveBusinessScope).toHaveBeenCalledWith(
      expect.anything(), 'user-1', 'biz-1', 'apikey.manage'
    );
  });
});
