/**
 * Vault — password-based encryption of the wallet seed (PRD P0-3).
 *
 * Uses WebCrypto only (available in MV3 service workers, extension pages, and
 * Node 20+ via `globalThis.crypto`). No external crypto deps.
 *
 *   KDF:    PBKDF2-HMAC-SHA256, 600k iterations (OWASP 2023 floor), 16-byte salt
 *   Cipher: AES-256-GCM, 12-byte IV
 *
 * The encrypted blob is what lives in `browser.storage.local`. Plaintext seed
 * material only ever exists in memory / `storage.session` while unlocked.
 */

const subtle = globalThis.crypto.subtle;

/**
 * Cast a Uint8Array to BufferSource for WebCrypto. TS 5.7+ types Uint8Array as
 * `Uint8Array<ArrayBufferLike>`, which isn't assignable to `BufferSource`
 * because ArrayBufferLike admits SharedArrayBuffer. At runtime every buffer we
 * pass here is ArrayBuffer-backed (getRandomValues / TextEncoder / atob).
 */
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;

/** Serializable encrypted seed record persisted to storage.local. */
export interface EncryptedVault {
  /** Format version, so we can migrate KDF params later. */
  v: 1;
  kdf: 'PBKDF2';
  hash: 'SHA-256';
  iterations: number;
  /** base64 */
  salt: string;
  /** base64 */
  iv: string;
  /** base64 ciphertext (includes GCM auth tag) */
  ct: string;
}

function toB64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await subtle.importKey(
    'raw',
    bs(new TextEncoder().encode(password)),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: bs(salt), iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt a seed (raw bytes) under a password. */
export async function encryptSeed(seed: Uint8Array, password: string): Promise<EncryptedVault> {
  if (!password) throw new Error('Password required');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: bs(iv) }, key, bs(seed)));
  return {
    v: 1,
    kdf: 'PBKDF2',
    hash: 'SHA-256',
    iterations: PBKDF2_ITERATIONS,
    salt: toB64(salt),
    iv: toB64(iv),
    ct: toB64(ct),
  };
}

/**
 * Decrypt a vault. Throws on wrong password (GCM auth failure) — callers should
 * surface this as "incorrect password" rather than leaking crypto errors.
 */
export async function decryptSeed(vault: EncryptedVault, password: string): Promise<Uint8Array> {
  const salt = fromB64(vault.salt);
  const iv = fromB64(vault.iv);
  const key = await deriveKey(password, salt, vault.iterations);
  try {
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: bs(iv) }, key, bs(fromB64(vault.ct)));
    return new Uint8Array(pt);
  } catch {
    throw new Error('Incorrect password or corrupted vault');
  }
}
