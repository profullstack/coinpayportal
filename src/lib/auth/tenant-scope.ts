import type { SupabaseClient } from '@supabase/supabase-js';
import { authorizeBusiness, getAccessibleBusinessRoles } from './authz';
import type { Capability } from './permissions';

/**
 * Resolve which business a request is allowed to act on.
 *
 * The 2026-08-19 audit found the same shape in eighteen places, across routes
 * written by different people at different times: **authenticate the caller,
 * then trust a tenant id the caller supplied.** The most direct form was
 *
 *     getStripeAccountId(businessId || authResult)
 *
 * where `businessId` is a query-string parameter and `authResult` is the
 * authenticated user — so the untrusted value took precedence over the trusted
 * one, and `?business_id=<victim>` read and wrote another merchant's Stripe
 * Connect account. Others simply decoded the JWT and never compared it against
 * the `business_id` in the body at all.
 *
 * Patching eighteen routes individually leaves the shape in place for the
 * nineteenth. This is the one place that answers the question, so a route can
 * be read and audited for whether it calls this — a much easier property to
 * check than whether its particular ownership query is correct.
 *
 * A requested id is always authorized, never merely accepted. When none is
 * requested, it is inferred only if the caller has exactly one business;
 * ambiguity is an error rather than a guess.
 */
export type TenantScope =
  | { ok: true; businessId: string }
  | { ok: false; error: string; status: number };

export async function resolveBusinessScope(
  supabase: SupabaseClient,
  merchantId: string,
  requestedBusinessId: string | null | undefined,
  capability: Capability = 'business.read',
): Promise<TenantScope> {
  const requested = requestedBusinessId?.trim();

  if (requested) {
    const authz = await authorizeBusiness(supabase, merchantId, requested, capability);
    if (!authz.ok) {
      return { ok: false, error: authz.error, status: authz.status };
    }
    return { ok: true, businessId: requested };
  }

  // No business named. Infer it only when there is exactly one candidate.
  //
  // The bug this replaces did something much worse than guessing: it fell back
  // to passing the *merchant* id where a *business* id was expected, so the
  // lookup either silently matched nothing or matched an unrelated row that
  // happened to share the value.
  const roles = await getAccessibleBusinessRoles(supabase, merchantId);
  const ids = [...roles.keys()];

  if (ids.length === 0) {
    return { ok: false, error: 'No business found for this account', status: 404 };
  }
  if (ids.length > 1) {
    return {
      ok: false,
      error: 'business_id is required: this account can access more than one business',
      status: 400,
    };
  }

  const only = ids[0];
  const authz = await authorizeBusiness(supabase, merchantId, only, capability);
  if (!authz.ok) {
    return { ok: false, error: authz.error, status: authz.status };
  }
  return { ok: true, businessId: only };
}
