/**
 * Browser-side passphrase encryption for OAuth client secrets.
 *
 * Format of the ciphertext we hand to the server:
 *   "v1:<base64-salt>:<base64-iv>:<base64-ciphertext-with-gcm-tag>"
 *
 *  - salt: 16 random bytes, fed into PBKDF2(SHA-256, 200_000 iters) to
 *    derive a 256-bit key.
 *  - iv: 12 random bytes, the AES-GCM nonce.
 *  - ciphertext: AES-256-GCM output (16-byte authentication tag is
 *    appended by WebCrypto, so this is plaintext.length + 16 bytes).
 *
 * The server treats the whole string as opaque; only the browser can
 * derive the key (it never sees the passphrase).
 */

const VERSION = 'v1' as const;
const PBKDF2_ITERATIONS = 200_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;

/**
 * Cast a Uint8Array to a non-shared BufferSource. WebCrypto's TS types
 * disallow SharedArrayBuffer-backed buffers; we always allocate from a
 * regular ArrayBuffer so this is safe.
 */
function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: asBufferSource(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptClientSecret(plaintext: string, passphrase: string): Promise<string> {
  if (!plaintext) throw new Error('plaintext is empty');
  if (!passphrase) throw new Error('passphrase is empty');

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: asBufferSource(iv) },
      key,
      asBufferSource(new TextEncoder().encode(plaintext)),
    ),
  );
  return `${VERSION}:${bytesToB64(salt)}:${bytesToB64(iv)}:${bytesToB64(ciphertext)}`;
}

export async function decryptClientSecret(ciphertext: string, passphrase: string): Promise<string> {
  const parts = ciphertext.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Unsupported ciphertext format');
  }
  const [, saltB64, ivB64, ctB64] = parts;
  const key = await deriveKey(passphrase, b64ToBytes(saltB64));
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: asBufferSource(b64ToBytes(ivB64)) },
      key,
      asBufferSource(b64ToBytes(ctB64)),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error('Wrong passphrase');
  }
}
