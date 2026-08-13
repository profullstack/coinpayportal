/**
 * Authorization for payment-session creation.
 *
 * Creating a checkout session spends a merchant's Stripe account and puts their
 * name on the payment page, so it must be something only that merchant (or the
 * platform itself) can do. This gate accepts three callers:
 *
 *   1. A business API key — the SDKs and the WHMCS/WooCommerce plugins already
 *      send one. It must belong to the business being charged for.
 *   2. A merchant JWT — the dashboard. The merchant needs write access to the
 *      business, directly or through their org/team.
 *   3. INTERNAL_API_KEY — server-to-server, used by the recurring-payment
 *      monitor. Never accepted when the env var is unset or blank.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { authenticateRequest, extractBearerToken, isMerchantAuth } from './middleware';
import { getAccessibleBusinessRoles } from './authz';
import { can } from './permissions';
import { scopesSatisfy } from './scoped-keys';

export type PaymentAuthResult =
  | { ok: true; via: 'api_key' | 'jwt' | 'internal'; merchantId: string | null }
  | { ok: false; status: number; error: string };

/** Accept the key from `Authorization: Bearer` or the `x-api-key` header. */
function tokenFrom(request: NextRequest): string | null {
  const bearer = extractBearerToken(request.headers.get('authorization'));
  if (bearer) return bearer;
  const apiKeyHeader = request.headers.get('x-api-key');
  return apiKeyHeader?.trim() || null;
}

/**
 * Decide whether this request may create a payment session for `businessId`.
 */
export async function authorizePaymentCreation(
  supabase: SupabaseClient,
  request: NextRequest,
  businessId: string
): Promise<PaymentAuthResult> {
  const token = tokenFrom(request);
  if (!token) {
    return { ok: false, status: 401, error: 'Missing API key' };
  }

  // Service-to-service. Compared only when configured, so an unset env var can
  // never turn an empty or absent token into a valid one.
  const internalKey = process.env.INTERNAL_API_KEY;
  if (internalKey && internalKey.trim() && token === internalKey) {
    return { ok: true, via: 'internal', merchantId: null };
  }

  const auth = await authenticateRequest(supabase, `Bearer ${token}`);
  if (!auth.success || !auth.context) {
    return { ok: false, status: 401, error: auth.error || 'Invalid credentials' };
  }

  // Merchant JWT: needs write access to this business.
  if (isMerchantAuth(auth.context)) {
    const merchantId = auth.context.merchantId;
    const roles = await getAccessibleBusinessRoles(supabase, merchantId);
    const role = roles.get(businessId);
    if (!role || !can(role, 'paymentlink.write')) {
      return { ok: false, status: 403, error: 'No access to this business' };
    }
    return { ok: true, via: 'jwt', merchantId };
  }

  // Business API key: must be a key for the business being charged for.
  // Without this check, any valid key on the platform could bill any merchant.
  const context = auth.context;
  if (context.businessId !== businessId) {
    return { ok: false, status: 403, error: 'API key does not belong to this business' };
  }

  if (!scopesSatisfy(context.scopes, 'payments:create')) {
    return { ok: false, status: 403, error: 'API key is missing the payments:create scope' };
  }

  return { ok: true, via: 'api_key', merchantId: context.merchantId };
}
