import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Platform seal for PayPal REST client secrets (2026-11-22).
 *
 * PayPal secrets are receive-side API credentials: they let CoinPay create and
 * capture orders INTO the merchant's PayPal account, never move money out of it.
 * Sealing them only to the merchant's secrets vault meant every deploy/restart
 * (which drops in-memory unlocks) stopped PayPal checkout until a human unlocked.
 * Anthony decided payments must work with no human step, so each secret also
 * gets a copy sealed under a server key, PAYPAL_SECRETS_KEY.
 *
 * Scope: PayPal API credentials ONLY. Wallet private keys, signing keys and
 * mnemonics stay unlock-on-use in the merchant/operator vaults.
 *
 * Format: `ps1:` + base64(iv[12] | ciphertext | tag[16]), AES-256-GCM, with
 * AAD binding the value to its business row so a copy pasted onto another
 * business fails to open.
 */

export const PLATFORM_SEAL_PREFIX = 'ps1:';
const KEY_ENV = 'PAYPAL_SECRETS_KEY';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Read at call time, by computed name: Next.js inlines `process.env.LITERAL` at build. */
function readKey(): Buffer | null {
  const raw = (process.env[KEY_ENV] ?? '').trim();
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`${KEY_ENV} must be 32 bytes, base64 encoded (openssl rand -base64 32)`);
  }
  return key;
}

/** Whether the server has a platform key. Malformed counts as not configured (and is logged). */
export function platformSealConfigured(): boolean {
  try {
    return readKey() !== null;
  } catch (err) {
    console.error('[paypal] platform seal disabled:', err instanceof Error ? err.message : err);
    return false;
  }
}

export function isPlatformSealed(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith(PLATFORM_SEAL_PREFIX);
}

function requireKey(): Buffer {
  const key = readKey();
  if (!key) throw new Error(`${KEY_ENV} is not configured`);
  return key;
}

export function sealPlatformSecret(plaintext: string, aad: string): string {
  const key = requireKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PLATFORM_SEAL_PREFIX + Buffer.concat([iv, ct, tag]).toString('base64');
}

/** Throws on a wrong key, wrong AAD or a tampered value (GCM tag mismatch). */
export function openPlatformSecret(sealed: string, aad: string): string {
  if (!isPlatformSealed(sealed)) throw new Error('Not a platform-sealed value');
  const key = requireKey();
  const buf = Buffer.from(sealed.slice(PLATFORM_SEAL_PREFIX.length), 'base64');
  if (buf.length < IV_BYTES + TAG_BYTES) throw new Error('Platform-sealed value is truncated');
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const ct = buf.subarray(IV_BYTES, buf.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
