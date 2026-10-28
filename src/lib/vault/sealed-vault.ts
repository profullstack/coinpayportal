/**
 * Secrets vault: user-held sealing for secrets CoinPay must use while the
 * owner is away (fleet rule 2026-10-28, "unlock-on-use").
 *
 * Isomorphic: WebCrypto only, so the browser, Node scripts and the server
 * share one implementation. No server-held key opens anything in here.
 *
 *   passphrase --PBKDF2-SHA256 600k, 16-byte salt--> ikm --HKDF--> KEK
 *   KEK wraps a random 32-byte data key (DEK)              -> wrapped_dek
 *   recovery key --HKDF--> RKEK wraps the same DEK          -> recovery_wrapped_dek
 *   DEK seals a fixed string                                -> key_check
 *   DEK seals the pkcs8 of a P-256 ECDH key pair            -> private_key_sealed
 *   the public half is stored in the clear                  -> public_key
 *
 * Secrets are sealed to the PUBLIC key (ECIES: ephemeral ECDH, HKDF-SHA256,
 * AES-256-GCM, AAD binds subject + field). So the server can store a new
 * secret (a freshly linked bank, a generated payout key) at any time, locked
 * or not, but can only OPEN one after the owner unlocks: the browser or CLI
 * derives the DEK from the passphrase and sends the DEK (never the
 * passphrase); the server checks it against key_check, opens the private key,
 * and keeps that in process memory with a TTL (see unlock-store.ts).
 *
 * Lose the passphrase and the recovery key, and the sealed secrets are gone.
 */

export const VAULT_VERSION = 1 as const;
export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE_LENGTH = 10;
/** Prefix of a value sealed to a vault public key. */
export const SEALED_PREFIX = 'cpv1.';

const IV_BYTES = 12;
const KEY_CHECK_TEXT = 'coinpay-vault-key-check-v1';

export type VaultSubjectType = 'merchant' | 'operator';

export interface CipherBlob {
  /** base64 of ciphertext || 16-byte GCM tag */
  ct: string;
  /** base64, 12 bytes */
  iv: string;
}

export interface VaultKdf {
  alg: 'PBKDF2-SHA256';
  iterations: number;
  /** base64, 16 random bytes */
  salt: string;
}

/** Stored as secret_vaults.record. Nothing in here opens without the passphrase or recovery key. */
export interface VaultRecord {
  v: typeof VAULT_VERSION;
  kdf: VaultKdf;
  wrapped_dek: CipherBlob;
  recovery_wrapped_dek: CipherBlob | null;
  key_check: CipherBlob;
  /** base64 raw (uncompressed, 65 bytes) P-256 public key */
  public_key: string;
  /** pkcs8 P-256 private key, sealed under the DEK */
  private_key_sealed: CipherBlob;
}

type Bytes = Uint8Array<ArrayBuffer>;

const enc = new TextEncoder();
const dec = new TextDecoder();

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error('WebCrypto (crypto.subtle) is not available');
  return c.subtle;
}

function buf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function base64ToBytes(b64: string): Bytes {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function toB64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s: string): Bytes {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

export function randomBytes(n: number): Bytes {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** Best-effort wipe of key material once it is no longer needed. */
export function wipe(bytes: Uint8Array | null | undefined): void {
  if (bytes) bytes.fill(0);
}

/** AAD for vault-internal blobs: binds them to the subject. */
function vaultAad(subjectType: VaultSubjectType, subjectId: string, field: string): Bytes {
  if (!subjectId) throw new Error('subjectId required');
  return enc.encode(`coinpay:vault:${subjectType}:${subjectId}:${field}`);
}

async function gcmEncrypt(key: CryptoKey, plaintext: Uint8Array, ad: Uint8Array): Promise<CipherBlob> {
  const iv = randomBytes(IV_BYTES);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: buf(ad) }, key, buf(plaintext)));
  return { ct: bytesToBase64(ct), iv: bytesToBase64(iv) };
}

async function gcmDecrypt(key: CryptoKey, blob: CipherBlob, ad: Uint8Array): Promise<Bytes> {
  const out = await subtle().decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(blob.iv), additionalData: buf(ad) },
    key,
    buf(base64ToBytes(blob.ct)),
  );
  return new Uint8Array(out);
}

async function aesKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error(`data key must be 32 bytes (got ${raw.length})`);
  return subtle().importKey('raw', buf(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function hkdfAesKey(ikm: Uint8Array, salt: Uint8Array, info: string): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', buf(ikm), 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(enc.encode(info)) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Passphrase -> KEK. PBKDF2-SHA256 (>= 600k) then HKDF, as OpenCreds does. */
export async function deriveKek(passphrase: string, kdf: VaultKdf): Promise<CryptoKey> {
  if (kdf.alg !== 'PBKDF2-SHA256') throw new Error(`unsupported kdf ${kdf.alg}`);
  if (kdf.iterations < MIN_PBKDF2_ITERATIONS) throw new Error('kdf iterations below policy');
  const salt = base64ToBytes(kdf.salt);
  const pw = await subtle().importKey('raw', buf(enc.encode(passphrase.normalize('NFKC'))), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: buf(salt), iterations: kdf.iterations }, pw, 256),
  );
  try {
    return await hkdfAesKey(bits, salt, 'coinpay/vault/kek/v1');
  } finally {
    wipe(bits);
  }
}

const B32 = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789'; // no I L O U

/** 32 random bytes as grouped base32, e.g. ABCD-EFGH-... */
export function encodeRecoveryKey(raw: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of raw) {
    value = ((value << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join('-');
}

export function decodeRecoveryKey(text: string): Bytes {
  const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('invalid recovery key');
    value = ((value << 5) | idx) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (out.length !== 32) throw new Error('invalid recovery key');
  return new Uint8Array(out);
}

async function deriveRecoveryKek(recoveryKey: string): Promise<CryptoKey> {
  const raw = decodeRecoveryKey(recoveryKey);
  try {
    return await hkdfAesKey(raw, enc.encode('coinpay/vault/recovery'), 'coinpay/vault/recovery-kek/v1');
  } finally {
    wipe(raw);
  }
}

/** Create a vault. Returns the record to store, the DEK (to unlock right away) and the recovery key (show once). */
export async function createVault(
  passphrase: string,
  subjectType: VaultSubjectType,
  subjectId: string,
  { withRecoveryKey = true, iterations = PBKDF2_ITERATIONS }: { withRecoveryKey?: boolean; iterations?: number } = {},
): Promise<{ record: VaultRecord; dek: Bytes; recoveryKey: string | null }> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
  }
  const kdf: VaultKdf = { alg: 'PBKDF2-SHA256', iterations, salt: bytesToBase64(randomBytes(16)) };
  const kek = await deriveKek(passphrase, kdf);
  const dek = randomBytes(32);
  const dekKey = await aesKey(dek);

  const pair = (await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const publicRaw = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
  const pkcs8 = new Uint8Array(await subtle().exportKey('pkcs8', pair.privateKey));

  let recoveryKey: string | null = null;
  let recoveryWrapped: CipherBlob | null = null;
  if (withRecoveryKey) {
    const raw = randomBytes(32);
    recoveryKey = encodeRecoveryKey(raw);
    wipe(raw);
    recoveryWrapped = await gcmEncrypt(await deriveRecoveryKek(recoveryKey), dek, vaultAad(subjectType, subjectId, 'recovery_dek'));
  }

  const record: VaultRecord = {
    v: VAULT_VERSION,
    kdf,
    wrapped_dek: await gcmEncrypt(kek, dek, vaultAad(subjectType, subjectId, 'dek')),
    recovery_wrapped_dek: recoveryWrapped,
    key_check: await gcmEncrypt(dekKey, enc.encode(KEY_CHECK_TEXT), vaultAad(subjectType, subjectId, 'key_check')),
    public_key: bytesToBase64(publicRaw),
    private_key_sealed: await gcmEncrypt(dekKey, pkcs8, vaultAad(subjectType, subjectId, 'private_key')),
  };
  wipe(pkcs8);
  return { record, dek, recoveryKey };
}

/** Passphrase -> DEK. Throws "Wrong passphrase" on a bad passphrase. Runs where the passphrase is (browser/CLI). */
export async function unwrapDek(record: VaultRecord, passphrase: string, subjectType: VaultSubjectType, subjectId: string): Promise<Bytes> {
  const kek = await deriveKek(passphrase, record.kdf);
  try {
    return await gcmDecrypt(kek, record.wrapped_dek, vaultAad(subjectType, subjectId, 'dek'));
  } catch {
    throw new Error('Wrong passphrase');
  }
}

/** Recovery key -> DEK. */
export async function unwrapDekWithRecovery(record: VaultRecord, recoveryKey: string, subjectType: VaultSubjectType, subjectId: string): Promise<Bytes> {
  if (!record.recovery_wrapped_dek) throw new Error('This vault has no recovery key');
  const rkek = await deriveRecoveryKek(recoveryKey);
  try {
    return await gcmDecrypt(rkek, record.recovery_wrapped_dek, vaultAad(subjectType, subjectId, 'recovery_dek'));
  } catch {
    throw new Error('Wrong recovery key');
  }
}

/** Re-wrap the same DEK under a new passphrase (sealed secrets are untouched). */
export async function rewrapWithPassphrase(
  record: VaultRecord,
  dek: Uint8Array,
  newPassphrase: string,
  subjectType: VaultSubjectType,
  subjectId: string,
): Promise<VaultRecord> {
  if (newPassphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
  }
  const kdf: VaultKdf = { alg: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS, salt: bytesToBase64(randomBytes(16)) };
  const kek = await deriveKek(newPassphrase, kdf);
  return { ...record, kdf, wrapped_dek: await gcmEncrypt(kek, dek, vaultAad(subjectType, subjectId, 'dek')) };
}

/**
 * Check a presented DEK and open the vault's private key with it. The returned
 * CryptoKey is non-extractable. Throws "Wrong key" when the DEK does not match.
 */
export async function openVaultPrivateKey(
  record: VaultRecord,
  dek: Uint8Array,
  subjectType: VaultSubjectType,
  subjectId: string,
): Promise<CryptoKey> {
  const dekKey = await aesKey(dek);
  try {
    const check = await gcmDecrypt(dekKey, record.key_check, vaultAad(subjectType, subjectId, 'key_check'));
    if (dec.decode(check) !== KEY_CHECK_TEXT) throw new Error('mismatch');
  } catch {
    throw new Error('Wrong key');
  }
  const pkcs8 = await gcmDecrypt(dekKey, record.private_key_sealed, vaultAad(subjectType, subjectId, 'private_key'));
  try {
    return await subtle().importKey('pkcs8', buf(pkcs8), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  } finally {
    wipe(pkcs8);
  }
}

/** Structural check of a record a client submits. Throws with a reason. */
export function assertVaultRecord(value: unknown): asserts value is VaultRecord {
  const r = value as Partial<VaultRecord> | null;
  const blob = (b: unknown) =>
    !!b && typeof (b as CipherBlob).ct === 'string' && typeof (b as CipherBlob).iv === 'string' && (b as CipherBlob).ct.length < 4096;
  if (!r || typeof r !== 'object') throw new Error('record must be an object');
  if (r.v !== VAULT_VERSION) throw new Error('unsupported vault version');
  if (!r.kdf || r.kdf.alg !== 'PBKDF2-SHA256' || typeof r.kdf.salt !== 'string') throw new Error('invalid kdf');
  if (!Number.isInteger(r.kdf.iterations) || r.kdf.iterations < MIN_PBKDF2_ITERATIONS || r.kdf.iterations > 10_000_000) {
    throw new Error(`kdf iterations must be at least ${MIN_PBKDF2_ITERATIONS}`);
  }
  if (base64ToBytes(r.kdf.salt).length < 16) throw new Error('kdf salt must be at least 16 bytes');
  if (!blob(r.wrapped_dek) || !blob(r.key_check) || !blob(r.private_key_sealed)) throw new Error('missing sealed fields');
  if (r.recovery_wrapped_dek !== null && !blob(r.recovery_wrapped_dek)) throw new Error('invalid recovery field');
  if (typeof r.public_key !== 'string' || base64ToBytes(r.public_key).length !== 65) throw new Error('invalid public key');
}

// ---------------------------------------------------------------------------
// Sealing to the vault public key (ECIES)
// ---------------------------------------------------------------------------

async function ecdhAesKey(privateKey: CryptoKey, publicKey: CryptoKey, epkRaw: Uint8Array): Promise<CryptoKey> {
  const shared = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256));
  try {
    return await hkdfAesKey(shared, epkRaw, 'coinpay/vault/seal/v1');
  } finally {
    wipe(shared);
  }
}

function sealAad(aad: string): Bytes {
  if (!aad) throw new Error('aad required');
  return enc.encode(`coinpay:sealed:${aad}`);
}

/** Seal bytes to a vault public key. Output: `cpv1.<epk>.<iv>.<ct>` (base64url). */
export async function sealBytesToPublicKey(publicKeyB64: string, plaintext: Uint8Array, aad: string): Promise<string> {
  const recipient = await subtle().importKey('raw', buf(base64ToBytes(publicKeyB64)), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const eph = (await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const epkRaw = new Uint8Array(await subtle().exportKey('raw', eph.publicKey));
  const key = await ecdhAesKey(eph.privateKey, recipient, epkRaw);
  const iv = randomBytes(IV_BYTES);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: buf(sealAad(aad)) }, key, buf(plaintext)));
  return `${SEALED_PREFIX}${toB64Url(epkRaw)}.${toB64Url(iv)}.${toB64Url(ct)}`;
}

export async function sealToPublicKey(publicKeyB64: string, plaintext: string, aad: string): Promise<string> {
  return sealBytesToPublicKey(publicKeyB64, enc.encode(plaintext), aad);
}

export function isSealed(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(SEALED_PREFIX);
}

/** Open a value sealed to the vault whose private key is given. Throws on a wrong key, AAD or tampering. */
export async function openSealedBytes(privateKey: CryptoKey, sealed: string, aad: string): Promise<Bytes> {
  if (!isSealed(sealed)) throw new Error('not a sealed value');
  const parts = sealed.slice(SEALED_PREFIX.length).split('.');
  if (parts.length !== 3) throw new Error('malformed sealed value');
  const [epkS, ivS, ctS] = parts;
  const epkRaw = fromB64Url(epkS);
  const epk = await subtle().importKey('raw', buf(epkRaw), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const key = await ecdhAesKey(privateKey, epk, epkRaw);
  const out = await subtle().decrypt(
    { name: 'AES-GCM', iv: buf(fromB64Url(ivS)), additionalData: buf(sealAad(aad)) },
    key,
    buf(fromB64Url(ctS)),
  );
  return new Uint8Array(out);
}

export async function openSealed(privateKey: CryptoKey, sealed: string, aad: string): Promise<string> {
  return dec.decode(await openSealedBytes(privateKey, sealed, aad));
}

// Binary form, for files: MAGIC(5) | epk(65) | iv(12) | ciphertext+tag
const BINARY_MAGIC = enc.encode('CPVB1');

export function isSealedBinary(data: Uint8Array): boolean {
  if (data.length < BINARY_MAGIC.length + 65 + IV_BYTES + 16) return false;
  for (let i = 0; i < BINARY_MAGIC.length; i++) if (data[i] !== BINARY_MAGIC[i]) return false;
  return true;
}

export async function sealBinaryToPublicKey(publicKeyB64: string, plaintext: Uint8Array, aad: string): Promise<Bytes> {
  const recipient = await subtle().importKey('raw', buf(base64ToBytes(publicKeyB64)), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const eph = (await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const epkRaw = new Uint8Array(await subtle().exportKey('raw', eph.publicKey));
  const key = await ecdhAesKey(eph.privateKey, recipient, epkRaw);
  const iv = randomBytes(IV_BYTES);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: buf(sealAad(aad)) }, key, buf(plaintext)));
  const out = new Uint8Array(BINARY_MAGIC.length + epkRaw.length + iv.length + ct.length);
  out.set(BINARY_MAGIC, 0);
  out.set(epkRaw, BINARY_MAGIC.length);
  out.set(iv, BINARY_MAGIC.length + epkRaw.length);
  out.set(ct, BINARY_MAGIC.length + epkRaw.length + iv.length);
  return out;
}

export async function openSealedBinary(privateKey: CryptoKey, data: Uint8Array, aad: string): Promise<Bytes> {
  if (!isSealedBinary(data)) throw new Error('not a sealed binary value');
  let o = BINARY_MAGIC.length;
  const epkRaw = data.slice(o, o + 65);
  o += 65;
  const iv = data.slice(o, o + IV_BYTES);
  o += IV_BYTES;
  const ct = data.slice(o);
  const epk = await subtle().importKey('raw', buf(epkRaw), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const key = await ecdhAesKey(privateKey, epk, epkRaw);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: buf(sealAad(aad)) }, key, buf(ct)));
}
