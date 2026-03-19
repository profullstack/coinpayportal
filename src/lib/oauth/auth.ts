/**
 * Shared OAuth authentication utility
 * Supports both JWT Bearer tokens and CoinPay API keys (cp_live_*)
 */
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { isApiKey, validateApiKeyFormat, getBusinessByApiKey } from '@/lib/auth/apikey';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('[OAuth Auth] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return null;
  }
  return createClient(url, key);
}

/**
 * Extract authenticated user from request.
 * Checks (in order):
 *   1. x-api-key header (CoinPay business API key)
 *   2. Authorization: Bearer <api_key>
 *   3. Authorization: Bearer <jwt>
 */
export async function getAuthUser(request: NextRequest): Promise<{ id: string } | null> {
  // 1. Check x-api-key header
  const apiKeyHeader = request.headers.get('x-api-key');
  if (apiKeyHeader) {
    const result = await resolveApiKey(apiKeyHeader);
    if (result) return result;
    // If x-api-key was provided but invalid, don't fall through — it was intentional
    console.warn('[OAuth Auth] x-api-key header provided but failed to resolve');
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.substring(7);

  // 2. If it looks like an API key, resolve via DB
  if (isApiKey(token)) {
    const result = await resolveApiKey(token);
    if (result) return result;
    console.warn('[OAuth Auth] Bearer token looks like API key but failed to resolve');
    return null;
  }

  // 3. Otherwise treat as JWT
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('[OAuth Auth] Missing JWT_SECRET');
      return null;
    }
    const decoded = verifyToken(token, secret);
    if (decoded?.userId) return { id: decoded.userId };
    console.warn('[OAuth Auth] JWT decoded but no userId found');
  } catch (err) {
    console.warn('[OAuth Auth] JWT verification failed:', err instanceof Error ? err.message : err);
  }

  return null;
}

/**
 * Resolve a CoinPay API key to its owning merchant.
 * Uses the same getBusinessByApiKey as the main auth module for consistency.
 */
async function resolveApiKey(apiKey: string): Promise<{ id: string } | null> {
  // Quick format check — accept any string starting with cp_live_
  // (the full validation happens in getBusinessByApiKey)
  if (!apiKey || !apiKey.startsWith('cp_live_')) {
    console.warn('[OAuth Auth] API key does not start with cp_live_');
    return null;
  }

  const supabase = getSupabase();
  if (!supabase) return null;

  const result = await getBusinessByApiKey(supabase, apiKey);

  if (!result.success || !result.business) {
    console.warn('[OAuth Auth] API key lookup failed:', result.error || 'no business found');
    return null;
  }

  if (!result.business.merchant_id) {
    console.warn('[OAuth Auth] Business found but no merchant_id');
    return null;
  }

  return { id: result.business.merchant_id };
}
