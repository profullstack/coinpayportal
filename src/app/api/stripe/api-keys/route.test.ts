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
