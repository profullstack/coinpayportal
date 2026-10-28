/**
 * Seal swap key material to the owning web wallet's own public key.
 *
 * Boltz refund/claim private keys used to be stored as `enc:` blobs under
 * ENCRYPTION_KEY, a master key the server holds 24/7. Anyone with root on the
 * box could open every stored key. That is the bug the 2026-10-28 fleet rule
 * ("unlock-on-use") forbids: nothing stored on our servers may decrypt a key
 * that belongs to a user.
 *
 * The web wallet is non-custodial: its seed lives only in the browser and the
 * server stores just `wallets.public_key_secp256k1` (the m/44'/60'/0' account
 * key, see src/lib/web-wallet/keys.ts). So the server seals each swap key to
 * that public key (ECIES): an ephemeral secp256k1 key, ECDH, HKDF-SHA256 and
 * AES-256-GCM with AAD binding wallet id, swap id and field name. Only the
 * holder of the wallet seed can open it; the server cannot, with or without
 * any env var.
 *
 * Browser-safe: noble-curves plus WebCrypto, no Node built-ins, so the wallet
 * UI and SDK can import `openWithWalletKey` directly.
 */

import { secp256k1 } from '@noble/curves/secp256k1';

/** Prefix of a sealed value. The version is in the prefix, not a separate field. */
export const SEALED_PREFIX = 'sealed1:';

/** `swaps.seal_version` for rows whose key material no server key can open. */
export const SWAP_SEAL_VERSION = 2;

/** Scheme name returned to clients so they know how to open a blob. */
export const SEAL_SCHEME = 'ecies-secp256k1-hkdf-sha256-aes256gcm/v1';

const HKDF_INFO = new TextEncoder().encode('coinpay/swap-key-seal/v1');
const IV_BYTES = 12;

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('WebCrypto is not available');
  return s;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error('Invalid hex');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function aesKey(sharedX: Uint8Array, ephPub: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  const ikm = await subtle().importKey('raw', sharedX as BufferSource, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: ephPub as BufferSource, info: HKDF_INFO as BufferSource },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage]
  );
}

/** AAD for one swap key: binds the blob to its wallet, swap and field. */
export function swapKeyAad(walletId: string, swapId: string, field: string): string {
  return `coinpay:swap-key:${walletId}:${swapId}:${field}`;
}

export function isSealed(value: unknown): value is `sealed1:${string}` {
  return typeof value === 'string' && value.startsWith(SEALED_PREFIX);
}

/**
 * Seal `plaintext` so only the holder of the private key behind
 * `walletPublicKeyHex` (33-byte compressed secp256k1, hex) can open it.
 */
export async function sealToWalletKey(walletPublicKeyHex: string, plaintext: string, aad: string): Promise<string> {
  const walletPub = hexToBytes(walletPublicKeyHex);
  if (!secp256k1.utils.isValidPublicKey(walletPub, true)) {
    throw new Error('Wallet secp256k1 public key is not a valid compressed point');
  }
  const eph = secp256k1.utils.randomSecretKey();
  const ephPub = secp256k1.getPublicKey(eph, true);
  const shared = secp256k1.getSharedSecret(eph, walletPub, true).slice(1);
  eph.fill(0);

  const key = await aesKey(shared, ephPub, 'encrypt');
  shared.fill(0);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(
    await subtle().encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: new TextEncoder().encode(aad) as BufferSource },
      key,
      new TextEncoder().encode(plaintext) as BufferSource
    )
  );
  return `${SEALED_PREFIX}${b64url(ephPub)}.${b64url(iv)}.${b64url(ct)}`;
}

/**
 * Open a sealed value with the wallet's secp256k1 private key (hex). Runs in
 * the browser / wallet SDK; the server never has this key.
 *
 * @throws on a wrong key, a wrong AAD or a tampered blob.
 */
export async function openWithWalletKey(walletPrivateKeyHex: string, sealed: string, aad: string): Promise<string> {
  if (!isSealed(sealed)) throw new Error('Not a sealed value');
  const parts = sealed.slice(SEALED_PREFIX.length).split('.');
  if (parts.length !== 3) throw new Error('Malformed sealed value');
  const [ephPub, iv, ct] = parts.map(fromB64url);

  const priv = hexToBytes(walletPrivateKeyHex);
  const shared = secp256k1.getSharedSecret(priv, ephPub, true).slice(1);
  const key = await aesKey(shared, ephPub, 'decrypt');
  shared.fill(0);
  const plain = await subtle().decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: new TextEncoder().encode(aad) as BufferSource },
    key,
    ct as BufferSource
  );
  return new TextDecoder().decode(plain);
}
