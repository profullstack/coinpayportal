import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveMerchantBearer } from '@/lib/auth/bearer';
import { isApiKey, getBusinessByApiKey } from '@/lib/auth/apikey';

export type ResolvedMerchant = {
  merchantId: string;
  apiKeyBusinessId: string | null;
  /**
   * How the caller authenticated. 'oauth' (only possible with `allowOAuth`)
   * cannot move funds: pass `{ merchantId, via }` to `authorizeBusiness` and
   * `funds.move` is refused. See ./oauth-funds.
   */
  via: 'api_key' | 'session' | 'oauth';
};

export type ResolveError = { error: string; status: number };

/**
 * Resolve the authenticated merchant from a request.
 *
 * Accepts (in order):
 *   1. `x-api-key: cp_live_...`
 *   2. `Authorization: Bearer cp_live_...`
 *   3. `Authorization: Bearer <session jwt>`
 *   4. `Authorization: Bearer <OAuth access token with the merchant scope>`,
 *      only when the caller passes `{ allowOAuth: true }`
 *
 * For API key auth, `apiKeyBusinessId` is the business that owns the key —
 * callers can use it to lock writes to that business and reject mismatched
 * `business_id` in the request body.
 */
export type ResolveMerchantOptions = {
  /**
   * Also accept an OAuth access token whose grant carries the `merchant` scope,
   * acting as its `sub`. Off by default: several callers treat "not an API key"
   * as "a signed-in owner" and gate funds movement on it (pay runs, manual
   * payment handles), so OAuth is opted into per route, never inherited.
   */
  allowOAuth?: boolean;
};

export async function resolveMerchant(
  supabase: SupabaseClient,
  request: NextRequest,
  options: ResolveMerchantOptions = {}
): Promise<ResolvedMerchant | ResolveError> {
  const apiKeyHeader = request.headers.get('x-api-key');
  if (apiKeyHeader) {
    return resolveApiKey(supabase, apiKeyHeader);
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'Missing authorization header', status: 401 };
  }

  const token = authHeader.substring(7);

  if (isApiKey(token)) {
    return resolveApiKey(supabase, token);
  }

  // A dashboard session JWT, or (with `allowOAuth`) an OAuth access token whose
  // grant carries the `merchant` scope, acting as its `sub` as oauth-bearer.ts
  // does. An OAuth token without `merchant` is refused with 403
  // insufficient_scope.
  const auth = resolveMerchantBearer(authHeader);
  if (!auth.ok) {
    return { error: auth.error, status: auth.status };
  }
  if (auth.kind === 'oauth' && !options.allowOAuth) {
    return { error: 'This endpoint requires a dashboard session or an API key', status: 403 };
  }
  return { merchantId: auth.merchantId, apiKeyBusinessId: null, via: auth.kind };
}

async function resolveApiKey(
  supabase: SupabaseClient,
  apiKey: string
): Promise<ResolvedMerchant | ResolveError> {
  const result = await getBusinessByApiKey(supabase, apiKey);
  if (!result.success || !result.business) {
    return { error: result.error ?? 'Invalid API key', status: 401 };
  }
  return {
    merchantId: result.business.merchant_id,
    apiKeyBusinessId: result.business.id,
    via: 'api_key',
  };
}

/**
 * Whether an API key may act on a given business.
 *
 * `resolveMerchant` already returns `apiKeyBusinessId` — the business the key
 * belongs to — and its own doc comment says callers "can use it to lock writes
 * to that business and reject mismatched `business_id`". Half of them did not.
 * A key issued for business A therefore acted freely on business B, as long as
 * both belonged to the same merchant. That is not what the key represents: a
 * merchant hands out a scoped key precisely so an integrator can touch one
 * business and not the rest.
 *
 * JWT (session) auth has no key scope, so `apiKeyBusinessId` is null and the
 * caller's own ownership check governs — this returns true and does not
 * substitute for that check.
 *
 * Returning a boolean rather than doing the rejection keeps each route's error
 * shape its own; a shared helper that wrote responses would not fit the routes
 * that need it.
 */
/**
 * Whether the caller may change ACCOUNT-level (merchant-wide) state: the
 * merchant's own wallets and default payee handles, which every business of
 * the merchant falls back to. A business API key never may: it belongs to one
 * business, and an account-level write redirects payments for all of them
 * (`keyMayActOnBusiness(auth, null)` is true, so routes that only checked that
 * let a key overwrite `merchant_wallets`).
 */
export function keyMayActOnAccount(auth: { apiKeyBusinessId: string | null }): boolean {
  return !auth.apiKeyBusinessId;
}

export function keyMayActOnBusiness(
  auth: { apiKeyBusinessId: string | null },
  businessId: string | null | undefined,
): boolean {
  if (!auth.apiKeyBusinessId) return true;
  if (!businessId) return true;
  return auth.apiKeyBusinessId === businessId;
}
