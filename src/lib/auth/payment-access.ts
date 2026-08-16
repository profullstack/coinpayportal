/**
 * Authorization for acting on an *existing* payment.
 *
 * `authorizePaymentCreation` covers "may this caller create a session for
 * business X". This module covers the other half: "may this caller read or
 * advance payment Y", which is what balance checks, forwards, and status
 * mutations need. Knowing a payment UUID is not authorization — the UUID is
 * handed to the payer, embedded in checkout URLs, and logged.
 *
 * Accepted callers, in order:
 *   1. INTERNAL_API_KEY — the monitor and cron pipeline (constant-time compare).
 *   2. A merchant JWT with access to the payment's business.
 *   3. A business API key issued for the payment's business.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { authenticateRequest, extractBearerToken, isMerchantAuth } from './middleware';
import { getAccessibleBusinessRoles } from './authz';
import { can } from './permissions';
import { isInternalApiKey } from './secret-compare';

export type PaymentAccessResult =
  | { ok: true; via: 'internal' | 'jwt' | 'api_key'; merchantId: string | null }
  | { ok: false; status: number; error: string };

function tokenFrom(request: NextRequest): string | null {
  const bearer = extractBearerToken(request.headers.get('authorization'));
  if (bearer) return bearer;
  return request.headers.get('x-api-key')?.trim() || null;
}

/**
 * Decide whether this request may act on a payment belonging to `businessId`.
 *
 * @param write - when true, a merchant JWT additionally needs write capability.
 *                Balance checks mutate payment state and trigger on-chain
 *                forwarding, so they are write operations.
 */
export async function authorizePaymentAccess(
  supabase: SupabaseClient,
  request: NextRequest,
  businessId: string | null | undefined,
  { write = false }: { write?: boolean } = {}
): Promise<PaymentAccessResult> {
  const token = tokenFrom(request);
  if (!token) {
    return { ok: false, status: 401, error: 'Authentication required' };
  }

  if (isInternalApiKey(token)) {
    return { ok: true, via: 'internal', merchantId: null };
  }

  if (!businessId) {
    // A payment with no owning business can only be touched by the platform.
    return { ok: false, status: 403, error: 'Payment is not owned by a business' };
  }

  const auth = await authenticateRequest(supabase, `Bearer ${token}`);
  if (!auth.success || !auth.context) {
    return { ok: false, status: 401, error: auth.error || 'Invalid credentials' };
  }

  if (isMerchantAuth(auth.context)) {
    const merchantId = auth.context.merchantId;
    const roles = await getAccessibleBusinessRoles(supabase, merchantId);
    const role = roles.get(businessId);
    if (!role) {
      return { ok: false, status: 403, error: 'No access to this payment' };
    }
    if (write && !can(role, 'paymentlink.write')) {
      return { ok: false, status: 403, error: 'Read-only access to this payment' };
    }
    return { ok: true, via: 'jwt', merchantId };
  }

  if (auth.context.businessId !== businessId) {
    return { ok: false, status: 403, error: 'API key does not belong to this payment' };
  }

  return { ok: true, via: 'api_key', merchantId: auth.context.merchantId };
}
