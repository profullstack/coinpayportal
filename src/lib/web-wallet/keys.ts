/**
 * Web Wallet Key Derivation Service
 *
 * BIP39 mnemonic generation and BIP32/BIP44 HD key derivation
 * for the non-custodial web wallet. Derives addresses and public keys
 * for all supported chains.
 *
 * NOTE: In production, mnemonic generation and private key derivation
 * happen CLIENT-SIDE only. This module is used for:
 * - SDK key derivation
 * - Server-side testing and validation
 * - Import proof verification
 */

import {
  generateMnemonic as bip39GenerateMnemonic,
  mnemonicToSeedSync,
  validateMnemonic,
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { HDKey } from '@scure/bip32';
import { secp256k1 } from '@noble/curves/secp256k1';
import { ed25519 } from '@noble/curves/ed25519.js';
import * as bitcoin from 'bitcoinjs-lib';
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import type { WalletChain } from './identity';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface DerivedKey {
  chain: WalletChain;
  address: string;
  publicKey: string; // hex for secp256k1, base58 for ed25519
  privateKey: string; // hex
  derivationPath: string;
  index: number;
}

export interface WalletKeyBundle {
  mnemonic: string;
  publicKeySecp256k1: string; // hex, compressed
  privateKeySecp256k1: string; // hex, master account key for signing proofs
  publicKeyEd25519: string; // base58
  addresses: DerivedKey[];
}

// ──────────────────────────────────────────────
// BIP39 Mnemonic
// ──────────────────────────────────────────────

/**
 * Generate a BIP39 mnemonic phrase.
 * @param words - 12 or 24 words (128 or 256 bits of entropy)
 */
export function generateMnemonic(words: 12 | 24 = 12): string {
  const strength = words === 24 ? 256 : 128;
  return bip39GenerateMnemonic(wordlist, strength);
}

/**
 * Validate a BIP39 mnemonic phrase.
 */
export function isValidMnemonic(mnemonic: string): boolean {
  return validateMnemonic(mnemonic, wordlist);
}

/**
 * Convert a mnemonic to seed bytes.
 */
export function mnemonicToSeed(mnemonic: string, passphrase?: string): Uint8Array {
  return mnemonicToSeedSync(mnemonic, passphrase);
}

// ──────────────────────────────────────────────
// BIP32/BIP44 HD Key Derivation
// ──────────────────────────────────────────────

/**
 * Derive all initial keys from a mnemonic.
 * Returns the master public keys and first address for each chain.
 */
export async function deriveWalletBundle(
  mnemonic: string,
  chains: WalletChain[] = ['BTC', 'BCH', 'ETH', 'POL', 'SOL']
): Promise<WalletKeyBundle> {
  if (!isValidMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }

  const seed = mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);

  // Derive master secp256k1 key pair (from ETH path account root)
  const masterSecp = hdKey.derive("m/44'/60'/0'");
  const publicKeySecp256k1 = masterSecp.publicKey
    ? Buffer.from(masterSecp.publicKey).toString('hex')
    : '';
  const privateKeySecp256k1 = masterSecp.privateKey
    ? Buffer.from(masterSecp.privateKey).toString('hex')
    : '';

  // Derive ed25519 key for Solana (index 0)
  const { publicKey: ed25519PubKey } = await deriveEd25519(seed, 0);
  const publicKeyEd25519 = ed25519PubKey;

  // Derive first address for each chain
  const addresses: DerivedKey[] = [];
  for (const chain of chains) {
    const key = await deriveKeyForChain(mnemonic, chain, 0);
    addresses.push(key);
  }

  return {
    mnemonic,
    publicKeySecp256k1,
    privateKeySecp256k1,
    publicKeyEd25519,
    addresses,
  };
}

/**
 * Derive a key for a specific chain and index.
 */
export async function deriveKeyForChain(
  mnemonic: string,
  chain: WalletChain,
  index: number
): Promise<DerivedKey> {
  if (!isValidMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }

  const seed = mnemonicToSeedSync(mnemonic);

  switch (chain) {
    case 'BTC':
      return deriveBTC(seed, index);
    case 'BCH':
      return deriveBCH(seed, index);
    case 'ETH':
    case 'USDC_ETH':
      return deriveEVM(seed, chain, index);
    case 'POL':
    case 'USDC_POL':
      return deriveEVM(seed, chain, index);
    case 'SOL':
    case 'USDC_SOL':
      return deriveSOL(seed, chain, index);
    default:
      throw new Error(`Unsupported chain: ${chain}`);
  }
}

// ──────────────────────────────────────────────
// Chain-specific derivation
// ──────────────────────────────────────────────

function deriveBTC(seed: Uint8Array, index: number): DerivedKey {
  const hdKey = HDKey.fromMasterSeed(seed);
  const path = `m/44'/0'/0'/0/${index}`;
  const child = hdKey.derive(path);

  if (!child.privateKey) throw new Error('Failed to derive BTC key');

  const publicKey = secp256k1.getPublicKey(child.privateKey, true);
  const { address } = bitcoin.payments.p2pkh({
    pubkey: Buffer.from(publicKey),
    network: bitcoin.networks.bitcoin,
  });

  if (!address) throw new Error('Failed to generate BTC address');

  return {
    chain: 'BTC',
    address,
    publicKey: Buffer.from(publicKey).toString('hex'),
    privateKey: Buffer.from(child.privateKey).toString('hex'),
    derivationPath: path,
    index,
  };
}

function deriveBCH(seed: Uint8Array, index: number): DerivedKey {
  const hdKey = HDKey.fromMasterSeed(seed);
  const path = `m/44'/145'/0'/0/${index}`;
  const child = hdKey.derive(path);

  if (!child.privateKey || !child.publicKey) throw new Error('Failed to derive BCH key');

  const publicKey = secp256k1.getPublicKey(child.privateKey, true);

  // Generate CashAddr format
  const { hash } = bitcoin.payments.p2pkh({
    pubkey: Buffer.from(child.publicKey),
    network: bitcoin.networks.bitcoin,
  });

  if (!hash) throw new Error('Failed to generate BCH address hash');

  const address = hashToCashAddress(hash);

  return {
    chain: 'BCH',
    address,
    publicKey: Buffer.from(publicKey).toString('hex'),
    privateKey: Buffer.from(child.privateKey).toString('hex'),
    derivationPath: path,
    index,
  };
}

function deriveEVM(seed: Uint8Array, chain: WalletChain, index: number): DerivedKey {
  const hdKey = HDKey.fromMasterSeed(seed);
  const path = `m/44'/60'/0'/0/${index}`;
  const child = hdKey.derive(path);

  if (!child.privateKey) throw new Error(`Failed to derive ${chain} key`);

  const compressedPubKey = secp256k1.getPublicKey(child.privateKey, true);
  const address = publicKeyToEthAddress(child.privateKey);

  return {
    chain,
    address,
    publicKey: Buffer.from(compressedPubKey).toString('hex'),
    privateKey: Buffer.from(child.privateKey).toString('hex'),
    derivationPath: path,
    index,
  };
}

/**
 * Derive an EIP-55 checksummed Ethereum address from a secp256k1 private key.
 * 1. Get uncompressed public key (65 bytes, 0x04 prefix)
 * 2. Keccak256 of the 64 bytes after 0x04
 * 3. Take last 20 bytes
 * 4. Apply EIP-55 checksum
 */
function publicKeyToEthAddress(privateKey: Uint8Array): string {
  // Get uncompressed public key (false = uncompressed)
  const uncompressed = secp256k1.getPublicKey(privateKey, false);
  // Remove the 0x04 prefix (first byte)
  const pubKeyNoPrefix = uncompressed.slice(1);
  // Keccak256 hash
  const hash = keccak_256(pubKeyNoPrefix);
  // Take last 20 bytes
  const addressBytes = hash.slice(-20);
  const addressHex = Buffer.from(addressBytes).toString('hex');

  // EIP-55 checksum
  const checksumHash = Buffer.from(keccak_256(Buffer.from(addressHex, 'ascii'))).toString('hex');
  let checksummed = '0x';
  for (let i = 0; i < 40; i++) {
    if (parseInt(checksumHash[i], 16) >= 8) {
      checksummed += addressHex[i].toUpperCase();
    } else {
      checksummed += addressHex[i].toLowerCase();
    }
  }

  return checksummed;
}

async function deriveSOL(
  seed: Uint8Array,
  chain: WalletChain,
  index: number
): Promise<DerivedKey> {
  const path = `m/44'/501'/${index}'/0'`;
  const { address, publicKey, privateKey } = await deriveEd25519(seed, index);

  return {
    chain,
    address,
    publicKey, // base58
    privateKey,
    derivationPath: path,
    index,
  };
}

// ──────────────────────────────────────────────
// Ed25519 / SLIP-0010 derivation
// ──────────────────────────────────────────────

/**
 * SLIP-0010 Ed25519 key derivation from seed.
 * Ed25519 only supports hardened derivation.
 */
function slip0010DeriveKey(
  seed: Uint8Array,
  path: string
): { key: Buffer; chainCode: Buffer } {
  const I = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed);
  let key = Buffer.from(I.subarray(0, 32));
  let chainCode = Buffer.from(I.subarray(32));

  const segments = path.split('/').slice(1); // Remove 'm'

  for (const segment of segments) {
    const hardened = segment.endsWith("'");
    if (!hardened) throw new Error('Ed25519 only supports hardened derivation');

    const indexStr = segment.slice(0, -1);
    const idx = parseInt(indexStr, 10);

    const data = Buffer.alloc(37);
    data[0] = 0;
    key.copy(data, 1);
    data.writeUInt32BE(idx + 0x80000000, 33);

    const childI = hmac(sha512, chainCode, data);
    key = Buffer.from(childI.subarray(0, 32));
    chainCode = Buffer.from(childI.subarray(32));
  }

  return { key, chainCode };
}

/**
 * Derive Ed25519 keypair and Solana address from seed.
 */
async function deriveEd25519(
  seed: Uint8Array,
  index: number
): Promise<{ address: string; publicKey: string; privateKey: string }> {
  const path = `m/44'/501'/${index}'/0'`;
  const { key } = slip0010DeriveKey(seed, path);

  // Get Ed25519 public key using @noble/curves (browser-compatible)
  const rawPubKey = Buffer.from(ed25519.getPublicKey(key));

  const address = base58Encode(rawPubKey);

  return {
    address,
    publicKey: address, // Solana public key IS the address
    privateKey: key.toString('hex'),
  };
}

// ──────────────────────────────────────────────
// CashAddr encoding for BCH
// ──────────────────────────────────────────────

const CASHADDR_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function convertBits(
  data: Uint8Array | Buffer,
  fromBits: number,
  toBits: number,
  pad: boolean
): number[] {
  let acc = 0;
  let bits = 0;
  const result: number[] = [];
  const maxv = (1 << toBits) - 1;

  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((acc >> bits) & maxv);
    }
  }

  if (pad && bits > 0) {
    result.push((acc << (toBits - bits)) & maxv);
  }

  return result;
}

function cashAddrPolymod(values: number[]): bigint {
  const GENERATORS: bigint[] = [
    0x98f2bc8e61n,
    0x79b76d99e2n,
    0xf33e5fb3c4n,
    0xae2eabe2a8n,
    0x1e4f43e470n,
  ];

  let chk = 1n;
  for (const value of values) {
    const top = chk >> 35n;
    chk = ((chk & 0x07ffffffffn) << 5n) ^ BigInt(value);
    for (let i = 0; i < 5; i++) {
      if ((top >> BigInt(i)) & 1n) {
        chk ^= GENERATORS[i];
      }
    }
  }
  return chk;
}

function hashToCashAddress(hash160: Buffer): string {
  const versionByte = 0x00; // P2PKH
  const payload = Buffer.concat([Buffer.from([versionByte]), hash160]);
  const data = convertBits(payload, 8, 5, true);

  const prefix = 'bitcoincash';
  const prefixData: number[] = [];
  for (let i = 0; i < prefix.length; i++) {
    prefixData.push(prefix.charCodeAt(i) & 0x1f);
  }
  prefixData.push(0);

  const checksumInput = [...prefixData, ...data, 0, 0, 0, 0, 0, 0, 0, 0];
  const checksum = cashAddrPolymod(checksumInput) ^ 1n;

  const checksumData: number[] = [];
  for (let i = 0; i < 8; i++) {
    checksumData.push(Number((checksum >> BigInt(5 * (7 - i))) & 0x1fn));
  }

  let result = prefix + ':';
  for (const d of [...data, ...checksumData]) {
    result += CASHADDR_CHARSET[d];
  }

  return result;
}

// ──────────────────────────────────────────────
// Base58 encoding
// ──────────────────────────────────────────────

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(bytes: Uint8Array): string {
  const digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let result = '';
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    result += BASE58_ALPHABET[0];
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }
  return result;
}
