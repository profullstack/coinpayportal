/**
 * Web Wallet Identity Service
 *
 * Handles public key validation and address format verification
 * for the non-custodial web wallet. Server never sees private keys.
 */

import { secp256k1 } from '@noble/curves/secp256k1';

/** Supported chains for web wallet */
export type WalletChain =
  | 'BTC' | 'BCH' | 'ETH' | 'POL' | 'SOL'
  | 'DOGE' | 'XRP' | 'ADA' | 'BNB' | 'LN'
  | 'USDC_ETH' | 'USDC_POL' | 'USDC_SOL'
  | 'USDT_ETH' | 'USDT_POL' | 'USDT_SOL';

/** All valid chain values */
export const VALID_CHAINS: WalletChain[] = [
  'BTC', 'BCH', 'ETH', 'POL', 'SOL',
  'DOGE', 'XRP', 'ADA', 'BNB', 'LN',
  'USDC_ETH', 'USDC_POL', 'USDC_SOL',
  'USDT_ETH', 'USDT_POL', 'USDT_SOL',
];

/** BIP44 derivation path patterns per chain */
export const DERIVATION_PATHS: Record<string, string> = {
  BTC: "m/44'/0'/0'/0",
  BCH: "m/44'/145'/0'/0",
  ETH: "m/44'/60'/0'/0",
  POL: "m/44'/60'/0'/0",
  SOL: "m/44'/501'",
  DOGE: "m/44'/3'/0'/0",
  XRP: "m/44'/144'/0'/0",
  ADA: "m/1852'/1815'/0'/0'",
  BNB: "m/44'/60'/0'/0",
  LN: "m/535'/0'",
  USDC_ETH: "m/44'/60'/0'/0",
  USDC_POL: "m/44'/60'/0'/0",
  USDC_SOL: "m/44'/501'",
  USDT_ETH: "m/44'/60'/0'/0",
  USDT_POL: "m/44'/60'/0'/0",
  USDT_SOL: "m/44'/501'",
};

/**
 * Validate a hex-encoded secp256k1 compressed public key (33 bytes = 66 hex chars).
 * Returns true if format is valid.
 */
export function validateSecp256k1PublicKey(hexKey: string): boolean {
  try {
    if (!hexKey || typeof hexKey !== 'string') return false;
    // Remove 0x prefix if present
    const clean = hexKey.startsWith('0x') ? hexKey.slice(2) : hexKey;
    // Compressed public key is 33 bytes (66 hex chars)
    if (clean.length !== 66) return false;
    // Must start with 02 or 03 (compressed point prefix)
    if (!clean.startsWith('02') && !clean.startsWith('03')) return false;
    // Validate it's actually on the curve
    secp256k1.Point.fromHex(clean);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a base58-encoded ed25519 public key (32 bytes).
 * For Solana, this is the standard address format.
 */
export function validateEd25519PublicKey(base58Key: string): boolean {
  try {
    if (!base58Key || typeof base58Key !== 'string') return false;
    // Solana addresses are base58-encoded 32-byte public keys
    // Typical length is 32-44 characters
    if (base58Key.length < 32 || base58Key.length > 44) return false;
    // Validate base58 charset (no 0, O, I, l)
    const base58Regex = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;
    if (!base58Regex.test(base58Key)) return false;
    // Decode to check byte length
    const decoded = base58Decode(base58Key);
    return decoded.length === 32;
  } catch {
    return false;
  }
}

/**
 * Validate a blockchain address format.
 */
export function validateAddress(address: string, chain: WalletChain): boolean {
  if (!address || typeof address !== 'string') return false;

  switch (chain) {
    case 'BTC':
      // P2PKH (1...), P2SH (3...), or Bech32 (bc1...)
      return /^(1[a-km-zA-HJ-NP-Z1-9]{25,34}|3[a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{39,59})$/.test(address);
    case 'BCH':
      // CashAddr format (bitcoincash:q...) or legacy
      return /^(bitcoincash:)?[qp][a-z0-9]{41}$/.test(address) ||
        /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address);
    case 'ETH':
    case 'POL':
    case 'BNB':
    case 'USDC_ETH':
    case 'USDC_POL':
    case 'USDT_ETH':
    case 'USDT_POL':
      // EVM address: 0x followed by 40 hex chars
      return /^0x[0-9a-fA-F]{40}$/.test(address);
    case 'SOL':
    case 'USDC_SOL':
    case 'USDT_SOL':
      // Solana: base58 encoded, 32-44 chars
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
    case 'DOGE':
      // Dogecoin: starts with D, A, or 9
      return /^[DA9][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address);
    case 'XRP':
      // XRP: starts with r
      return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address);
    case 'ADA':
      // Cardano Shelley address: starts with addr1
      return /^addr1[a-z0-9]{50,100}$/.test(address);
    default:
      return false;
  }
}

/**
 * Validate a BIP44 derivation path string.
 */
export function validateDerivationPath(path: string, chain: WalletChain): boolean {
  if (!path || typeof path !== 'string') return false;

  const basePath = DERIVATION_PATHS[chain];
  if (!basePath) return false;

  if (chain === 'SOL' || chain === 'USDC_SOL' || chain === 'USDT_SOL') {
    // Solana uses: m/44'/501'/n'/0'
    return /^m\/44'\/501'\/\d+'\/0'$/.test(path);
  }

  if (chain === 'ADA') {
    // Cardano CIP-1852 (all hardened for Ed25519): m/1852'/1815'/account'/role'/index'
    return /^m\/1852'\/1815'\/\d+'\/\d+'\/\d+'$/.test(path);
  }

  // BTC/BCH/ETH/POL: m/44'/coinType'/0'/0/n
  const escapedBase = basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^${escapedBase}/\\d+$`);
  return regex.test(path);
}

/**
 * Check if a chain value is valid.
 */
export function isValidChain(chain: string): chain is WalletChain {
  return VALID_CHAINS.includes(chain as WalletChain);
}

/**
 * Build a standard derivation path for a given chain and index.
 */
export function buildDerivationPath(chain: WalletChain, index: number): string {
  switch (chain) {
    case 'BTC':
      return `m/44'/0'/0'/0/${index}`;
    case 'BCH':
      return `m/44'/145'/0'/0/${index}`;
    case 'ETH':
    case 'POL':
    case 'BNB':
    case 'USDC_ETH':
    case 'USDC_POL':
    case 'USDT_ETH':
    case 'USDT_POL':
      return `m/44'/60'/0'/0/${index}`;
    case 'SOL':
    case 'USDC_SOL':
    case 'USDT_SOL':
      return `m/44'/501'/${index}'/0'`;
    case 'DOGE':
      return `m/44'/3'/0'/0/${index}`;
    case 'XRP':
      return `m/44'/144'/0'/0/${index}`;
    case 'ADA':
      return `m/1852'/1815'/0'/0'/${index}'`;
    default:
      throw new Error(`Unsupported chain: ${chain}`);
  }
}

// ---- Utility helpers ----

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(str: string): Uint8Array {
  // Count leading '1' characters (each represents a zero byte)
  let leadingZeros = 0;
  for (const char of str) {
    if (char === '1') leadingZeros++;
    else break;
  }

  // Decode the number part using big-integer arithmetic
  const size = Math.ceil(str.length * Math.log(58) / Math.log(256));
  const bytes = new Uint8Array(size);

  for (const char of str) {
    const value = BASE58_ALPHABET.indexOf(char);
    if (value === -1) throw new Error(`Invalid base58 character: ${char}`);

    let carry = value;
    for (let j = size - 1; j >= 0; j--) {
      carry += 58 * bytes[j];
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
  }

  // Skip leading zero bytes from the conversion
  let start = 0;
  while (start < size && bytes[start] === 0) start++;

  // Combine: leading zero bytes + significant bytes
  const result = new Uint8Array(leadingZeros + (size - start));
  // Leading zeros are already 0 in the result
  for (let i = start; i < size; i++) {
    result[leadingZeros + i - start] = bytes[i];
  }
  return result;
}
