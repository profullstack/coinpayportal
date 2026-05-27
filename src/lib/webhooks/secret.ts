import { decrypt, deriveKey } from '@/lib/crypto/encryption';

export function resolveWebhookSecret(
  storedSecret: string,
  merchantId?: string | null
): string {
  if (!storedSecret) return storedSecret;

  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey || !merchantId) return storedSecret;

  try {
    const derivedKey = deriveKey(encryptionKey, merchantId);
    return decrypt(storedSecret, derivedKey);
  } catch (error) {
    if (storedSecret.includes(':')) {
      console.warn('[Webhook] Failed to decrypt webhook_secret, falling back to stored value:', error);
    }
    return storedSecret;
  }
}
