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
import { encrypt, decrypt } from '@/lib/crypto/encryption';
import { requireEncryptionKey } from '@/lib/crypto/require-key';

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

/** Fields inside `swaps.provider_data` that are key material. */
const SECRET_PROVIDER_FIELDS = ['refundPrivateKey', 'claimPrivateKey'] as const;

/**
 * Encrypt key material inside a provider_data object before it is written.
 *
 * Boltz refund/claim keys were persisted verbatim, so a read of the `swaps`
 * table — via the IDOR above, a backup, or a support query — handed over the
 * keys that redeem the swap. They are encrypted at rest under ENCRYPTION_KEY,
 * which is itself fail-closed.
 */
export function encryptProviderSecrets<T extends Record<string, unknown>>(providerData: T): T {
  const key = requireEncryptionKey('swap key storage');
  const out: Record<string, unknown> = { ...providerData };

  for (const field of SECRET_PROVIDER_FIELDS) {
    const value = out[field];
    if (typeof value === 'string' && value.length > 0) {
      out[field] = `enc:${encrypt(value, key)}`;
    }
  }

  return out as T;
}

/** Reverse of {@link encryptProviderSecrets}; tolerates legacy plaintext rows. */
export function decryptProviderSecrets<T extends Record<string, unknown>>(providerData: T): T {
  const out: Record<string, unknown> = { ...providerData };
  let key: string | null = null;

  for (const field of SECRET_PROVIDER_FIELDS) {
    const value = out[field];
    if (typeof value === 'string' && value.startsWith('enc:')) {
      key ??= requireEncryptionKey('swap key storage');
      out[field] = decrypt(value.slice(4), key);
    }
  }

  return out as T;
}

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
