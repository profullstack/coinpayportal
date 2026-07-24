/**
 * Parity guard for `private-keys.ts`.
 *
 * The extension signs with keys derived HERE but its funds sit at addresses
 * derived by the `@profullstack/coinpay` SDK. If the two ever disagree the
 * wallet signs with a key that controls a different address — transactions
 * would be rejected (or worse, spend from somewhere unexpected). So for every
 * chain we derive the private key, recompute the address from it, and assert it
 * equals `deriveAddress()` from the SDK.
 *
 * The address recomputation below deliberately does NOT reuse extension code:
 * a shared helper with the same bug in it would agree with itself. It follows
 * the published rules for each chain instead.
 */

import { describe, it, expect } from 'vitest';
import { deriveAddress } from '@profullstack/coinpay/wallet';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';

import { derivePrivateKey, derivePrivateKeyHex, derivationPath } from '../private-keys.js';
import { seedFromMnemonic } from '../derivation.js';
import { DEFAULT_CHAINS, type NativeChain } from '../chains.js';

// A published BIP-39 test vector — never used for real funds.
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SEED = seedFromMnemonic(MNEMONIC);

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(bytes: Uint8Array): string {
  let num = 0n;
  for (const b of bytes) num = num * 256n + BigInt(b);

  let out = '';
  while (num > 0n) {
    out = B58[Number(num % 58n)] + out;
    num /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}

function base58Check(version: number, payload: Uint8Array): string {
  const body = new Uint8Array(1 + payload.length);
  body[0] = version;
  body.set(payload, 1);
  const checksum = sha256(sha256(body)).slice(0, 4);
  const full = new Uint8Array(body.length + 4);
  full.set(body);
  full.set(checksum, body.length);
  return base58Encode(full);
}

/** EIP-55 checksummed hex address from an uncompressed secp256k1 public key. */
function evmAddress(privateKey: Uint8Array): string {
  const pub = secp256k1.getPublicKey(privateKey, false).slice(1); // drop 0x04
  const hex = Array.from(keccak_256(pub).slice(-20), (b) => b.toString(16).padStart(2, '0')).join('');
  const hashed = Array.from(keccak_256(new TextEncoder().encode(hex)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  let out = '';
  for (let i = 0; i < hex.length; i++) {
    out += Number.parseInt(hashed[i]!, 16) >= 8 ? hex[i]!.toUpperCase() : hex[i]!;
  }
  return '0x' + out;
}

/** hash160 embedded in a CashAddr payload, for comparing BCH without re-encoding. */
function cashAddrHash160(address: string): string {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const payload = address.split(':').pop()!;
  const values = [...payload].map((c) => CHARSET.indexOf(c));
  // Drop the 8-symbol checksum, convert 5-bit → 8-bit, drop the version byte.
  const data = values.slice(0, -8);
  let acc = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const v of data) {
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  return bytes
    .slice(1, 21)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('derivationPath', () => {
  it('matches the SDK BIP-44 layout per chain', () => {
    expect(derivationPath('BTC', 0)).toBe("m/44'/0'/0'/0/0");
    expect(derivationPath('BCH', 0)).toBe("m/44'/145'/0'/0/0");
    expect(derivationPath('ETH', 0)).toBe("m/44'/60'/0'/0/0");
    // POL is EVM and shares the ETH coin type — hence the shared address.
    expect(derivationPath('POL', 0)).toBe("m/44'/60'/0'/0/0");
    // Solana hardens the account segment instead of using change/index.
    expect(derivationPath('SOL', 0)).toBe("m/44'/501'/0'/0'");
    expect(derivationPath('SOL', 3)).toBe("m/44'/501'/3'/0'");
    expect(derivationPath('ETH', 3)).toBe("m/44'/60'/0'/0/3");
  });
});

describe('derivePrivateKey ↔ SDK deriveAddress parity', () => {
  it.each(DEFAULT_CHAINS)('%s: key derives the SDK address', (chain: NativeChain) => {
    const key = derivePrivateKey(SEED, chain, 0);
    const expected = deriveAddress(SEED, chain, 0) as string;

    switch (chain) {
      case 'ETH':
      case 'POL':
        expect(evmAddress(key).toLowerCase()).toBe(expected.toLowerCase());
        break;
      case 'BTC':
        expect(base58Check(0x00, hash160(secp256k1.getPublicKey(key, true)))).toBe(expected);
        break;
      case 'BCH':
        expect(cashAddrHash160(expected)).toBe(toHex(hash160(secp256k1.getPublicKey(key, true))));
        break;
      case 'SOL':
        expect(base58Encode(ed25519.getPublicKey(key))).toBe(expected);
        break;
    }
  });

  it('ETH and POL share one EVM key (so USDC_POL can sign with it)', () => {
    expect(toHex(derivePrivateKey(SEED, 'ETH', 0))).toBe(toHex(derivePrivateKey(SEED, 'POL', 0)));
  });

  it('derives distinct keys per account index', () => {
    expect(toHex(derivePrivateKey(SEED, 'ETH', 0))).not.toBe(toHex(derivePrivateKey(SEED, 'ETH', 1)));
    expect(toHex(derivePrivateKey(SEED, 'SOL', 0))).not.toBe(toHex(derivePrivateKey(SEED, 'SOL', 1)));
  });
});

describe('derivePrivateKeyHex', () => {
  it('returns 32 bytes of lowercase hex with no 0x prefix', () => {
    for (const chain of DEFAULT_CHAINS) {
      const hex = derivePrivateKeyHex(SEED, chain, 0);
      expect(hex).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('agrees with the raw byte form', () => {
    expect(derivePrivateKeyHex(SEED, 'ETH', 0)).toBe(toHex(derivePrivateKey(SEED, 'ETH', 0)));
  });
});
