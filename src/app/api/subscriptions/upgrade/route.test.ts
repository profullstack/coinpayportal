import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/auth/merchant-guard', () => ({
  requireMerchant: vi.fn(),
  requireMerchantForWrite: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseAdmin: vi.fn(() => ({ fake: 'client' })),
}));

vi.mock('@/lib/web-wallet/rate-limit', () => ({
  checkRateLimitAsync: vi.fn(),
}));

vi.mock('@/lib/subscriptions/checkout', () => ({
  createSubscriptionCheckout: vi.fn(),
  countOpenSubscriptionCheckouts: vi.fn(),
}));

import { POST } from './route';
import { requireMerchantForWrite } from '@/lib/auth/merchant-guard';
import { createSubscriptionCheckout, countOpenSubscriptionCheckouts } from '@/lib/subscriptions/checkout';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';

const MERCHANT = '11111111-1111-4111-8111-111111111111';

function post(fields: Record<string, string>, headers: Record<string, string> = {}) {
  return POST(
    new NextRequest('https://coinpayportal.com/api/subscriptions/upgrade', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://coinpayportal.com',
        referer: 'https://coinpayportal.com/upgrade?plan=yearly',
        ...headers,
      },
      body: new URLSearchParams(fields).toString(),
    })
  );
}

describe('POST /api/subscriptions/upgrade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(requireMerchantForWrite).mockResolvedValue({
      id: MERCHANT,
      email: 'buyer@example.com',
      via: 'session',
      oauthClientId: null,
    });
    vi.mocked(checkRateLimitAsync).mockResolvedValue({ allowed: true, resetAt: 0, limit: 10, remaining: 9 });
    vi.mocked(countOpenSubscriptionCheckouts).mockResolvedValue(0);
    vi.mocked(createSubscriptionCheckout).mockImplementation(async (_supabase, input) => ({
      success: true,
      session: {
        id: 'cs_abcdefghijklmnopqrstuvwx',
        path: '/checkout/cs_abcdefghijklmnopqrstuvwx',
        url: 'https://coinpayportal.com/checkout/cs_abcdefghijklmnopqrstuvwx',
        amount: input.billingPeriod === 'yearly' ? 490 : 49,
        expires_at: '2026-06-06T13:00:00.000Z',
        methods: ['USDC_POL', 'BTC', 'PAYPAL'],
      },
    }));
  });

  it('redirects a signed-in form post to the hosted checkout for the term picked', async () => {
    for (const period of ['yearly', 'monthly'] as const) {
      vi.mocked(createSubscriptionCheckout).mockClear();
      const res = await post({ option: period, source: 'pricing' });
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/checkout/cs_abcdefghijklmnopqrstuvwx');
      expect(createSubscriptionCheckout).toHaveBeenCalledTimes(1);
      expect(createSubscriptionCheckout).toHaveBeenCalledWith(
        { fake: 'client' },
        { merchantId: MERCHANT, planId: 'professional', billingPeriod: period }
      );
    }
    expect(checkRateLimitAsync).toHaveBeenCalledWith(MERCHANT, 'subscription_checkout');
  });

  it('answers JSON callers with the checkout path', async () => {
    const res = await post({ option: 'monthly' }, { accept: 'application/json' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, url: '/checkout/cs_abcdefghijklmnopqrstuvwx' });
  });

  it('charges the signed-in merchant whatever the form names', async () => {
    await post({ option: 'monthly', email: 'someone-else@example.com', merchant_id: 'other', amount: '1' });
    expect(createSubscriptionCheckout).toHaveBeenCalledWith(
      { fake: 'client' },
      { merchantId: MERCHANT, planId: 'professional', billingPeriod: 'monthly' }
    );
  });

  it('sends a signed-out post back to /upgrade and opens nothing', async () => {
    vi.mocked(requireMerchantForWrite).mockResolvedValue(NextResponse.json({ error: 'Not authenticated' }, { status: 401 }));
    const res = await post({ option: 'yearly' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/upgrade?option=yearly&error=sign_in_required');
    expect(createSubscriptionCheckout).not.toHaveBeenCalled();
    expect(checkRateLimitAsync).not.toHaveBeenCalled();
  });

  it('refuses a post from another site before looking at the session', async () => {
    const form = await post({ option: 'yearly' }, { origin: 'https://evil.example' });
    expect(form.status).toBe(303);
    expect(form.headers.get('location')).toBe('/upgrade?option=yearly&error=bad_origin');
    const json = await post({ option: 'yearly' }, { origin: 'https://evil.example', accept: 'application/json' });
    expect(json.status).toBe(403);
    const crossSite = await post({ option: 'yearly' }, { 'sec-fetch-site': 'cross-site' });
    expect(crossSite.headers.get('location')).toContain('error=bad_origin');
    expect(requireMerchantForWrite).not.toHaveBeenCalled();
    expect(createSubscriptionCheckout).not.toHaveBeenCalled();
  });

  it('refuses a term that is not sold', async () => {
    const res = await post({ option: 'lifetime' }, { accept: 'application/json' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_option');
    expect(createSubscriptionCheckout).not.toHaveBeenCalled();
  });

  it('keeps the rate limit and the pending cap, with their own messages', async () => {
    vi.mocked(checkRateLimitAsync).mockResolvedValue({ allowed: false, resetAt: 0, limit: 10, remaining: 0 });
    const limited = await post({ option: 'yearly' });
    expect(limited.headers.get('location')).toBe('/upgrade?option=yearly&error=rate_limited');

    vi.mocked(checkRateLimitAsync).mockResolvedValue({ allowed: true, resetAt: 0, limit: 10, remaining: 9 });
    vi.mocked(countOpenSubscriptionCheckouts).mockResolvedValue(10);
    const full = await post({ option: 'yearly' }, { accept: 'application/json' });
    expect(full.status).toBe(409);
    expect(await full.json()).toMatchObject({
      ok: false,
      error: 'too_many_pending',
      message: 'You already have too many unpaid subscription checkouts. Complete or let one expire before starting another.',
    });
    expect(createSubscriptionCheckout).not.toHaveBeenCalled();
  });

  it('says nothing was charged when the session cannot be opened', async () => {
    vi.mocked(createSubscriptionCheckout).mockResolvedValue({ success: false, status: 500, error: 'Failed to start checkout' });
    const res = await post({ option: 'monthly' }, { accept: 'application/json' });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('payment_unavailable');
  });
});
