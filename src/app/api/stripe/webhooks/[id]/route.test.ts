import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVerifyToken = vi.fn();
const mockGetJwtSecret = vi.fn();
const mockWebhookDel = vi.fn();
const mockWebhookRetrieve = vi.fn();

vi.mock('@/lib/auth/jwt', () => ({ verifyToken: (...args: unknown[]) => mockVerifyToken(...args) }));
vi.mock('@/lib/secrets', () => ({ getJwtSecret: () => mockGetJwtSecret() }));
vi.mock('stripe', () => ({
  default: vi.fn(() => ({
    webhookEndpoints: { del: mockWebhookDel, retrieve: mockWebhookRetrieve },
  })),
}));
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

import { DELETE } from './route';
import { NextRequest } from 'next/server';

function makeRequest(url: string, opts: any = {}) {
  return new NextRequest(new URL(url, 'http://localhost'), {
    headers: { authorization: 'Bearer test-token', ...opts.headers },
    method: 'DELETE',
    ...opts,
  });
}

describe('DELETE /api/stripe/webhooks/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    mockGetJwtSecret.mockReturnValue('secret');
    mockVerifyToken.mockReturnValue({ userId: 'user-1' });
    // Default: webhook belongs to this business
    mockWebhookRetrieve.mockResolvedValue({ id: 'we_123', metadata: { business_id: 'acct_test' } });
  });

  it('deletes a webhook endpoint from the platform account', async () => {
    mockWebhookDel.mockResolvedValue({});
    const req = makeRequest('http://localhost/api/stripe/webhooks/we_123?business_id=biz-1');
    const res = await DELETE(req, { params: Promise.resolve({ id: 'we_123' }) });
    const json = await res.json();
    expect(json.success).toBe(true);
    // Should delete from platform account (no stripeAccount param)
    expect(mockWebhookDel).toHaveBeenCalledWith('we_123');
  });

  it('deletes webhook without metadata (legacy webhooks)', async () => {
    mockWebhookRetrieve.mockResolvedValue({ id: 'we_old', metadata: {} });
    mockWebhookDel.mockResolvedValue({});
    const req = makeRequest('http://localhost/api/stripe/webhooks/we_old?business_id=biz-1');
    const res = await DELETE(req, { params: Promise.resolve({ id: 'we_old' }) });
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockWebhookDel).toHaveBeenCalledWith('we_old');
  });

  it('returns 403 when webhook belongs to different business', async () => {
    mockWebhookRetrieve.mockResolvedValue({ id: 'we_123', metadata: { business_id: 'acct_other' } });
    const req = makeRequest('http://localhost/api/stripe/webhooks/we_123?business_id=biz-1');
    const res = await DELETE(req, { params: Promise.resolve({ id: 'we_123' }) });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('Webhook does not belong to this business');
  });

  it('returns 401 without auth', async () => {
    const req = new NextRequest(new URL('http://localhost/api/stripe/webhooks/we_123'), { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'we_123' }) });
    expect(res.status).toBe(401);
  });

  it('returns 500 on stripe error', async () => {
    mockWebhookDel.mockRejectedValue(new Error('Stripe error'));
    const req = makeRequest('http://localhost/api/stripe/webhooks/we_123?business_id=biz-1');
    const res = await DELETE(req, { params: Promise.resolve({ id: 'we_123' }) });
    expect(res.status).toBe(500);
  });
});
