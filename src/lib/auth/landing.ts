/**
 * Where a merchant should land after signing in.
 *
 * Two cases send someone to /settings/wallets instead of the dashboard:
 *
 *   1. The account has no payee source at all — no business wallet, no global
 *      wallet, no linked web wallet. Every invoice they create would stall on
 *      "enter a payee address", so the wallet page is the only useful first stop.
 *   2. They have been away a while. A payout address that was right months ago
 *      may point at a wallet they no longer control, and a lapsed login is the
 *      natural moment to confirm it.
 *
 * Case 2 is suppressed once they have actually reviewed the page, so it prompts
 * on return rather than on every navigation.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** A login is "after a while" once this much time has passed. */
export const STALE_LOGIN_DAYS = 30;

export type LandingReason = 'no_wallets' | 'stale_login' | null;

export interface LandingDecision {
  path: string;
  reason: LandingReason;
  /** Days since the previous sign-in, when known. */
  daysSinceLastLogin: number | null;
}

const WALLETS_PATH = '/settings/wallets';
const DEFAULT_PATH = '/dashboard';

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/** True when the account has no address that could serve as a payee. */
export async function hasAnyPayeeSource(
  supabase: SupabaseClient,
  merchantId: string,
): Promise<boolean> {
  const [globalWallets, links, businesses] = await Promise.all([
    supabase.from('merchant_wallets').select('id').eq('merchant_id', merchantId).limit(1),
    supabase.from('wallet_account_links').select('id').eq('merchant_id', merchantId).limit(1),
    supabase.from('businesses').select('id').eq('merchant_id', merchantId),
  ]);

  if ((globalWallets.data?.length ?? 0) > 0) return true;
  if ((links.data?.length ?? 0) > 0) return true;

  const businessIds = (businesses.data ?? []).map((b: { id: string }) => b.id);
  if (businessIds.length === 0) return false;

  const businessWallets = await supabase
    .from('business_wallets')
    .select('id')
    .in('business_id', businessIds)
    .limit(1);

  return (businessWallets.data?.length ?? 0) > 0;
}

/**
 * Decide the landing page. `now` is injectable so the rule can be tested without
 * freezing the clock.
 */
export function decideLanding(input: {
  hasPayeeSource: boolean;
  lastLoginAt: string | null;
  walletsReviewedAt: string | null;
  now?: Date;
}): LandingDecision {
  const now = input.now ?? new Date();
  const lastLogin = input.lastLoginAt ? new Date(input.lastLoginAt) : null;
  const daysSinceLastLogin =
    lastLogin && !Number.isNaN(lastLogin.getTime()) ? daysBetween(lastLogin, now) : null;

  // No way to get paid — this outranks everything, including a fresh login.
  if (!input.hasPayeeSource) {
    return { path: WALLETS_PATH, reason: 'no_wallets', daysSinceLastLogin };
  }

  if (daysSinceLastLogin !== null && daysSinceLastLogin >= STALE_LOGIN_DAYS) {
    const reviewed = input.walletsReviewedAt ? new Date(input.walletsReviewedAt) : null;
    const reviewedRecently =
      reviewed &&
      !Number.isNaN(reviewed.getTime()) &&
      daysBetween(reviewed, now) < STALE_LOGIN_DAYS;

    if (!reviewedRecently) {
      return { path: WALLETS_PATH, reason: 'stale_login', daysSinceLastLogin };
    }
  }

  return { path: DEFAULT_PATH, reason: null, daysSinceLastLogin };
}
