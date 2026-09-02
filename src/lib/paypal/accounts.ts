import type { SupabaseClient } from '@supabase/supabase-js';
import { encrypt, decrypt, deriveKey } from '@/lib/crypto/encryption';
import { getEncryptionKey } from '@/lib/secrets';
import type { PaypalCallContext, PaypalCredentials, PaypalEnvironment } from './client';
import { getPaypalPlatformConfig } from './platform';

/**
 * The PayPal client secret is encrypted at rest with a per-business derived key
 * so a leaked ENCRYPTION_KEY alone (without the business id) can't decrypt it,
 * mirroring how business webhook secrets are handled.
 */
function secretKeyFor(businessId: string): string {
  return deriveKey(getEncryptionKey(), businessId);
}

export function encryptPaypalSecret(secret: string, businessId: string): string {
  return encrypt(secret, secretKeyFor(businessId));
}

export function decryptPaypalSecret(ciphertext: string, businessId: string): string {
  return decrypt(ciphertext, secretKeyFor(businessId));
}

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
    .select('paypal_client_id, paypal_client_secret_encrypted, environment, connected')
    .eq('business_id', businessId)
    .single();

  if (!account || !account.connected || !account.paypal_client_secret_encrypted) {
    return null;
  }

  return {
    clientId: account.paypal_client_id,
    clientSecret: decryptPaypalSecret(account.paypal_client_secret_encrypted, businessId),
    environment: (account.environment as PaypalEnvironment) || 'live',
  };
}

/** Cheap existence check used by the invoice send/enable flows. */
export async function businessHasPaypal(
  supabase: SupabaseClient,
  businessId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('paypal_accounts')
    .select('business_id, connected')
    .eq('business_id', businessId)
    .single();
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
  /** 400 for "not connected", 409 for "connected but cannot take money yet". */
  status: number;
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
      `connection_mode, paypal_client_id, paypal_client_secret_encrypted,
       merchant_id_in_paypal, payments_receivable, environment, connected`
    )
    .eq('business_id', businessId)
    .maybeSingle();

  const account = data as {
    connection_mode: string | null;
    paypal_client_id: string | null;
    paypal_client_secret_encrypted: string | null;
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
  if (!account.paypal_client_secret_encrypted) {
    return { error: 'Stored PayPal credentials are incomplete', status: 409 };
  }

  return {
    mode: 'self_serve',
    creds: {
      clientId: account.paypal_client_id!,
      clientSecret: decryptPaypalSecret(account.paypal_client_secret_encrypted, businessId),
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
