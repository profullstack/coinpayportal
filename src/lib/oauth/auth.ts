/**
 * Shared OAuth authentication utility
 * Supports both JWT Bearer tokens and CoinPay API keys (cp_live_*)
 */
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { isApiKey } from '@/lib/auth/apikey';

/**
 * Extract authenticated user from request.
 * Checks (in order):
 *   1. x-api-key header (CoinPay business API key)
 *   2. Authorization: Bearer <jwt>
 *   3. Authorization: Bearer <api_key>
 */
export async function getAuthUser(request: NextRequest): Promise<{ id: string } | null> {
  // 1. Check x-api-key header
  const apiKeyHeader = request.headers.get('x-api-key');
  if (apiKeyHeader && isApiKey(apiKeyHeader)) {
    return resolveApiKey(apiKeyHeader);
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.substring(7);

  // 2. If it looks like an API key, resolve via DB
  if (isApiKey(token)) {
    return resolveApiKey(token);
  }

  // 3. Otherwise treat as JWT
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) return null;
    const decoded = verifyToken(token, secret);
    if (decoded?.userId) return { id: decoded.userId };
  } catch {
    // invalid
  }

  return null;
}

/**
 * Resolve a CoinPay API key to its owning merchant
 */
async function resolveApiKey(apiKey: string): Promise<{ id: string } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const supabase = createClient(url, key);
  const { data: business, error } = await supabase
    .from('businesses')
    .select('merchant_id')
    .eq('api_key', apiKey)
    .eq('active', true)
    .single();

  if (error || !business?.merchant_id) return null;
  return { id: business.merchant_id };
}
