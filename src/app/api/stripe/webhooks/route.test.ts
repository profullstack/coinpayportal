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

  it('returns only account-scoped webhooks for the requesting business', async () => {
    mockStripe.webhookEndpoints.list.mockResolvedValueOnce({
      data: [
        {
          id: 'we_acct', url: 'https://example.com/account', status: 'enabled',
          enabled_events: ['invoice.paid'], created: 1700000001,
          metadata: { business_id: 'biz-1', stripe_account_id: 'acct_test', scope: 'account' },
        },
      ],
    });

    const res = await GET(makeRequest('http://localhost/api/stripe/webhooks?business_id=biz-1'));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.endpoints).toHaveLength(1);
    expect(json.endpoints[0].id).toBe('we_acct');
    expect(json.endpoints[0].scope).toBe('account');
  });

  it('does NOT expose platform-level webhooks (CoinPay infra) to merchants', async () => {
    // Even if a platform endpoint somehow has matching metadata (legacy data),
    // the merchant GET must NOT surface it. Merchants only see their own
    // connected-account webhooks.
    mockStripe.webhookEndpoints.list.mockResolvedValueOnce({ data: [] });

    const res = await GET(makeRequest('http://localhost/api/stripe/webhooks?business_id=biz-1'));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.endpoints).toHaveLength(0);
    // Should query the connected-account scope only — i.e. exactly one
    // list call, with stripeAccount option set.
    expect(mockStripe.webhookEndpoints.list).toHaveBeenCalledTimes(1);
    expect(mockStripe.webhookEndpoints.list).toHaveBeenCalledWith(
      { limit: 100 },
      { stripeAccount: 'acct_test' }
    );
  });

  it('does NOT return webhooks belonging to other businesses on same stripe account', async () => {
    mockStripe.webhookEndpoints.list.mockResolvedValueOnce({
      data: [
        {
          id: 'we_mine', url: 'https://example.com/mine', status: 'enabled',
          enabled_events: ['invoice.paid'], created: 1700000000,
          metadata: { business_id: 'biz-1', stripe_account_id: 'acct_test', scope: 'account' },
        },
        {
          id: 'we_acct_other', url: 'https://example.com/acct-other', status: 'enabled',
          enabled_events: ['invoice.paid'], created: 1700000003,
          metadata: { business_id: 'biz-2', stripe_account_id: 'acct_test', scope: 'account' },
        },
      ],
    });

    const res = await GET(makeRequest('http://localhost/api/stripe/webhooks?business_id=biz-1'));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.endpoints).toHaveLength(1);
    expect(json.endpoints[0].id).toBe('we_mine');
  });

  it('returns 400 when business_id missing', async () => {
    const res = await GET(makeRequest('http://localhost/api/stripe/webhooks'));
    expect(res.status).toBe(400);
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

  it('REJECTS platform-scoped creation — only CoinPay infra owns the platform webhook (regression: d0rz incident)', async () => {
    const req = makeRequest('http://localhost/api/stripe/webhooks', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'biz-1',
        url: 'https://d0rz.com/api/webhooks/coinpay/stripe',
        events: ['checkout.session.completed'],
        scope: 'platform',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(mockStripe.webhookEndpoints.create).not.toHaveBeenCalled();
  });

  it('REJECTS implicit platform scope when no scope provided', async () => {
    const req = makeRequest('http://localhost/api/stripe/webhooks', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'biz-1',
        url: 'https://example.com/hook',
        events: ['charge.succeeded'],
      }),
    });
    const res = await POST(req);
    // No explicit scope used to default to "platform" — that path is now
    // forbidden too. We allow account scope only when explicitly requested.
    // (We accept either 403 from the platform check or 400 from the
    // platform-reserved-event check, depending on event list.)
    expect([400, 403]).toContain(res.status);
    expect(mockStripe.webhookEndpoints.create).not.toHaveBeenCalled();
  });

  it('REJECTS subscribing to platform-reserved events even on account scope', async () => {
    const req = makeRequest('http://localhost/api/stripe/webhooks', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'biz-1',
        url: 'https://example.com/hook',
        events: ['checkout.session.completed', 'payment_intent.succeeded'],
        scope: 'account',
      }),
    });
    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/handled by CoinPay/i);
    expect(mockStripe.webhookEndpoints.create).not.toHaveBeenCalled();
  });

  it('creates account-scoped endpoint with allowed events', async () => {
    mockStripe.webhookEndpoints.create.mockResolvedValue({
      id: 'we_acct', url: 'https://example.com/hook', status: 'enabled',
      enabled_events: ['invoice.paid'], created: 1700000000,
    });
    const req = makeRequest('http://localhost/api/stripe/webhooks', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'biz-1', url: 'https://example.com/hook',
        events: ['invoice.paid'], scope: 'account',
      }),
    });
    const res = await POST(req);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.endpoint.scope).toBe('account');
    expect(mockStripe.webhookEndpoints.create).toHaveBeenCalledWith(
      {
        url: 'https://example.com/hook',
        enabled_events: ['invoice.paid'],
        metadata: { business_id: 'biz-1', stripe_account_id: 'acct_test', scope: 'account' },
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
