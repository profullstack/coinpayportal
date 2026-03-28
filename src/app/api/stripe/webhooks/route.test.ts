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
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    mockGetJwtSecret.mockReturnValue('secret');
    mockVerifyToken.mockReturnValue({ userId: 'user-1' });
  });

  it('returns platform endpoints with scope', async () => {
    mockStripe.webhookEndpoints.list
      // Platform list
      .mockResolvedValueOnce({
        data: [{
          id: 'we_1', url: 'https://example.com', status: 'enabled',
          enabled_events: ['charge.succeeded'], created: 1700000000,
          metadata: { business_id: 'acct_test', scope: 'platform' },
        }],
      })
      // Account list
      .mockResolvedValueOnce({ data: [] });

    const res = await GET(makeRequest('http://localhost/api/stripe/webhooks?business_id=biz-1'));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.endpoints).toHaveLength(1);
    expect(json.endpoints[0].url).toBe('https://example.com');
    expect(json.endpoints[0].scope).toBe('platform');
  });

  it('returns endpoints from both platform and connected account', async () => {
    mockStripe.webhookEndpoints.list
      .mockResolvedValueOnce({
        data: [{
          id: 'we_plat', url: 'https://example.com/platform', status: 'enabled',
          enabled_events: ['charge.succeeded'], created: 1700000000,
          metadata: { business_id: 'acct_test', scope: 'platform' },
        }],
      })
      .mockResolvedValueOnce({
        data: [{
          id: 'we_acct', url: 'https://example.com/account', status: 'enabled',
          enabled_events: ['payment_intent.succeeded'], created: 1700000001,
          metadata: { scope: 'account' },
        }],
      });

    const res = await GET(makeRequest('http://localhost/api/stripe/webhooks?business_id=biz-1'));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.endpoints).toHaveLength(2);
    expect(json.endpoints[0].scope).toBe('platform');
    expect(json.endpoints[1].scope).toBe('account');
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
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    mockGetJwtSecret.mockReturnValue('secret');
    mockVerifyToken.mockReturnValue({ userId: 'user-1' });
  });

  it('creates platform-scoped endpoint by default', async () => {
    mockStripe.webhookEndpoints.create.mockResolvedValue({
      id: 'we_new', url: 'https://example.com/hook', status: 'enabled',
      enabled_events: ['charge.succeeded'], created: 1700000000,
    });
    const req = makeRequest('http://localhost/api/stripe/webhooks', {
      method: 'POST',
      body: JSON.stringify({ business_id: 'biz-1', url: 'https://example.com/hook', events: ['charge.succeeded'] }),
    });
    const res = await POST(req);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.endpoint.id).toBe('we_new');
    expect(json.endpoint.scope).toBe('platform');
    // Should be called with connect: true for platform scope
    expect(mockStripe.webhookEndpoints.create).toHaveBeenCalledWith({
      url: 'https://example.com/hook',
      enabled_events: ['charge.succeeded'],
      connect: true,
      metadata: { business_id: 'acct_test', scope: 'platform' },
    });
  });

  it('creates account-scoped endpoint when scope=account', async () => {
    mockStripe.webhookEndpoints.create.mockResolvedValue({
      id: 'we_acct', url: 'https://example.com/hook', status: 'enabled',
      enabled_events: ['payment_intent.succeeded'], created: 1700000000,
    });
    const req = makeRequest('http://localhost/api/stripe/webhooks', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'biz-1', url: 'https://example.com/hook',
        events: ['payment_intent.succeeded'], scope: 'account',
      }),
    });
    const res = await POST(req);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.endpoint.scope).toBe('account');
    // Should be called with stripeAccount for account scope
    expect(mockStripe.webhookEndpoints.create).toHaveBeenCalledWith(
      {
        url: 'https://example.com/hook',
        enabled_events: ['payment_intent.succeeded'],
        metadata: { business_id: 'acct_test', scope: 'account' },
      },
      { stripeAccount: 'acct_test' }
    );
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
