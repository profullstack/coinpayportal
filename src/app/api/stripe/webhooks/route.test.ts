import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVerifyToken = vi.fn();
const mockGetJwtSecret = vi.fn();
const mockStripe = {
  webhookEndpoints: {
    list: vi.fn(),
    create: vi.fn(),
  },
};

vi.mock('@/lib/auth/jwt', () => ({ verifyToken: (...args: unknown[]) => mockVerifyToken(...args) }));
vi.mock('@/lib/secrets', () => ({ getJwtSecret: () => mockGetJwtSecret() }));
vi.mock('stripe', () => ({ default: vi.fn(() => mockStripe) }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => ({ data: { stripe_account_id: 'acct_test' } }),
        }),
      }),
    }),
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

describe('GET /api/stripe/webhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetJwtSecret.mockReturnValue('secret');
    mockVerifyToken.mockReturnValue({ userId: 'user-1' });
  });

  it('returns endpoints', async () => {
    mockStripe.webhookEndpoints.list.mockResolvedValue({
      data: [{ id: 'we_1', url: 'https://example.com', status: 'enabled', enabled_events: ['charge.succeeded'], created: 1700000000 }],
    });
    const res = await GET(makeRequest('http://localhost/api/stripe/webhooks?business_id=biz-1'));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.endpoints).toHaveLength(1);
    expect(json.endpoints[0].url).toBe('https://example.com');
  });

  it('returns 401 without auth', async () => {
    const req = new NextRequest(new URL('http://localhost/api/stripe/webhooks'));
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/stripe/webhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetJwtSecret.mockReturnValue('secret');
    mockVerifyToken.mockReturnValue({ userId: 'user-1' });
  });

  it('creates endpoint', async () => {
    mockStripe.webhookEndpoints.create.mockResolvedValue({
      id: 'we_new', url: 'https://example.com/hook', status: 'enabled', enabled_events: ['charge.succeeded'], created: 1700000000,
    });
    const req = makeRequest('http://localhost/api/stripe/webhooks', {
      method: 'POST',
      body: JSON.stringify({ business_id: 'biz-1', url: 'https://example.com/hook', events: ['charge.succeeded'] }),
    });
    const res = await POST(req);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.endpoint.id).toBe('we_new');
  });

  it('rejects missing fields', async () => {
    const req = makeRequest('http://localhost/api/stripe/webhooks', {
      method: 'POST',
      body: JSON.stringify({ business_id: 'biz-1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
