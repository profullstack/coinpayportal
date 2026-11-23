import type { NextRequest } from 'next/server';
import { upgradeCheckout } from '@/lib/subscriptions/upgrade';

export const dynamic = 'force-dynamic';

/**
 * POST /api/subscriptions/upgrade
 *
 * The form on /upgrade (@profullstack/checkout). The term is priced on the
 * server, the plan checkout is opened for the signed-in merchant by the same
 * createSubscriptionCheckout POST /api/subscriptions/checkout uses, and the
 * answer is a 303 to /checkout/cs_... (JSON when asked for).
 *
 * A signed-out post goes back to /upgrade, which sends it to /login. A post
 * from another site is refused. API clients keep POST /api/subscriptions/checkout.
 */
export async function POST(request: NextRequest) {
  return upgradeCheckout().POST(request);
}
