import { NextResponse } from 'next/server';
import { STRIPE_ENABLED } from './enabled';

/**
 * Stripe is archived for good (2026-10-29).
 *
 * Stripe banned the account holder, so CoinPay takes no card payments through
 * it, creates no Checkout sessions, Connect accounts, payouts, refunds or
 * webhooks, and offers no card option anywhere. Past Stripe transactions and
 * disputes stay in the database and stay readable. This is a constant, not an
 * env flag, so no deploy setting can turn it back on.
 */
export { STRIPE_ENABLED };

export const STRIPE_ARCHIVED_MESSAGE =
  'Card payments through Stripe are turned off on CoinPay. Pay with crypto or PayPal instead.';

export const STRIPE_ARCHIVED_CODE = 'stripe_archived';

export class StripeArchivedError extends Error {
  readonly code = STRIPE_ARCHIVED_CODE;
  constructor() {
    super(STRIPE_ARCHIVED_MESSAGE);
    this.name = 'StripeArchivedError';
  }
}

/** 410 for every route that would talk to Stripe or start a card payment. */
export function stripeGone(): NextResponse {
  return NextResponse.json(
    { success: false, error: STRIPE_ARCHIVED_MESSAGE, code: STRIPE_ARCHIVED_CODE },
    { status: 410, headers: { 'Cache-Control': 'no-store' } }
  );
}

/**
 * Stripe routes that only read our own history out of the database. These stay
 * up so a merchant can still see old card transactions and disputes.
 */
const READ_ONLY_HISTORY = [
  /^\/api\/stripe\/analytics$/,
  /^\/api\/stripe\/transactions$/,
  /^\/api\/stripe\/transactions\/[^/]+$/,
  /^\/api\/stripe\/disputes$/,
  /^\/api\/stripe\/disputes\/[^/]+$/,
  /^\/api\/stripe\/payouts\/[^/]+$/,
];

/** True when the request must be refused because Stripe is archived. */
export function isArchivedStripeRequest(method: string, path: string): boolean {
  if (STRIPE_ENABLED) return false;
  if (path !== '/api/stripe' && !path.startsWith('/api/stripe/')) return false;
  if (method === 'GET' || method === 'HEAD') {
    return !READ_ONLY_HISTORY.some((re) => re.test(path));
  }
  return true;
}
