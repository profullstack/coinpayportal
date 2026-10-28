import { legacyKeyMigrationEnabled } from '../crypto/legacy-migration';
import {
  hasVault,
  isSealed,
  merchantUnlocked,
  openForMerchant,
  sealForMerchant,
  VaultLockedError,
  VaultMissingError,
} from './vault-service';

/**
 * One merchant secret column: sealed to the merchant's vault (`cpv1.`), or a
 * legacy value under a server key that is re-sealed the first time it is used
 * while unlocked.
 *
 * Opening ALWAYS needs the merchant's unlock, legacy or not: a feature that
 * runs on these secrets (bank sync, payouts, PayPal REST) runs only while the
 * merchant has unlocked. A merchant with no vault yet gets VaultMissingError,
 * which callers surface as "set up your secrets vault".
 */
export async function openMerchantSecret(params: {
  merchantId: string;
  stored: string;
  aad: string;
  /** Decrypts a legacy (server-key) value. */
  legacyDecrypt: (stored: string) => string;
  /** Writes the re-sealed value back. Best effort. */
  persist: (sealed: string) => Promise<unknown>;
}): Promise<string> {
  const { merchantId, stored, aad } = params;
  if (isSealed(stored)) return openForMerchant(merchantId, stored, aad);

  if (!(await hasVault('merchant', merchantId))) throw new VaultMissingError('merchant');
  if (!merchantUnlocked(merchantId)) throw new VaultLockedError('merchant');
  if (!legacyKeyMigrationEnabled()) {
    throw new Error('This secret predates the secrets vault and the legacy migration window is closed; connect it again');
  }
  const plain = params.legacyDecrypt(stored);
  try {
    await params.persist(await sealForMerchant(merchantId, plain, aad));
  } catch (err) {
    console.error('[vault] re-seal of a legacy secret failed', err instanceof Error ? err.message : err);
  }
  return plain;
}

export { sealForMerchant };
