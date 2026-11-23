import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createCheckout, type Order } from '@profullstack/checkout';

/**
 * The /upgrade page (@profullstack/checkout): what is for sale, and that
 * paying through it opens exactly the plan checkout session
 * createSubscriptionCheckout has always opened.
 */

vi.mock('@/lib/auth/merchant-guard', () => ({
  requireMerchant: vi.fn(),
  requireMerchantForWrite: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseAdmin: vi.fn(() => {
    throw new Error('tests pass their own client');
  }),
}));

vi.mock('@/lib/web-wallet/rate-limit', () => ({
  checkRateLimitAsync: vi.fn().mockResolvedValue({ allowed: true, resetAt: 0, limit: 10, remaining: 9 }),
}));

// The real session creator runs here; only what it reads from the payments
// stack is stubbed, with a fixed id so two sessions can be compared whole.
vi.mock('@/lib/checkout/sessions', () => ({
  eligibleMethods: vi.fn(async () => [{ code: 'USDC_POL' }, { code: 'BTC' }, { code: 'PAYPAL' }]),
  generateSessionId: vi.fn(() => 'cs_abcdefghijklmnopqrstuvwx'),
}));

import { NextResponse } from 'next/server';
import { requireMerchant, requireMerchantForWrite } from '@/lib/auth/merchant-guard';
import { createSubscriptionCheckout } from './checkout';
import { DEFAULT_BILLING_BUSINESS_ID, MAX_PENDING_SUBSCRIPTION_CHECKOUTS, SUBSCRIPTION_PRICES, getSubscriptionPrice } from './plans';
import {
  UPGRADE_ERRORS,
  upgradeAccountForPage,
  upgradeAccountForWrite,
  upgradeConfig,
  upgradeOptions,
  upgradePay,
  upgradeSignInUrl,
} from './upgrade';

const MERCHANT = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const merchant = { id: MERCHANT, email: 'buyer@example.com' };

/** A Supabase client that answers the creator's reads and records its insert. */
function fakeSupabase({ open = 0 }: { open?: number } = {}) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const from = (table: string) => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      gt: () => chain,
      maybeSingle: async () =>
        table === 'merchants'
          ? { data: { id: MERCHANT, email: 'Buyer@Example.com' } }
          : table === 'businesses'
            ? { data: { id: DEFAULT_BILLING_BUSINESS_ID, merchant_id: OWNER } }
            : { data: null },
      insert: async (row: Record<string, unknown>) => {
        inserts.push({ table, row });
        return { error: null };
      },
      // The head count of open checkouts.
      then: (resolve: (value: unknown) => void) => resolve({ count: open, error: null }),
    };
    return chain;
  };
  return { client: { from } as any, inserts };
}

const allowed = vi.fn(async () => ({ allowed: true, resetAt: 0, limit: 10, remaining: 9 }));

function pageFor(supabase: ReturnType<typeof fakeSupabase>, extra: Record<string, unknown> = {}) {
  return createCheckout(
    upgradeConfig({ supabase: () => supabase.client, account: async () => merchant, rateLimit: allowed, ...extra })
  );
}

const order = (period: string, totalCents: number, extra: Partial<Order> = {}): Order =>
  ({
    site: 'CoinPay',
    option: { id: period, name: period, kind: 'plan', months: period === 'yearly' ? 12 : 1 },
    audience: '',
    quantity: 1,
    code: '',
    source: '',
    currency: 'USD',
    unitCents: totalCents,
    subtotalCents: totalCents,
    discountCents: 0,
    totalCents,
    amount: totalCents / 100,
    account: merchant,
    description: '',
    ...extra,
  }) as Order;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-06T12:00:00.000Z'));
  process.env.NEXT_PUBLIC_APP_URL = 'https://coinpayportal.com';
  delete process.env.COINPAY_BILLING_BUSINESS_ID;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('what is for sale', () => {
  it('Professional for a year (preselected) or a month, at the price table prices', () => {
    expect(upgradeOptions()).toEqual([
      { id: 'yearly', name: 'Yearly', price: 490, months: 12, popular: true },
      { id: 'monthly', name: 'Monthly', price: 49, months: 1 },
    ]);
    expect(SUBSCRIPTION_PRICES.professional).toEqual({ monthly: 49, yearly: 490 });
  });

  it('charges the term total, in cents, for every option', async () => {
    const page = pageFor(fakeSupabase());
    const cents = Object.fromEntries(page.config.options.map((o: any) => [o.id, o.chargeCents]));
    expect(cents).toEqual({ yearly: 49000, monthly: 4900 });
    for (const period of ['monthly', 'yearly'] as const) {
      const out: any = await page.quote({ option: period });
      expect(out.quote.totalCents).toBe(getSubscriptionPrice('professional', period)! * 100);
    }
  });

  it('preselects the year, and a link can preselect the month', () => {
    const page = pageFor(fakeSupabase());
    expect(page.view({}).selected).toBe('yearly');
    expect(page.view({ query: { plan: 'monthly' } }).selected).toBe('monthly');
    expect(page.view({ query: { plan: 'lifetime' } }).selected).toBe('yearly');
  });

  it('shows the saving the pricing page quotes, computed from the two prices', () => {
    const yearly = pageFor(fakeSupabase()).view({}).options.find((o: any) => o.id === 'yearly');
    expect(yearly.badges.map((b: any) => b.text)).toEqual(['Save 17%', 'Most popular']);
  });

  it('has no discount field, seats or guest email', () => {
    const view = pageFor(fakeSupabase()).view({ account: merchant });
    expect(view.hasDiscount).toBe(false);
    expect(view.anySeats).toBe(false);
    expect(view.account).toEqual({ email: merchant.email });
    expect(pageFor(fakeSupabase()).view({}).needsSignIn).toBe(true);
  });
});

describe('pay()', () => {
  it('writes the same checkout session as createSubscriptionCheckout called directly', async () => {
    for (const period of ['monthly', 'yearly'] as const) {
      const direct = fakeSupabase();
      const expected = await createSubscriptionCheckout(direct.client, {
        merchantId: MERCHANT,
        planId: 'professional',
        billingPeriod: period,
      });
      expect(expected.success).toBe(true);

      const viaPage = fakeSupabase();
      const out = await pageFor(viaPage).handle({ option: period, source: 'pricing' });
      expect(out).toMatchObject({ ok: true, url: '/checkout/cs_abcdefghijklmnopqrstuvwx', id: 'cs_abcdefghijklmnopqrstuvwx' });
      expect(viaPage.inserts).toHaveLength(1);
      expect(viaPage.inserts).toEqual(direct.inserts);
    }
  });

  it('opens the session the activation code has always been given', async () => {
    const supabase = fakeSupabase();
    await pageFor(supabase).handle({ option: 'yearly' });
    expect(supabase.inserts[0]).toEqual({
      table: 'checkout_sessions',
      row: {
        id: 'cs_abcdefghijklmnopqrstuvwx',
        business_id: DEFAULT_BILLING_BUSINESS_ID,
        merchant_id: OWNER,
        amount: 490,
        currency: 'USD',
        description: 'Professional Plan - Annual Subscription',
        customer_email: 'buyer@example.com',
        account_id: MERCHANT,
        property: 'coinpayportal.com',
        metadata: {
          type: 'subscription_payment',
          plan_id: 'professional',
          billing_period: 'yearly',
          merchant_id: MERCHANT,
        },
        success_url: 'https://coinpayportal.com/pricing?upgraded=1&session={CHECKOUT_SESSION_ID}',
        cancel_url: 'https://coinpayportal.com/pricing',
        allowed_methods: null,
        expires_in_minutes: 60,
        status: 'open',
        expires_at: '2026-06-06T13:00:00.000Z',
        created_at: '2026-06-06T12:00:00.000Z',
        updated_at: '2026-06-06T12:00:00.000Z',
      },
    });
  });

  it('calls the existing creator with the merchant, plan and period', async () => {
    const create = vi.fn(async () => ({
      success: true as const,
      session: { id: 'cs_1', path: '/checkout/cs_1', url: 'https://coinpayportal.com/checkout/cs_1', amount: 49, expires_at: '', methods: [] },
    }));
    const supabase = fakeSupabase();
    const out = await upgradePay({ supabase: () => supabase.client, create, rateLimit: allowed })(order('monthly', 4900));
    expect(out).toEqual({ url: '/checkout/cs_1', id: 'cs_1' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(supabase.client, {
      merchantId: MERCHANT,
      planId: 'professional',
      billingPeriod: 'monthly',
    });
    expect(allowed).toHaveBeenCalledWith(MERCHANT, 'subscription_checkout');
  });

  it('throws, and opens nothing, when the priced amount is not the plan price', async () => {
    const create = vi.fn();
    const supabase = fakeSupabase();
    const pay = upgradePay({ supabase: () => supabase.client, create, rateLimit: allowed });
    await expect(pay(order('yearly', 48999))).rejects.toThrow('amount mismatch');
    await expect(pay(order('monthly', 49000))).rejects.toThrow('amount mismatch');
    await expect(pay(order('yearly', 4900))).rejects.toThrow('amount mismatch');
    await expect(pay(order('yearly', 49000, { quantity: 2 }))).rejects.toThrow('amount mismatch');
    await expect(pay(order('yearly', 49000, { code: 'HALF' }))).rejects.toThrow('amount mismatch');
    await expect(pay(order('lifetime', 49000))).rejects.toThrow('Invalid billing period');
    expect(create).not.toHaveBeenCalled();
    expect(supabase.inserts).toHaveLength(0);
  });

  it('throws when the session the creator opened is not for the page total', async () => {
    const create = vi.fn(async () => ({
      success: true as const,
      session: { id: 'cs_1', path: '/checkout/cs_1', url: '', amount: 49, expires_at: '', methods: [] },
    }));
    const supabase = fakeSupabase();
    const pay = upgradePay({ supabase: () => supabase.client, create, rateLimit: allowed });
    await expect(pay(order('yearly', 49000))).rejects.toThrow('amount mismatch');
  });

  it('charges the signed-in merchant, whatever the form says', async () => {
    const supabase = fakeSupabase();
    await pageFor(supabase).handle({ option: 'monthly', email: 'someone-else@example.com', account_id: 'other' });
    expect(supabase.inserts[0].row).toMatchObject({ amount: 49, account_id: MERCHANT, customer_email: 'buyer@example.com' });
  });

  it('opens nothing for a visitor who is not signed in', async () => {
    const supabase = fakeSupabase();
    const out = await pageFor(supabase, { account: async () => null }).handle({ option: 'yearly', email: 'guest@example.com' });
    expect(out).toEqual({ ok: false, error: 'sign_in_required' });
    expect(supabase.inserts).toHaveLength(0);
  });

  it('keeps the rate limit and the pending cap of POST /api/subscriptions/checkout', async () => {
    const limited = fakeSupabase();
    const refused = vi.fn(async () => ({ allowed: false, resetAt: 0, limit: 10, remaining: 0 }));
    expect(await pageFor(limited, { rateLimit: refused }).handle({ option: 'yearly' })).toEqual({ ok: false, error: 'rate_limited' });
    expect(limited.inserts).toHaveLength(0);

    const full = fakeSupabase({ open: MAX_PENDING_SUBSCRIPTION_CHECKOUTS });
    expect(await pageFor(full).handle({ option: 'yearly' })).toEqual({ ok: false, error: 'too_many_pending' });
    expect(full.inserts).toHaveLength(0);

    const nearlyFull = fakeSupabase({ open: MAX_PENDING_SUBSCRIPTION_CHECKOUTS - 1 });
    expect(await pageFor(nearlyFull).handle({ option: 'yearly' })).toMatchObject({ ok: true });
    expect(MAX_PENDING_SUBSCRIPTION_CHECKOUTS).toBe(10);
  });

  it('says why when the account has no usable email', async () => {
    const create = vi.fn(async () => ({ success: false as const, status: 400, error: 'x', code: 'MISSING_CUSTOMER_EMAIL' }));
    const out = await pageFor(fakeSupabase(), { create }).handle({ option: 'yearly' });
    expect(out).toEqual({ ok: false, error: 'email_needed' });
    expect(Object.keys(UPGRADE_ERRORS).sort()).toEqual(['email_needed', 'rate_limited', 'too_many_pending']);
  });

  it('says nothing was charged when the session cannot be opened', async () => {
    const create = vi.fn(async () => ({ success: false as const, status: 500, error: 'Plan checkout is not configured' }));
    const out = await pageFor(fakeSupabase(), { create }).handle({ option: 'yearly' });
    expect(out).toEqual({ ok: false, error: 'payment_unavailable' });
  });
});

describe('who is paying', () => {
  it('is the dashboard session, checked by the guard for writes', async () => {
    vi.mocked(requireMerchantForWrite).mockResolvedValue({ ...merchant, via: 'session', oauthClientId: null });
    const request = new Request('https://coinpayportal.com/api/subscriptions/upgrade', { method: 'POST' });
    expect(await upgradeAccountForWrite(request)).toEqual(merchant);
    expect(requireMerchantForWrite).toHaveBeenCalledWith(request);
  });

  it('is nobody when the guard refuses, or for an OAuth token', async () => {
    const request = new Request('https://coinpayportal.com/api/subscriptions/upgrade', { method: 'POST' });
    vi.mocked(requireMerchantForWrite).mockResolvedValue(NextResponse.json({ error: 'Not authenticated' }, { status: 401 }));
    expect(await upgradeAccountForWrite(request)).toBeNull();
    vi.mocked(requireMerchantForWrite).mockResolvedValue(
      NextResponse.json({ error: 'Cross-site request refused', code: 'cross_site_request' }, { status: 403 })
    );
    expect(await upgradeAccountForWrite(request)).toBeNull();
    vi.mocked(requireMerchantForWrite).mockResolvedValue({ ...merchant, via: 'oauth', oauthClientId: 'app' });
    expect(await upgradeAccountForWrite(request)).toBeNull();
    expect(await upgradeAccountForWrite(null)).toBeNull();
  });

  it('reads the page visitor from the session cookie only', async () => {
    vi.mocked(requireMerchant).mockResolvedValue({ ...merchant, via: 'session', oauthClientId: null });
    expect(await upgradeAccountForPage('token=abc')).toEqual(merchant);
    const seen = vi.mocked(requireMerchant).mock.calls[0][0];
    expect(seen.cookies.get('token')?.value).toBe('abc');
    expect(seen.headers.get('authorization')).toBeNull();

    vi.mocked(requireMerchant).mockClear();
    expect(await upgradeAccountForPage(null)).toBeNull();
    expect(requireMerchant).not.toHaveBeenCalled();
    vi.mocked(requireMerchant).mockResolvedValue(NextResponse.json({ error: 'Not authenticated' }, { status: 401 }));
    expect(await upgradeAccountForPage('token=stale')).toBeNull();
  });
});

describe('the sign-in link', () => {
  it('comes back to /upgrade with the term, through the login page own redirect parameter', () => {
    expect(upgradeSignInUrl({})).toBe('/login?redirect=%2Fupgrade');
    expect(upgradeSignInUrl({ plan: 'monthly', source: 'pricing' })).toBe(
      `/login?redirect=${encodeURIComponent('/upgrade?option=monthly&source=pricing')}`
    );
    expect(upgradeSignInUrl({ option: 'yearly', error: 'sign_in_required' })).toBe(
      `/login?redirect=${encodeURIComponent('/upgrade?option=yearly')}`
    );
  });

  it('never carries anything but a known term and a plain source', () => {
    expect(upgradeSignInUrl({ plan: 'https://evil.example', source: '//evil.example' })).toBe('/login?redirect=%2Fupgrade');
    expect(upgradeSignInUrl({ plan: ['yearly', 'monthly'], source: 'a b' })).toBe(
      `/login?redirect=${encodeURIComponent('/upgrade?option=yearly')}`
    );
  });
});
