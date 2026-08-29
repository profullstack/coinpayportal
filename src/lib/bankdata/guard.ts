/**
 * Shared request guard for the bank-data routes.
 *
 * Every route in this feature needs the same four things: the feature switched on, a
 * valid bearer token, a `business_id`, and a capability check on that business. Doing
 * it once here keeps the routes thin and means a future route cannot accidentally ship
 * without the authorization step — the pattern `src/lib/auth/authz.ts` warns about.
 */

import { createClient } from '@supabase/supabase-js';
import { resolveBearerAuth } from '@/lib/auth/bearer';
import { authorizeBusiness } from '@/lib/auth/authz';
import type { Capability } from '@/lib/auth/permissions';
import { isBankDataEnabled } from './index';

// Matches the loose client typing used by the services in this repo (see
// src/lib/payouts/service.ts). The generated generics differ between the client
// `createClient` returns and the one `authorizeBusiness` expects.
type SupabaseClient = any;

export type GuardOk = { ok: true; supabase: SupabaseClient; userId: string };
export type GuardErr = { ok: false; status: number; error: string };
export type GuardResult = GuardOk | GuardErr;

export async function guardBankDataRequest(
  authHeader: string | null,
  businessId: string | null,
  capability: Capability,
): Promise<GuardResult> {
  if (!isBankDataEnabled()) {
    return { ok: false, status: 404, error: 'Bank connections are not enabled' };
  }

  const auth = resolveBearerAuth(authHeader);
  if (!auth.ok) return { ok: false, status: auth.status, error: auth.error };

  if (!businessId) {
    return { ok: false, status: 400, error: 'business_id is required' };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return { ok: false, status: 500, error: 'Server configuration error' };
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const authz = await authorizeBusiness(supabase, auth.userId, businessId, capability);
  if (!authz.ok) return { ok: false, status: authz.status, error: authz.error };

  return { ok: true, supabase, userId: auth.userId };
}
