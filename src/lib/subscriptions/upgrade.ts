import type { SupabaseClient } from '@supabase/supabase-js';
import { createCheckout, type CheckoutConfig, type Order } from '@profullstack/checkout';
import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant, requireMerchantForWrite } from '@/lib/auth/merchant-guard';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { countOpenSubscriptionCheckouts, createSubscriptionCheckout } from './checkout';
import {
  MAX_PENDING_SUBSCRIPTION_CHECKOUTS,
  SUBSCRIPTION_PRICES,
  getSubscriptionPrice,
  type BillingPeriod,
} from './plans';

/**
 * /upgrade: where a signed-in merchant picks monthly or yearly for the
 * Professional plan (@profullstack/checkout), then pays on the hosted
 * checkout like any other buyer.
 *
 * This only replaces the picker. The session is still opened by
 * createSubscriptionCheckout (./checkout.ts), with the same bounds
 * POST /api/subscriptions/checkout applies, so the session row, its metadata
 * and the activation in ./activate.ts see exactly what they saw before.
 */

export const UPGRADE_PLAN_ID = 'professional';
export const UPGRADE_PAGE = '/upgrade';
export const UPGRADE_ACTION = '/api/subscriptions/upgrade';

const PERIODS: readonly BillingPeriod[] = ['yearly', 'monthly'];

function isPeriod(value: unknown): value is BillingPeriod {
  return typeof value === 'string' && (PERIODS as readonly string[]).includes(value);
}

/** The two terms, priced from the one price table (./plans.ts). */
export function upgradeOptions() {
  const prices = SUBSCRIPTION_PRICES[UPGRADE_PLAN_ID];
  return [
    { id: 'yearly', name: 'Yearly', price: prices.yearly, months: 12, popular: true },
    { id: 'monthly', name: 'Monthly', price: prices.monthly, months: 1 },
  ];
}

/** Refusals the merchant should read as they are, in the words the API uses. */
export const UPGRADE_ERRORS = {
  rate_limited: 'Too many subscription checkouts. Please try again shortly.',
  too_many_pending:
    'You already have too many unpaid subscription checkouts. Complete or let one expire before starting another.',
  email_needed: 'Your account needs a valid email address before you can upgrade',
} as const;

function refusal(code: keyof typeof UPGRADE_ERRORS, detail?: string): Error & { code: string } {
  return Object.assign(new Error(detail || UPGRADE_ERRORS[code]), { code });
}

export type UpgradeAccount = { id: string; email: string };

export interface UpgradeDeps {
  supabase: () => SupabaseClient;
  create: typeof createSubscriptionCheckout;
  countOpen: typeof countOpenSubscriptionCheckouts;
  rateLimit: typeof checkRateLimitAsync;
  account: (request: Request | null) => Promise<UpgradeAccount | null>;
}

/**
 * The merchant posting the form. A dashboard session only: the `token` cookie
 * the login routes set (or the same JWT as a bearer), and for a cookie the
 * repo's own same-site rule for writes (requireMerchantForWrite). Never an
 * API key, never the URL or the form.
 */
export async function upgradeAccountForWrite(request: Request | null): Promise<UpgradeAccount | null> {
  if (!request) return null;
  const guard = await requireMerchantForWrite(request as NextRequest);
  if (guard instanceof NextResponse || guard.via !== 'session') return null;
  return { id: guard.id, email: guard.email };
}

/** The merchant viewing the page, from the request's cookie header. */
export async function upgradeAccountForPage(cookieHeader: string | null): Promise<UpgradeAccount | null> {
  if (!cookieHeader) return null;
  const guard = await requireMerchant(
    new NextRequest('https://coinpayportal.com/upgrade', { headers: { cookie: cookieHeader } })
  );
  if (guard instanceof NextResponse || guard.via !== 'session') return null;
  return { id: guard.id, email: guard.email };
}

const defaults: UpgradeDeps = {
  supabase: getSupabaseAdmin,
  create: createSubscriptionCheckout,
  countOpen: countOpenSubscriptionCheckouts,
  rateLimit: checkRateLimitAsync,
  account: upgradeAccountForWrite,
};

/**
 * pay(): open the plan checkout for the term picked on the page.
 *
 * The amount is never taken from the page: createSubscriptionCheckout prices
 * the session from the price table. The page's total is only compared against
 * it, before anything is written and again on the session that was opened.
 */
export function upgradePay(overrides: Partial<UpgradeDeps> = {}) {
  const deps = { ...defaults, ...overrides };
  return async (order: Order): Promise<{ url: string; id: string }> => {
    const period = order.option.id;
    if (!isPeriod(period)) throw new Error('Invalid billing period');
    const price = getSubscriptionPrice(UPGRADE_PLAN_ID, period);
    if (price === null) throw new Error('Unable to determine price for selected plan');
    if (order.quantity !== 1 || order.code || order.totalCents !== Math.round(price * 100)) {
      throw new Error(`amount mismatch: page ${order.totalCents}, plan ${Math.round(price * 100)}`);
    }
    const merchantId = order.account.id;
    if (!merchantId || order.account.guest) throw new Error('No signed-in merchant');

    const supabase = deps.supabase();

    // The same two bounds as POST /api/subscriptions/checkout (SUB-02).
    const rate = await deps.rateLimit(merchantId, 'subscription_checkout');
    if (!rate.allowed) throw refusal('rate_limited');
    const pending = await deps.countOpen(supabase, merchantId);
    if (pending !== null && pending >= MAX_PENDING_SUBSCRIPTION_CHECKOUTS) throw refusal('too_many_pending');

    const result = await deps.create(supabase, {
      merchantId,
      planId: UPGRADE_PLAN_ID,
      billingPeriod: period,
    });
    if (!result.success) {
      if (result.code === 'MISSING_CUSTOMER_EMAIL') throw refusal('email_needed');
      throw new Error(result.error);
    }
    if (Math.round(result.session.amount * 100) !== order.totalCents) {
      throw new Error(`amount mismatch: session ${result.session.amount}, page ${order.totalCents}`);
    }
    // The path, as the pricing page has always followed: the hosted checkout
    // is on this origin, whichever host (clearnet or onion) the merchant is on.
    return { url: result.session.path, id: result.session.id };
  };
}

export function upgradeConfig(overrides: Partial<UpgradeDeps> = {}): CheckoutConfig {
  const deps = { ...defaults, ...overrides };
  return {
    site: 'CoinPay',
    title: 'Upgrade to Professional',
    subtitle: 'Monthly or yearly. You pick a coin or PayPal on the next page.',
    action: UPGRADE_ACTION,
    page: UPGRADE_PAGE,
    theme: 'dark',
    options: upgradeOptions(),
    guarantee: '14-day money-back guarantee for new Professional subscriptions.',
    requireAccount: true,
    // Read at call time: behind nginx the Host header is internal.
    siteUrl: (process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com').replace(/\/$/, ''),
    errors: { ...UPGRADE_ERRORS },
    account: deps.account,
    pay: upgradePay(deps),
    onError: (error) => {
      console.error('[Subscriptions] upgrade checkout failed:', error instanceof Error ? error.message : error);
    },
  };
}

let cached: ReturnType<typeof createCheckout> | null = null;

/** The checkout, built on first use so env is read at runtime, not at build. */
export function upgradeCheckout() {
  if (!cached) cached = createCheckout(upgradeConfig());
  return cached;
}

/**
 * Where a signed-out visitor signs in and comes back to /upgrade with the term
 * they picked. /login reads `redirect` (lib/auth/login-redirect.ts).
 */
export function upgradeSignInUrl(query: Record<string, string | string[] | undefined> = {}): string {
  const one = (key: string) => {
    const value = query[key];
    return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
  };
  const params = new URLSearchParams();
  const option = one('option') ?? one('plan');
  if (isPeriod(option)) params.set('option', option);
  const source = one('source');
  if (source && /^[A-Za-z0-9_-]{1,64}$/.test(source)) params.set('source', source);
  const next = `${UPGRADE_PAGE}${params.size ? `?${params}` : ''}`;
  return `/login?redirect=${encodeURIComponent(next)}`;
}
