import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt, deriveKey } from '@/lib/crypto/encryption';
import { legacyKeyMigrationEnabled } from '@/lib/crypto/legacy-migration';
import { getEncryptionKey } from '@/lib/secrets';
import type { PaypalCallContext, PaypalCredentials, PaypalEnvironment } from './client';
import { getPaypalPlatformConfig } from './platform';
import { isPlatformSealed, openPlatformSecret, platformSealConfigured, sealPlatformSecret } from './platform-seal';
import { openMerchantSecret, sealForMerchant } from '@/lib/vault/merchant-secret';
import { hasVault, isSealed, isVaultError, merchantIdForBusiness, VaultMissingError } from '@/lib/vault/vault-service';

/**
 * PayPal REST client secrets of self-serve businesses are stored twice:
 *
 * - `paypal_client_secret_encrypted`: sealed to the business owner's secrets
 *   vault (2026-10-28, `cpv1.`), opens only while the owner has unlocked.
 * - `paypal_client_secret_platform`: sealed under the server key
 *   PAYPAL_SECRETS_KEY (2026-11-22, `ps1:`, see ./platform-seal), opens with no
 *   human step, so a deploy or restart no longer stops PayPal checkout.
 *
 * Reads prefer the platform copy. A row without one opens through the vault
 * (or the legacy server key) and writes its platform copy on that success, so
 * rows migrate themselves. Only a row with no platform copy whose vault is
 * locked still answers 423 "PayPal locked" (or falls back to partner mode).
 *
 * Legacy rows (encrypted under a per-business key derived from ENCRYPTION_KEY)
 * open with that server key while LEGACY_KEY_MIGRATION is on, and are re-sealed
 * to the vault and the platform key on that use.
 *
 * This applies to PayPal API credentials only: wallet keys stay unlock-on-use.
 */
function legacyKeyFor(businessId: string): string {
  return deriveKey(getEncryptionKey(), businessId);
}

function paypalSecretAad(businessId: string): string {
  return `paypal_accounts:${businessId}:client_secret`;
}

/** Legacy decryption, only for migration. */
export function decryptLegacyPaypalSecret(ciphertext: string, businessId: string): string {
  return decrypt(ciphertext, legacyKeyFor(businessId));
}

/** Seal a client secret to the business owner's vault (works while locked). */
export async function sealPaypalSecret(secret: string, businessId: string): Promise<string> {
  const merchantId = await merchantIdForBusiness(businessId);
  if (!merchantId) throw new Error('Business not found');
  return sealForMerchant(merchantId, secret, paypalSecretAad(businessId));
}

/** The platform-key copy of a client secret, or null when PAYPAL_SECRETS_KEY is not configured. */
export function sealPaypalSecretForPlatform(secret: string, businessId: string): string | null {
  if (!platformSealConfigured()) return null;
  return sealPlatformSecret(secret, paypalSecretAad(businessId));
}

/** Both stored forms of a client secret, for the connect flow. */
export async function sealPaypalSecrets(
  secret: string,
  businessId: string,
): Promise<{ vault: string; platform: string | null }> {
  return { vault: await sealPaypalSecret(secret, businessId), platform: sealPaypalSecretForPlatform(secret, businessId) };
}

async function persistPaypalSeal(
  supabase: SupabaseClient,
  businessId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  try {
    const { error } = await supabase.from('paypal_accounts').update(patch).eq('business_id', businessId);
    if (error) console.error('[paypal] could not store the re-sealed secret', businessId, error.message);
  } catch (err) {
    console.error('[paypal] could not store the re-sealed secret', businessId, err instanceof Error ? err.message : err);
  }
}

/**
 * Open a stored client secret: the platform copy when there is one, else the
 * vault copy (writing the platform copy on success). Throws VaultLockedError /
 * VaultMissingError only when there is no usable platform copy and the owner
 * has not unlocked.
 */
export async function openPaypalSecret(
  supabase: SupabaseClient,
  businessId: string,
  stored: string | null,
  platformStored: string | null = null,
): Promise<string> {
  const aad = paypalSecretAad(businessId);
  const platformOn = platformSealConfigured();

  if (platformOn && isPlatformSealed(platformStored)) {
    try {
      return openPlatformSecret(platformStored, aad);
    } catch (err) {
      // Wrong/rotated key or a damaged value: fall back to the vault copy, which re-writes it.
      console.error(
        '[paypal] platform-sealed secret did not open; trying the vault copy',
        businessId,
        err instanceof Error ? err.message : err,
      );
    }
  }
  if (!stored) throw new Error('Stored PayPal credentials are incomplete');

  // Legacy server-key value: open it without the vault and re-seal it both ways.
  if (platformOn && !isSealed(stored) && legacyKeyMigrationEnabled()) {
    const plain = decryptLegacyPaypalSecret(stored, businessId);
    const patch: Record<string, unknown> = { paypal_client_secret_platform: sealPlatformSecret(plain, aad) };
    try {
      const merchantId = await merchantIdForBusiness(businessId);
      if (merchantId && (await hasVault('merchant', merchantId))) {
        patch.paypal_client_secret_encrypted = await sealForMerchant(merchantId, plain, aad);
        patch.seal_version = 2;
      }
    } catch (err) {
      console.error('[paypal] vault re-seal of a legacy secret failed', businessId, err instanceof Error ? err.message : err);
    }
    await persistPaypalSeal(supabase, businessId, patch);
    return plain;
  }

  const merchantId = await merchantIdForBusiness(businessId);
  if (!merchantId) throw new VaultMissingError('merchant');
  const plain = await openMerchantSecret({
    merchantId,
    stored,
    aad,
    legacyDecrypt: (v) => decryptLegacyPaypalSecret(v, businessId),
    persist: (sealed) => persistPaypalSeal(supabase, businessId, { paypal_client_secret_encrypted: sealed, seal_version: 2 }),
  });
  // Self-migration: the next open needs no unlock.
  if (platformOn) {
    await persistPaypalSeal(supabase, businessId, { paypal_client_secret_platform: sealPlatformSecret(plain, aad) });
  }
  return plain;
}

export interface PaypalPlatformSealResult {
  configured: boolean;
  /** Rows with a stored secret. */
  total: number;
  alreadySealed: number;
  migrated: number;
  /** Vault copy only and the owner's vault is locked (or missing): waits for an unlock or the next save. */
  waiting: number;
  failed: number;
  errors: Array<{ businessId: string; error: string }>;
}

/**
 * Write the platform copy for every row whose secret can be opened right now:
 * legacy rows, and vault rows whose owner is unlocked in THIS process. Pass a
 * merchantId to limit it to that merchant's businesses (run on unlock).
 */
export async function migratePaypalSecretsToPlatform(
  supabase: SupabaseClient,
  opts: { merchantId?: string } = {},
): Promise<PaypalPlatformSealResult> {
  const result: PaypalPlatformSealResult = {
    configured: platformSealConfigured(),
    total: 0,
    alreadySealed: 0,
    migrated: 0,
    waiting: 0,
    failed: 0,
    errors: [],
  };
  if (!result.configured) return result;

  let businessIds: string[] | null = null;
  if (opts.merchantId) {
    const { data } = await supabase.from('businesses').select('id').eq('merchant_id', opts.merchantId);
    businessIds = ((data ?? []) as Array<{ id: string }>).map((b) => b.id);
    if (!businessIds.length) return result;
  }
  let query = supabase
    .from('paypal_accounts')
    .select('business_id, paypal_client_secret_encrypted, paypal_client_secret_platform');
  if (businessIds) query = query.in('business_id', businessIds);
  const { data: rows, error } = await query;
  if (error) throw new Error(`Failed to list PayPal accounts: ${error.message}`);

  for (const row of (rows ?? []) as Array<{
    business_id: string;
    paypal_client_secret_encrypted: string | null;
    paypal_client_secret_platform: string | null;
  }>) {
    if (!row.paypal_client_secret_encrypted && !row.paypal_client_secret_platform) continue;
    result.total += 1;
    if (isPlatformSealed(row.paypal_client_secret_platform)) {
      result.alreadySealed += 1;
      continue;
    }
    try {
      await openPaypalSecret(supabase, row.business_id, row.paypal_client_secret_encrypted, null);
      result.migrated += 1;
    } catch (err) {
      if (isVaultError(err)) {
        result.waiting += 1;
      } else {
        result.failed += 1;
        // Never include anything derived from the secret.
        result.errors.push({
          businessId: row.business_id,
          error: err instanceof Error ? err.message.slice(0, 200) : 'unknown error',
        });
      }
    }
  }
  return result;
}

export const PAYPAL_LOCKED_MESSAGE =
  'PayPal locked: the merchant must unlock their secrets vault before PayPal payments can be taken';

/**
 * Resolve a business's connected PayPal credentials (with the secret decrypted),
 * or null when the business has no connected PayPal account. Callers decide
 * whether that's fatal.
 *
 * Self-serve mode only. A partner-onboarded business has no stored secret, so
 * this returns null for one — use `resolvePaypalContext` on any path that must
 * work for both, and keep this for the legacy invoice flows.
 */
export async function getBusinessPaypalCredentials(
  supabase: SupabaseClient,
  businessId: string
): Promise<PaypalCredentials | null> {
  const { data: account } = await supabase
    .from('paypal_accounts')
    .select('paypal_client_id, paypal_client_secret_encrypted, paypal_client_secret_platform, environment, connected')
    .eq('business_id', businessId)
    .single();

  if (!account || !account.connected || (!account.paypal_client_secret_encrypted && !account.paypal_client_secret_platform)) {
    return null;
  }

  let clientSecret: string;
  try {
    clientSecret = await openPaypalSecret(
      supabase,
      businessId,
      account.paypal_client_secret_encrypted,
      account.paypal_client_secret_platform,
    );
  } catch (err) {
    if (isVaultError(err)) return null; // locked: callers already treat null as "not available"
    throw err;
  }
  return {
    clientId: account.paypal_client_id,
    clientSecret,
    environment: (account.environment as PaypalEnvironment) || 'live',
  };
}

/** Cheap existence check used by the invoice send/enable flows. */
export async function businessHasPaypal(
  supabase: SupabaseClient,
  businessId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('paypal_accounts')
    .select('business_id, connected')
    .eq('business_id', businessId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve PayPal account: ${error.message}`);
  }

  return !!data?.connected;
}

export type PaypalConnectionMode = 'partner' | 'self_serve';

/**
 * Everything a payment route needs to talk to PayPal for one business, with the
 * two connection modes already reconciled so callers never branch on mode.
 */
export interface PaypalContext {
  mode: PaypalConnectionMode;
  /** Credentials to authenticate the call: the platform's, or the merchant's. */
  creds: PaypalCredentials;
  /** Headers (auth assertion / BN code) to address the merchant in partner mode. */
  callContext: PaypalCallContext;
  /** Who receives the funds. Null in self-serve — the credentials imply it. */
  payeeMerchantId: string | null;
  /** Who receives the platform fee. Null unless a fee can be charged. */
  platformFeePayeeMerchantId: string | null;
  /**
   * Whether a platform commission can be attached at all.
   *
   * PayPal rejects `platform_fees` on a first-party order, so self-serve is
   * necessarily 0% to CoinPay. This is a real revenue difference between the
   * two modes, not an oversight — surface it in the dashboard rather than
   * quietly charging nothing.
   */
  supportsPlatformFee: boolean;
  /** PayPal's `charges_enabled` equivalent. Self-serve is assumed true. */
  paymentsReceivable: boolean;
  merchantIdInPaypal: string | null;
  environment: PaypalEnvironment;
}

export interface PaypalContextError {
  error: string;
  /** 400 for "not connected", 409 for "connected but cannot take money yet", 423 for "PayPal locked". */
  status: number;
  /** 'paypal_locked' when the owner's secrets vault is locked. */
  code?: string;
}

/**
 * Resolve a business into a ready-to-use PayPal calling context.
 *
 * Returns a `{ error, status }` object rather than throwing, because every
 * caller is an API route that needs to turn the failure into a specific HTTP
 * status. Discriminate with `'error' in result`.
 */
export async function resolvePaypalContext(
  supabase: SupabaseClient,
  businessId: string
): Promise<PaypalContext | PaypalContextError> {
  // Written as one literal, not a concatenation: Supabase parses the select
  // string at the type level and gives up on anything it cannot read statically,
  // which turns every field access below into a GenericStringError.
  const { data } = await supabase
    .from('paypal_accounts')
    .select(
      `connection_mode, paypal_client_id, paypal_client_secret_encrypted, paypal_client_secret_platform,
       merchant_id_in_paypal, payments_receivable, environment, connected`
    )
    .eq('business_id', businessId)
    .maybeSingle();

  const account = data as {
    connection_mode: string | null;
    paypal_client_id: string | null;
    paypal_client_secret_encrypted: string | null;
    paypal_client_secret_platform: string | null;
    merchant_id_in_paypal: string | null;
    payments_receivable: boolean | null;
    environment: string | null;
    connected: boolean | null;
  } | null;

  if (!account || !account.connected) {
    return { error: 'PayPal is not connected for this business', status: 400 };
  }

  const environment = (account.environment as PaypalEnvironment) || 'live';

  // Partner mode: authenticate as the platform, act as the merchant.
  if (account.connection_mode === 'partner') {
    const config = getPaypalPlatformConfig();
    if (!config) {
      return {
        error: 'PayPal partner mode is not configured on this server',
        status: 503,
      };
    }
    if (!account.merchant_id_in_paypal) {
      return {
        error: 'PayPal onboarding has not completed for this business',
        status: 409,
      };
    }
    if (!account.payments_receivable) {
      return {
        error:
          'This PayPal account cannot receive payments yet. Finish onboarding in PayPal and confirm the account email.',
        status: 409,
      };
    }

    return {
      mode: 'partner',
      creds: {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        environment: config.environment,
      },
      callContext: {
        authAssertionMerchantId: account.merchant_id_in_paypal,
        bnCode: config.bnCode,
      },
      payeeMerchantId: account.merchant_id_in_paypal,
      platformFeePayeeMerchantId: config.partnerMerchantId,
      supportsPlatformFee: true,
      paymentsReceivable: true,
      merchantIdInPaypal: account.merchant_id_in_paypal,
      environment: config.environment,
    };
  }

  // Self-serve mode: the merchant's own REST app credentials.
  if (!account.paypal_client_secret_encrypted && !account.paypal_client_secret_platform) {
    return { error: 'Stored PayPal credentials are incomplete', status: 409 };
  }

  let clientSecret: string;
  try {
    clientSecret = await openPaypalSecret(
      supabase,
      businessId,
      account.paypal_client_secret_encrypted,
      account.paypal_client_secret_platform,
    );
  } catch (err) {
    if (!isVaultError(err)) throw err;
    // Locked. A business that also finished partner onboarding can still be
    // paid through the platform's credentials; otherwise PayPal is locked.
    const config = getPaypalPlatformConfig();
    if (config && account.merchant_id_in_paypal && account.payments_receivable) {
      return {
        mode: 'partner',
        creds: { clientId: config.clientId, clientSecret: config.clientSecret, environment: config.environment },
        callContext: { authAssertionMerchantId: account.merchant_id_in_paypal, bnCode: config.bnCode },
        payeeMerchantId: account.merchant_id_in_paypal,
        platformFeePayeeMerchantId: config.partnerMerchantId,
        supportsPlatformFee: true,
        paymentsReceivable: true,
        merchantIdInPaypal: account.merchant_id_in_paypal,
        environment: config.environment,
      };
    }
    return { error: PAYPAL_LOCKED_MESSAGE, status: 423, code: 'paypal_locked' };
  }

  return {
    mode: 'self_serve',
    creds: {
      clientId: account.paypal_client_id!,
      clientSecret,
      environment,
    },
    callContext: {},
    payeeMerchantId: null,
    platformFeePayeeMerchantId: null,
    supportsPlatformFee: false,
    paymentsReceivable: true,
    merchantIdInPaypal: account.merchant_id_in_paypal ?? null,
    environment,
  };
}
