/**
 * Swap key sealing and the one-shot legacy migration.
 *
 * Relative imports only, so scripts/seal-legacy-swap-keys.mts can run it under
 * tsx without the `@/` alias.
 */
import { decrypt } from '../crypto/encryption';
import { requireEncryptionKey } from '../crypto/require-key';
import { legacyKeyMigrationEnabled } from '../crypto/legacy-migration';
import { isSealed, sealToWalletKey, swapKeyAad, SWAP_SEAL_VERSION } from './sealed-keys';

/** Fields inside `swaps.provider_data` that are key material. */
export const SECRET_PROVIDER_FIELDS = ['refundPrivateKey', 'claimPrivateKey'] as const;

export { legacyKeyMigrationEnabled };

export interface SwapSealContext {
  walletId: string;
  swapId: string;
  /** `wallets.public_key_secp256k1` of the owning wallet. */
  walletPublicKey: string;
}

/**
 * Seal key material inside a provider_data object to the owning wallet's
 * public key before it is written. Never reads ENCRYPTION_KEY: the server
 * cannot open what it stores.
 */
export async function sealProviderSecrets<T extends Record<string, unknown>>(
  providerData: T,
  ctx: SwapSealContext
): Promise<T> {
  const out: Record<string, unknown> = { ...providerData };
  for (const field of SECRET_PROVIDER_FIELDS) {
    const value = out[field];
    if (typeof value === 'string' && value.length > 0 && !isSealed(value)) {
      out[field] = await sealToWalletKey(ctx.walletPublicKey, value, swapKeyAad(ctx.walletId, ctx.swapId, field));
    }
  }
  return out as T;
}

/** True when provider_data still holds key material a server key (or nothing) protects. */
export function hasLegacyProviderSecrets(providerData: Record<string, unknown>): boolean {
  return SECRET_PROVIDER_FIELDS.some((f) => {
    const v = providerData[f];
    return typeof v === 'string' && v.length > 0 && !isSealed(v);
  });
}

export type ResealResult<T> =
  | { ok: true; providerData: T; changed: boolean }
  | { ok: false; error: string };

/**
 * One-shot migration of a legacy row: open each `enc:` blob under the legacy
 * ENCRYPTION_KEY (or take a pre-encryption plaintext value), re-seal it to the
 * wallet's public key, and return provider_data with no legacy value left in
 * it. The caller writes the result back in the same request.
 *
 * Refuses `enc:` blobs once LEGACY_KEY_MIGRATION=off.
 */
export async function resealLegacyProviderSecrets<T extends Record<string, unknown>>(
  providerData: T,
  ctx: SwapSealContext
): Promise<ResealResult<T>> {
  if (!hasLegacyProviderSecrets(providerData)) {
    return { ok: true, providerData, changed: false };
  }
  const out: Record<string, unknown> = { ...providerData };
  let key: string | null = null;
  for (const field of SECRET_PROVIDER_FIELDS) {
    const value = out[field];
    if (typeof value !== 'string' || value.length === 0 || isSealed(value)) continue;
    let plain: string;
    if (value.startsWith('enc:')) {
      if (!legacyKeyMigrationEnabled()) {
        return {
          ok: false,
          error: 'This swap key was stored under the retired server key and legacy migration is closed.',
        };
      }
      key ??= requireEncryptionKey('legacy swap key migration');
      plain = decrypt(value.slice(4), key);
    } else {
      plain = value;
    }
    out[field] = await sealToWalletKey(ctx.walletPublicKey, plain, swapKeyAad(ctx.walletId, ctx.swapId, field));
    plain = '';
  }
  out.seal_version = SWAP_SEAL_VERSION;
  return { ok: true, providerData: out as T, changed: true };
}

