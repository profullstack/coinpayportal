/**
 * Merchant secrets vault, from the CLI.
 *
 * The same scheme as the dashboard's /dashboard/vault (src/lib/vault/sealed-vault.ts,
 * WebCrypto only, so this is a line-for-line port): the passphrase stays on this
 * machine. Create builds the vault record here and sends only the record; unlock
 * derives the data key (DEK) here and sends only the DEK, which the server checks
 * against key_check and keeps in memory for a TTL (default 8 h, max 168 h).
 *
 *   passphrase --PBKDF2-SHA256 600k--> ikm --HKDF--> KEK
 *   KEK wraps a random 32-byte DEK                 -> wrapped_dek
 *   recovery key --HKDF--> RKEK wraps the same DEK -> recovery_wrapped_dek
 *   DEK seals a fixed string                       -> key_check
 *   DEK seals a P-256 private key (pkcs8)          -> private_key_sealed
 *
 * The API refuses apps signed in with CoinPay (OAuth), so these calls need a
 * business API key (COINPAY_API_KEY or `coinpay config set-key`); the vault they
 * reach is the key owner's.
 */

export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE_LENGTH = 10;
const KEY_CHECK_TEXT = 'coinpay-vault-key-check-v1';
const IV_BYTES = 12;
const B32 = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';

const enc = new TextEncoder();

function subtle() {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error('WebCrypto (crypto.subtle) is not available: use Node 20 or newer');
  return c.subtle;
}

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

function randomBytes(n) {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

function vaultAad(subjectType, subjectId, field) {
  if (!subjectId) throw new Error('subjectId required');
  return enc.encode(`coinpay:vault:${subjectType}:${subjectId}:${field}`);
}

async function gcmEncrypt(key, plaintext, ad) {
  const iv = randomBytes(IV_BYTES);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: ad }, key, plaintext));
  return { ct: b64(ct), iv: b64(iv) };
}

async function gcmDecrypt(key, blob, ad) {
  return new Uint8Array(
    await subtle().decrypt({ name: 'AES-GCM', iv: unb64(blob.iv), additionalData: ad }, key, unb64(blob.ct)),
  );
}

async function aesKey(raw) {
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function hkdfAesKey(ikm, salt, info) {
  const base = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function deriveKek(passphrase, kdf) {
  if (kdf.alg !== 'PBKDF2-SHA256') throw new Error(`unsupported kdf ${kdf.alg}`);
  const salt = unb64(kdf.salt);
  const pw = await subtle().importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: kdf.iterations }, pw, 256),
  );
  try {
    return await hkdfAesKey(bits, salt, 'coinpay/vault/kek/v1');
  } finally {
    bits.fill(0);
  }
}

export function encodeRecoveryKey(raw) {
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
  return out.match(/.{1,4}/g).join('-');
}

export function decodeRecoveryKey(text) {
  const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
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

async function deriveRecoveryKek(recoveryKey) {
  const raw = decodeRecoveryKey(recoveryKey);
  try {
    return await hkdfAesKey(raw, enc.encode('coinpay/vault/recovery'), 'coinpay/vault/recovery-kek/v1');
  } finally {
    raw.fill(0);
  }
}

/** Build a vault record. Returns { record, dek, recoveryKey }; only `record` goes to the server. */
export async function createVaultRecord(passphrase, subjectId, { subjectType = 'merchant', withRecoveryKey = true } = {}) {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
  }
  const kdf = { alg: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS, salt: b64(randomBytes(16)) };
  const kek = await deriveKek(passphrase, kdf);
  const dek = randomBytes(32);
  const dekKey = await aesKey(dek);
  const pair = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicRaw = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
  const pkcs8 = new Uint8Array(await subtle().exportKey('pkcs8', pair.privateKey));

  let recoveryKey = null;
  let recoveryWrapped = null;
  if (withRecoveryKey) {
    const raw = randomBytes(32);
    recoveryKey = encodeRecoveryKey(raw);
    raw.fill(0);
    recoveryWrapped = await gcmEncrypt(await deriveRecoveryKek(recoveryKey), dek, vaultAad(subjectType, subjectId, 'recovery_dek'));
  }
  const record = {
    v: 1,
    kdf,
    wrapped_dek: await gcmEncrypt(kek, dek, vaultAad(subjectType, subjectId, 'dek')),
    recovery_wrapped_dek: recoveryWrapped,
    key_check: await gcmEncrypt(dekKey, enc.encode(KEY_CHECK_TEXT), vaultAad(subjectType, subjectId, 'key_check')),
    public_key: b64(publicRaw),
    private_key_sealed: await gcmEncrypt(dekKey, pkcs8, vaultAad(subjectType, subjectId, 'private_key')),
  };
  pkcs8.fill(0);
  return { record, dek, recoveryKey };
}

/** Passphrase (or recovery key) -> DEK, checked against key_check before anything is sent. */
export async function unwrapDek(record, subjectId, { passphrase, recoveryKey, subjectType = 'merchant' } = {}) {
  let dek;
  if (recoveryKey) {
    if (!record.recovery_wrapped_dek) throw new Error('This vault has no recovery key');
    try {
      dek = await gcmDecrypt(await deriveRecoveryKek(recoveryKey), record.recovery_wrapped_dek, vaultAad(subjectType, subjectId, 'recovery_dek'));
    } catch {
      throw new Error('Wrong recovery key');
    }
  } else {
    try {
      dek = await gcmDecrypt(await deriveKek(passphrase ?? '', record.kdf), record.wrapped_dek, vaultAad(subjectType, subjectId, 'dek'));
    } catch {
      throw new Error('Wrong passphrase');
    }
  }
  const check = await gcmDecrypt(await aesKey(dek), record.key_check, vaultAad(subjectType, subjectId, 'key_check'));
  if (new TextDecoder().decode(check) !== KEY_CHECK_TEXT) throw new Error('Vault key check failed');
  return dek;
}

/** GET /vault: { subject_id, exists, record, unlocked, expiresAt }. */
export function getVault(client) {
  return client.request('/vault', { headers: { 'Cache-Control': 'no-store' } });
}

/** Create the vault and unlock it right away. Returns { recoveryKey, migrated, expiresAt }. */
export async function initVault(client, { passphrase, withRecoveryKey = true, ttlHours = 8 } = {}) {
  const status = await getVault(client);
  if (status.exists) throw new Error('This account already has a secrets vault: use `coinpay vault unlock`');
  const { record, dek, recoveryKey } = await createVaultRecord(passphrase, status.subject_id, { withRecoveryKey });
  const created = await client.request('/vault', { method: 'POST', body: JSON.stringify({ record }) });
  try {
    const unlocked = await client.request('/vault/unlock', {
      method: 'POST',
      body: JSON.stringify({ data_key: b64(dek), ttl_hours: ttlHours }),
    });
    return { recoveryKey, migrated: created.migrated ?? null, expiresAt: unlocked.expiresAt };
  } finally {
    dek.fill(0);
  }
}

/** Unlock with the passphrase or recovery key for ttlHours (1..168). */
export async function unlockVault(client, { passphrase, recoveryKey, ttlHours = 8 } = {}) {
  const status = await getVault(client);
  if (!status.exists) throw new Error('No secrets vault yet: run `coinpay vault init`');
  const dek = await unwrapDek(status.record, status.subject_id, { passphrase, recoveryKey });
  try {
    return await client.request('/vault/unlock', {
      method: 'POST',
      body: JSON.stringify({ data_key: b64(dek), ttl_hours: ttlHours }),
    });
  } finally {
    dek.fill(0);
  }
}

export function lockVault(client) {
  return client.request('/vault/lock', { method: 'POST', body: '{}' });
}

/** GET (create=false) or POST (create=true) /businesses/:id/payout-wallet. */
export function payoutWallet(client, businessId, { create = false } = {}) {
  return client.request(`/businesses/${encodeURIComponent(businessId)}/payout-wallet`, create ? { method: 'POST', body: '{}' } : {});
}
