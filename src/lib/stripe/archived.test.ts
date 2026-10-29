import { describe, expect, it } from 'vitest';
import { STRIPE_ENABLED, isArchivedStripeRequest, stripeGone } from './archived';
import { getStripe } from '@/lib/server/optional-deps';

describe('Stripe archive', () => {
  it('is off in code', () => {
    expect(STRIPE_ENABLED).toBe(false);
  });

  it('refuses every Stripe write and Stripe-backed read', () => {
    expect(isArchivedStripeRequest('POST', '/api/stripe/webhook')).toBe(true);
    expect(isArchivedStripeRequest('POST', '/api/stripe/payments/create')).toBe(true);
    expect(isArchivedStripeRequest('POST', '/api/stripe/connect/onboard')).toBe(true);
    expect(isArchivedStripeRequest('POST', '/api/stripe/transactions/abc/refund')).toBe(true);
    expect(isArchivedStripeRequest('DELETE', '/api/stripe/connect/disconnect')).toBe(true);
    expect(isArchivedStripeRequest('GET', '/api/stripe/balance')).toBe(true);
    expect(isArchivedStripeRequest('GET', '/api/stripe/api-keys')).toBe(true);
    expect(isArchivedStripeRequest('GET', '/api/stripe/connect/status/acct_1')).toBe(true);
  });

  it('keeps database-only history readable', () => {
    expect(isArchivedStripeRequest('GET', '/api/stripe/transactions')).toBe(false);
    expect(isArchivedStripeRequest('GET', '/api/stripe/transactions/abc')).toBe(false);
    expect(isArchivedStripeRequest('GET', '/api/stripe/disputes')).toBe(false);
    expect(isArchivedStripeRequest('GET', '/api/stripe/analytics')).toBe(false);
  });

  it('leaves other routes alone', () => {
    expect(isArchivedStripeRequest('POST', '/api/payments/create')).toBe(false);
    expect(isArchivedStripeRequest('POST', '/api/stripes')).toBe(false);
  });

  it('answers 410', async () => {
    const res = stripeGone();
    expect(res.status).toBe(410);
    expect((await res.json()).code).toBe('stripe_archived');
  });

  it('getStripe refuses even with a key', async () => {
    await expect(getStripe('sk_test_x')).rejects.toThrow(/turned off/);
  });
});

describe('invoice enable-card while archived', () => {
  it('answers 410 before touching the invoice', async () => {
    const { POST } = await import('@/app/api/invoices/[id]/enable-card/route');
    const res = await POST(new Request('http://x/api/invoices/i/enable-card', { method: 'POST' }) as any, {
      params: Promise.resolve({ id: 'i' }),
    });
    expect(res.status).toBe(410);
  });
});
