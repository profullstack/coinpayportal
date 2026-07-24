/**
 * Private-key derivation for signing (PRD §9: background context only).
 *
 * `derivation.ts` gets ADDRESSES from the audited `@profullstack/coinpay` SDK,
 * but the SDK deliberately keeps private keys internal — it exports
 * `deriveAddress`, not `deriveKeyPair`. To sign we need the key itself, so this
 * module reimplements the SDK's derivation recipe verbatim:
 *
 *   secp256k1 (BTC/BCH/ETH/POL) — BIP32 via @scure/bip32, path
 *                                 m/44'/<coinType>'/0'/0/<index>
 *   ed25519   (SOL)             — SLIP-0010, path m/44'/501'/<index>'/0'
 *
 * "Verbatim" is not taken on faith: `__tests__/private-keys.test.ts` derives a
 * key here, computes its address, and asserts it equals the SDK's
 * `deriveAddress()` for the same seed/chain/index. If the SDK ever changes its
 * paths, that test fails rather than this signing with a key whose funds live
 * at a different address.
 *
 * Callers MUST zero the returned bytes once signing is done (`clearMemory`).
 */

import { HDKey } from '@scure/bip32';
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';

import type { NativeChain } from './chains.js';

/** BIP-44 coin types — copied from the SDK's COIN_TYPES table. */
const COIN_TYPES: Record<NativeChain, number> = {
  BTC: 0,
  BCH: 145,
  ETH: 60,
  POL: 60, // EVM: shares the ETH path (and therefore the ETH address)
  SOL: 501,
};

/** The SDK's `getDerivationPath()` for the chains this extension derives. */
export function derivationPath(chain: NativeChain, index = 0): string {
  const coinType = COIN_TYPES[chain];
  if (chain === 'SOL') return `m/44'/${coinType}'/${index}'/0'`;
  return `m/44'/${coinType}'/0'/0/${index}`;
}

/**
 * SLIP-0010 ed25519 derivation (Solana). Only hardened segments are legal on
 * ed25519 — a non-hardened path is a programming error, not user input.
 */
function deriveEd25519Key(seed: Uint8Array, path: string): Uint8Array {
  const master = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed);
  let key = master.slice(0, 32);
  let chainCode = master.slice(32);

  for (const segment of path.replace(/^m\//, '').split('/')) {
    if (!segment.endsWith("'")) {
      throw new Error('SLIP-0010 ed25519 only supports hardened derivation');
    }
    const index = Number.parseInt(segment.slice(0, -1), 10);
    const hardened = (index | 0x80000000) >>> 0;

    // data = 0x00 || key || ser32(hardened index)
    const data = new Uint8Array(1 + 32 + 4);
    data[0] = 0x00;
    data.set(key, 1);
    data[33] = (hardened >> 24) & 0xff;
    data[34] = (hardened >> 16) & 0xff;
    data[35] = (hardened >> 8) & 0xff;
    data[36] = hardened & 0xff;

    const derived = hmac(sha512, chainCode, data);
    key = derived.slice(0, 32);
    chainCode = derived.slice(32);
  }

  return key;
}

/** Derive the raw signing key for a chain. Caller must zero it after use. */
export function derivePrivateKey(seed: Uint8Array, chain: NativeChain, index = 0): Uint8Array {
  const path = derivationPath(chain, index);

  if (chain === 'SOL') {
    return deriveEd25519Key(seed, path);
  }

  const derived = HDKey.fromMasterSeed(seed).derive(path);
  if (!derived.privateKey) {
    throw new Error(`Failed to derive private key for ${chain}`);
  }
  // Copy: the HDKey instance is garbage after this call and we want a buffer we
  // own and can zero.
  return Uint8Array.from(derived.privateKey);
}

/** Hex form expected by `signTransaction({ privateKey })`. */
export function derivePrivateKeyHex(seed: Uint8Array, chain: NativeChain, index = 0): string {
  const key = derivePrivateKey(seed, chain, index);
  try {
    return Array.from(key, (b) => b.toString(16).padStart(2, '0')).join('');
  } finally {
    key.fill(0);
  }
}
