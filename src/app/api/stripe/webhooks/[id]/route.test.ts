import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVerifyToken = vi.fn();
const mockGetJwtSecret = vi.fn();
const mockWebhookDel = vi.fn();

vi.mock('@/lib/auth/jwt', () => ({ verifyToken: (...args: unknown[]) => mockVerifyToken(...args) }));
vi.mock('@/lib/secrets', () => ({ getJwtSecret: () => mockGetJwtSecret() }));
vi.mock('stripe', () => ({
  default: vi.fn(() => ({
    webhookEndpoints: { del: mockWebhookDel },
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
    mockGetJwtSecret.mockReturnValue('secret');
    mockVerifyToken.mockReturnValue({ userId: 'user-1' });
  });

  it('deletes a webhook endpoint', async () => {
    mockWebhookDel.mockResolvedValue({});
    const req = makeRequest('http://localhost/api/stripe/webhooks/we_123?business_id=biz-1');
    const res = await DELETE(req, { params: Promise.resolve({ id: 'we_123' }) });
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockWebhookDel).toHaveBeenCalledWith('we_123', { stripeAccount: 'acct_test' });
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
