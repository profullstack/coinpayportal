import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';
import { isApiKey, getBusinessByApiKey } from '@/lib/auth/apikey';

export type ResolvedMerchant = {
  merchantId: string;
  apiKeyBusinessId: string | null;
};

export type ResolveError = { error: string; status: number };

/**
 * Resolve the authenticated merchant from a request.
 *
 * Accepts (in order):
 *   1. `x-api-key: cp_live_...`
 *   2. `Authorization: Bearer cp_live_...`
 *   3. `Authorization: Bearer <jwt>`
 *
 * For API key auth, `apiKeyBusinessId` is the business that owns the key —
 * callers can use it to lock writes to that business and reject mismatched
 * `business_id` in the request body.
 */
export async function resolveMerchant(
  supabase: SupabaseClient,
  request: NextRequest
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

  const jwtSecret = getJwtSecret();
  if (!jwtSecret) {
    return { error: 'Server configuration error', status: 500 };
  }

  try {
    const decoded = verifyToken(token, jwtSecret);
    if (!decoded?.userId) {
      return { error: 'Invalid token', status: 401 };
    }
    return { merchantId: decoded.userId, apiKeyBusinessId: null };
  } catch {
    return { error: 'Invalid token', status: 401 };
  }
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
  };
}
