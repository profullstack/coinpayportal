/**
 * Authorization for swap endpoints.
 *
 * Every swap row belongs to a web-wallet (`swaps.wallet_id`). The swap routes
 * used to take `walletId` from the query string or request body and trust it,
 * so anyone could list another wallet's swap history — and, because Boltz
 * refund/claim keys were stored alongside, read key material with it.
 *
 * The wallet id now always comes from the authenticated context. A caller can
 * only ever address the wallet they signed for.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { authenticateWalletRequest } from '@/lib/web-wallet/auth';
import { SECRET_PROVIDER_FIELDS } from './legacy-reseal';

export type SwapAuthResult =
  | { ok: true; walletId: string }
  | { ok: false; status: number; error: string };

/**
 * Authenticate the caller and return the wallet id they are entitled to act as.
 *
 * @param body - the raw request body string, needed for signature auth so the
 *               signature covers the payload and not just the path.
 */
export async function authorizeWallet(
  supabase: SupabaseClient,
  request: NextRequest,
  body?: string
): Promise<SwapAuthResult> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return { ok: false, status: 401, error: 'Authentication required' };
  }

  const result = await authenticateWalletRequest(
    supabase,
    authHeader,
    request.method,
    new URL(request.url).pathname,
    body
  );

  if (!result.success || !result.walletId) {
    return { ok: false, status: 401, error: result.error || 'Invalid wallet credentials' };
  }

  return { ok: true, walletId: result.walletId };
}

export {
  SECRET_PROVIDER_FIELDS,
  legacyKeyMigrationEnabled,
  sealProviderSecrets,
  hasLegacyProviderSecrets,
  resealLegacyProviderSecrets,
} from './legacy-reseal';
export type { SwapSealContext, ResealResult } from './legacy-reseal';

/**
 * Strip key material entirely. Used for any response that is not being handed
 * back to the wallet that owns the swap.
 */
export function stripProviderSecrets<T extends Record<string, unknown>>(providerData: T): T {
  const out: Record<string, unknown> = { ...providerData };
  for (const field of SECRET_PROVIDER_FIELDS) {
    delete out[field];
  }
  return out as T;
}
