import type { SupabaseClient } from '@supabase/supabase-js';
import { encrypt, decrypt, deriveKey } from '@/lib/crypto/encryption';
import { getEncryptionKey } from '@/lib/secrets';
import type { PaypalCredentials, PaypalEnvironment } from './client';

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

  if (!account || !account.connected) {
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
