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
import { ripemd160 } from '@noble/hashes/legacy.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { blake2b } from '@noble/hashes/blake2.js';
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
// Supported Chains (Single Source of Truth)
// ──────────────────────────────────────────────

/**
 * Chains that can be derived from a BIP39 mnemonic.
 * This is the canonical list - used by UI, SDK, and backend.
 */
export const DERIVABLE_CHAINS = [
  // Native coins
  'BTC',
  'BCH',
  'ETH',
  'POL',
  'SOL',
  'DOGE',
  'XRP',
  'ADA',
  'BNB',
  // USDC tokens (same address as parent chain)
  'USDC_ETH',
  'USDC_POL',
  'USDC_SOL',
  // USDT tokens (same address as parent chain)
  'USDT_ETH',
  'USDT_POL',
  'USDT_SOL',
] as const;

export type DerivableChain = (typeof DERIVABLE_CHAINS)[number];

/**
 * Human-readable names for derivable chains
 */
export const DERIVABLE_CHAIN_INFO: Record<DerivableChain, { name: string; symbol: string }> = {
  BTC: { name: 'Bitcoin', symbol: 'BTC' },
  BCH: { name: 'Bitcoin Cash', symbol: 'BCH' },
  ETH: { name: 'Ethereum', symbol: 'ETH' },
  POL: { name: 'Polygon', symbol: 'POL' },
  SOL: { name: 'Solana', symbol: 'SOL' },
  DOGE: { name: 'Dogecoin', symbol: 'DOGE' },
  XRP: { name: 'XRP', symbol: 'XRP' },
  ADA: { name: 'Cardano', symbol: 'ADA' },
  BNB: { name: 'BNB Smart Chain', symbol: 'BNB' },
  USDC_ETH: { name: 'USDC (Ethereum)', symbol: 'USDC' },
  USDC_POL: { name: 'USDC (Polygon)', symbol: 'USDC' },
  USDC_SOL: { name: 'USDC (Solana)', symbol: 'USDC' },
  USDT_ETH: { name: 'USDT (Ethereum)', symbol: 'USDT' },
  USDT_POL: { name: 'USDT (Polygon)', symbol: 'USDT' },
  USDT_SOL: { name: 'USDT (Solana)', symbol: 'USDT' },
};

/**
 * Parent chain for token chains (for address derivation)
 */
export const TOKEN_PARENT_CHAIN: Partial<Record<DerivableChain, DerivableChain>> = {
  USDC_ETH: 'ETH',
  USDC_POL: 'POL',
  USDC_SOL: 'SOL',
  USDT_ETH: 'ETH',
  USDT_POL: 'POL',
  USDT_SOL: 'SOL',
};

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
  chains: WalletChain[] = [...DERIVABLE_CHAINS]
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

  // Check if chain is supported before trying to derive
  if (!DERIVABLE_CHAINS.includes(chain as DerivableChain)) {
    throw new Error(`Unsupported chain: ${chain}`);
  }

  // Handle token chains - derive from parent chain
  const parentChain = TOKEN_PARENT_CHAIN[chain as DerivableChain];
  if (parentChain) {
    const parentKey = await deriveKeyForChain(mnemonic, parentChain, index);
    return {
      ...parentKey,
      chain, // Keep the token chain name
    };
  }

  switch (chain) {
    case 'BTC':
      return deriveBTC(seed, index);
    case 'BCH':
      return deriveBCH(seed, index);
    case 'DOGE':
      return deriveDOGE(seed, index);
    case 'ETH':
    case 'BNB': // BNB Smart Chain uses same derivation as ETH
      return deriveEVM(seed, chain, index);
    case 'POL':
      return deriveEVM(seed, chain, index);
    case 'SOL':
      return deriveSOL(seed, chain, index);
    case 'XRP':
      return deriveXRP(seed, index);
    case 'ADA':
      return deriveADA(seed, index);
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

/**
 * Derive Dogecoin address.
 * Uses BIP44 coin type 3, address version 0x1E (30).
 */
function deriveDOGE(seed: Uint8Array, index: number): DerivedKey {
  const hdKey = HDKey.fromMasterSeed(seed);
  const path = `m/44'/3'/0'/0/${index}`;
  const child = hdKey.derive(path);

  if (!child.privateKey) throw new Error('Failed to derive DOGE key');

  const publicKey = secp256k1.getPublicKey(child.privateKey, true);
  
  // DOGE uses version byte 0x1E (30) for P2PKH mainnet
  const pubKeyHash = hash160(Buffer.from(publicKey));
  const address = base58CheckEncode(pubKeyHash, 0x1e);

  return {
    chain: 'DOGE',
    address,
    publicKey: Buffer.from(publicKey).toString('hex'),
    privateKey: Buffer.from(child.privateKey).toString('hex'),
    derivationPath: path,
    index,
  };
}

/**
 * Derive XRP address.
 * Uses BIP44 coin type 144, secp256k1, but with Ripple's base58 alphabet.
 */
function deriveXRP(seed: Uint8Array, index: number): DerivedKey {
  const hdKey = HDKey.fromMasterSeed(seed);
  const path = `m/44'/144'/0'/0/${index}`;
  const child = hdKey.derive(path);

  if (!child.privateKey) throw new Error('Failed to derive XRP key');

  const publicKey = secp256k1.getPublicKey(child.privateKey, true);
  
  // XRP address: SHA256 -> RIPEMD160 of public key, then Ripple base58check
  const pubKeyHash = hash160(Buffer.from(publicKey));
  const address = rippleBase58CheckEncode(pubKeyHash, 0x00); // Account ID type

  return {
    chain: 'XRP',
    address,
    publicKey: Buffer.from(publicKey).toString('hex'),
    privateKey: Buffer.from(child.privateKey).toString('hex'),
    derivationPath: path,
    index,
  };
}

/**
 * Derive Cardano (ADA) address.
 * Uses CIP-1852 derivation with Ed25519.
 * Generates a Shelley-era enterprise address (no staking).
 */
function deriveADA(seed: Uint8Array, index: number): DerivedKey {
  // CIP-1852: m/1852'/1815'/account'/role'/index'
  // 1852 = Shelley era, 1815 = ADA coin type (Ada Lovelace birth year)
  // role: 0 = external, 1 = internal, 2 = staking
  // Note: Using all hardened derivation for Ed25519 compatibility
  const path = `m/1852'/1815'/0'/0'/${index}'`;
  
  // Cardano uses SLIP-0010 Ed25519 derivation
  const { key } = slip0010DeriveKey(seed, path);
  
  const rawPubKey = ed25519.getPublicKey(key);
  
  // Create Shelley enterprise address (type 6 for mainnet enterprise)
  // Format: 0x61 (type byte) + 28-byte key hash
  const keyHash = blake2b(rawPubKey, { dkLen: 28 });
  const addressBytes = Buffer.concat([Buffer.from([0x61]), Buffer.from(keyHash)]);
  
  // Bech32 encode with 'addr' prefix for mainnet
  const words = bech32.toWords(addressBytes);
  const address = bech32.encode('addr', words, 108); // 108 char limit for Cardano

  return {
    chain: 'ADA',
    address,
    publicKey: Buffer.from(rawPubKey).toString('hex'),
    privateKey: key.toString('hex'),
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
// Hash utilities
// ──────────────────────────────────────────────

/**
 * Bitcoin-style Hash160: SHA256 then RIPEMD160
 */
function hash160(data: Buffer): Buffer {
  return Buffer.from(ripemd160(sha256(data)));
}

// ──────────────────────────────────────────────
// Base58 encoding (Bitcoin style)
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

/**
 * Base58Check encode with version byte (Bitcoin-style)
 */
function base58CheckEncode(payload: Buffer, version: number): string {
  const versionedPayload = Buffer.concat([Buffer.from([version]), payload]);
  const checksum = sha256(sha256(versionedPayload)).slice(0, 4);
  const fullPayload = Buffer.concat([versionedPayload, Buffer.from(checksum)]);
  return base58Encode(fullPayload);
}

// ──────────────────────────────────────────────
// Ripple Base58 encoding (different alphabet)
// ──────────────────────────────────────────────

const RIPPLE_ALPHABET = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';

function rippleBase58Encode(bytes: Uint8Array): string {
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
    result += RIPPLE_ALPHABET[0];
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += RIPPLE_ALPHABET[digits[i]];
  }
  return result;
}

/**
 * Ripple Base58Check encode with version byte
 */
function rippleBase58CheckEncode(payload: Buffer, version: number): string {
  const versionedPayload = Buffer.concat([Buffer.from([version]), payload]);
  const checksum = sha256(sha256(versionedPayload)).slice(0, 4);
  const fullPayload = Buffer.concat([versionedPayload, Buffer.from(checksum)]);
  return rippleBase58Encode(fullPayload);
}

// ──────────────────────────────────────────────
// Bech32 encoding (for Cardano)
// ──────────────────────────────────────────────

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((b >> i) & 1) chk ^= GEN[i];
    }
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const result: number[] = [];
  for (let i = 0; i < hrp.length; i++) {
    result.push(hrp.charCodeAt(i) >> 5);
  }
  result.push(0);
  for (let i = 0; i < hrp.length; i++) {
    result.push(hrp.charCodeAt(i) & 31);
  }
  return result;
}

function bech32CreateChecksum(hrp: string, data: number[]): number[] {
  const values = [...bech32HrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const polymod = bech32Polymod(values) ^ 1;
  const result: number[] = [];
  for (let i = 0; i < 6; i++) {
    result.push((polymod >> (5 * (5 - i))) & 31);
  }
  return result;
}

/**
 * Convert bytes to 5-bit words for bech32
 */
function bech32ToWords(bytes: Uint8Array): number[] {
  const result: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result.push((acc >> bits) & 31);
    }
  }
  if (bits > 0) {
    result.push((acc << (5 - bits)) & 31);
  }
  return result;
}

/**
 * Bech32 encode
 */
function bech32Encode(hrp: string, data: number[], limit = 90): string {
  const checksum = bech32CreateChecksum(hrp, data);
  const combined = [...data, ...checksum];
  let result = hrp + '1';
  for (const d of combined) {
    result += BECH32_CHARSET[d];
  }
  if (result.length > limit) {
    throw new Error(`Bech32 result too long: ${result.length} > ${limit}`);
  }
  return result;
}

// Bech32 utility object for convenience
const bech32 = {
  toWords: bech32ToWords,
  encode: bech32Encode,
};

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
