import { decrypt, deriveKey } from '@/lib/crypto/encryption';
import { tryRequireEncryptionKey } from '@/lib/crypto/require-key';

export function resolveWebhookSecret(
  storedSecret: string,
  merchantId?: string | null
): string {
  if (!storedSecret) return storedSecret;

  // Guarded, not just present. Note this function fails OPEN by design — a
  // secret it cannot decrypt is returned unchanged, so delivery continues with
  // a signature the merchant cannot verify rather than failing outright. That
  // behaviour is preserved, but it must not be reached because the key was an
  // all-zero constant that a bare presence check happily accepted.
  const keyResult = tryRequireEncryptionKey('webhook secret');
  if (!keyResult.ok || !merchantId) {
    if (!keyResult.ok) {
      console.error('[Webhook] Cannot decrypt webhook secret:', keyResult.error);
    }
    return storedSecret;
  }
  const encryptionKey = keyResult.key;

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
