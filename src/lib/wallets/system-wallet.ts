/**
 * System Wallet Service for Payment Address Generation
 *
 * This service manages the SYSTEM's HD wallet for generating unique payment addresses.
 * The system (CoinPay) owns these wallets, NOT the merchants.
 *
 * Payment Flow:
 * 1. Customer initiates payment
 * 2. System generates a unique address from its HD wallet
 * 3. Customer pays to the system's address
 * 4. After confirmation:
 *    - System takes 0.5% commission to system wallet
 *    - System forwards 99.5% to merchant's wallet
 *
 * This ensures:
 * - CoinPay can collect commission on every transaction
 * - Each payment has a unique trackable address
 * - Merchants never receive direct payments (all go through system)
 */

import { HDKey } from '@scure/bip32';
import { generateMnemonic as bip39GenerateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import * as bitcoin from 'bitcoinjs-lib';
import { ethers } from 'ethers';
import { createHmac } from 'crypto';
import { encrypt, decrypt } from '../crypto/encryption';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getFeePercentage, FEE_PERCENTAGE_FREE, FEE_PERCENTAGE_PAID } from '../payments/fees';

/**
 * Supported blockchains
 */
export type SystemBlockchain = 'BTC' | 'BCH' | 'ETH' | 'POL' | 'SOL' | 'DOGE' | 'XRP' | 'ADA' | 'BNB' | 'USDT' | 'USDC' | 'USDC_ETH' | 'USDC_POL' | 'USDC_SOL';

/**
 * Commission rates by tier
 * - Free tier (starter): 1% platform fee
 * - Paid tier (professional): 0.5% platform fee
 */
export const COMMISSION_RATE_FREE = FEE_PERCENTAGE_FREE;   // 1% for free tier
export const COMMISSION_RATE_PAID = FEE_PERCENTAGE_PAID;   // 0.5% for paid tier

/**
 * Default commission rate (legacy - uses paid tier for backward compatibility)
 * @deprecated Use getCommissionRate(isPaidTier) instead
 */
export const COMMISSION_RATE = COMMISSION_RATE_PAID;

/**
 * Get commission rate based on subscription tier
 * @param isPaidTier - Whether merchant has a paid subscription
 * @returns Commission rate (0.01 for free, 0.005 for paid)
 */
export function getCommissionRate(isPaidTier: boolean): number {
  return getFeePercentage(isPaidTier);
}

/**
 * System wallet configuration
 */
export interface SystemWalletConfig {
  cryptocurrency: SystemBlockchain;
  mnemonic: string; // Encrypted mnemonic for the system wallet
  commission_wallet: string; // Address where commission is sent
  next_index: number; // Next available derivation index
}

/**
 * Derived payment address with private key
 */
export interface SystemDerivedAddress {
  address: string;
  privateKey: string; // Encrypted private key for forwarding
  index: number;
  derivationPath: string;
  cryptocurrency: SystemBlockchain;
}

/**
 * Payment address record
 */
export interface PaymentAddressInfo {
  payment_id: string;
  address: string;
  cryptocurrency: SystemBlockchain;
  derivation_index: number;
  encrypted_private_key: string;
  merchant_wallet: string; // Where to forward funds
  commission_wallet: string; // Where to send commission
  amount_expected: number;
  commission_amount: number;
  merchant_amount: number;
}

/**
 * Get the system's master mnemonic from environment
 * In production, this should be stored securely (HSM, Vault, etc.)
 */
function getSystemMnemonic(cryptocurrency: SystemBlockchain): string {
  let envKey = `SYSTEM_MNEMONIC_${cryptocurrency}`;
  let mnemonic = process.env[envKey];

  // Chain-specific USDC falls back to the parent chain's mnemonic
  if (!mnemonic && cryptocurrency === 'USDC_ETH') {
    mnemonic = process.env['SYSTEM_MNEMONIC_ETH'];
  }
  if (!mnemonic && cryptocurrency === 'USDC_POL') {
    mnemonic = process.env['SYSTEM_MNEMONIC_POL'] || process.env['SYSTEM_MNEMONIC_ETH'];
  }
  if (!mnemonic && cryptocurrency === 'USDC_SOL') {
    mnemonic = process.env['SYSTEM_MNEMONIC_SOL'];
  }

  // POL, BNB, USDT, USDC (generic) use the same derivation as ETH, so fall back to ETH mnemonic
  if (!mnemonic && (cryptocurrency === 'POL' || cryptocurrency === 'BNB' || cryptocurrency === 'USDT' || cryptocurrency === 'USDC')) {
    envKey = 'SYSTEM_MNEMONIC_ETH';
    mnemonic = process.env[envKey];
  }

  if (!mnemonic) {
    throw new Error(
      `System mnemonic not configured for ${cryptocurrency}. ` +
        `Set SYSTEM_MNEMONIC_${cryptocurrency} environment variable.`
    );
  }

  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new Error(`Invalid system mnemonic for ${cryptocurrency}`);
  }

  return mnemonic;
}

/**
 * Get the system's platform fee wallet address (where commission is sent)
 * POL, BNB, USDT, USDC use the same address as ETH (EVM compatible)
 */
export function getCommissionWallet(cryptocurrency: SystemBlockchain): string {
  let envKey = `PLATFORM_FEE_WALLET_${cryptocurrency}`;
  let wallet = process.env[envKey];

  // Chain-specific USDC falls back to the parent chain's fee wallet
  if (!wallet && cryptocurrency === 'USDC_ETH') {
    wallet = process.env['PLATFORM_FEE_WALLET_ETH'];
  }
  if (!wallet && cryptocurrency === 'USDC_POL') {
    wallet = process.env['PLATFORM_FEE_WALLET_POL'] || process.env['PLATFORM_FEE_WALLET_ETH'];
  }
  if (!wallet && cryptocurrency === 'USDC_SOL') {
    wallet = process.env['PLATFORM_FEE_WALLET_SOL'];
  }

  // POL, BNB, USDT, USDC (generic) use the same address as ETH (EVM compatible)
  if (!wallet && (cryptocurrency === 'POL' || cryptocurrency === 'BNB' || cryptocurrency === 'USDT' || cryptocurrency === 'USDC')) {
    envKey = 'PLATFORM_FEE_WALLET_ETH';
    wallet = process.env[envKey];
  }

  if (!wallet) {
    throw new Error(
      `Platform fee wallet not configured for ${cryptocurrency}. ` +
        `Set ${envKey} environment variable.`
    );
  }

  return wallet;
}

/**
 * Derive a Bitcoin address and private key from mnemonic
 */
function deriveBitcoinWallet(
  mnemonic: string,
  index: number
): { address: string; privateKey: string } {
  const seed = mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  const path = `m/44'/0'/0'/0/${index}`;
  const child = hdKey.derive(path);

  if (!child.privateKey || !child.publicKey) {
    throw new Error('Failed to derive Bitcoin keys');
  }

  const { address } = bitcoin.payments.p2pkh({
    pubkey: Buffer.from(child.publicKey),
    network: bitcoin.networks.bitcoin,
  });

  if (!address) {
    throw new Error('Failed to generate Bitcoin address');
  }

  return {
    address,
    privateKey: Buffer.from(child.privateKey).toString('hex'),
  };
}

/**
 * CashAddr charset for Bitcoin Cash addresses
 */
const CASHADDR_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/**
 * Convert between bit sizes (used for CashAddr encoding)
 */
function convertBits(data: Uint8Array, fromBits: number, toBits: number, pad: boolean): number[] {
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

  if (pad) {
    if (bits > 0) {
      result.push((acc << (toBits - bits)) & maxv);
    }
  }

  return result;
}

/**
 * CashAddr polymod checksum calculation
 */
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

/**
 * Convert a P2PKH hash160 to CashAddr format
 */
function hashToCashAddress(hash160: Buffer): string {
  // Version byte: 0x00 for P2PKH
  const versionByte = 0x00;

  // Create payload: version byte + hash160
  const payload = Buffer.concat([Buffer.from([versionByte]), hash160]);

  // Convert to 5-bit groups for base32 encoding
  const data = convertBits(payload, 8, 5, true);

  // Calculate checksum
  const prefix = 'bitcoincash';
  const prefixData: number[] = [];
  for (let i = 0; i < prefix.length; i++) {
    prefixData.push(prefix.charCodeAt(i) & 0x1f);
  }
  prefixData.push(0); // separator

  const checksumInput = [...prefixData, ...data, 0, 0, 0, 0, 0, 0, 0, 0];
  const checksum = cashAddrPolymod(checksumInput) ^ 1n;

  // Extract 8 5-bit checksum values
  const checksumData: number[] = [];
  for (let i = 0; i < 8; i++) {
    checksumData.push(Number((checksum >> BigInt(5 * (7 - i))) & 0x1fn));
  }

  // Encode to CashAddr
  let result = prefix + ':';
  for (const d of [...data, ...checksumData]) {
    result += CASHADDR_CHARSET[d];
  }

  return result;
}

/**
 * Derive a Bitcoin Cash address and private key from mnemonic
 * BCH uses coin type 145 (BIP44) and CashAddr format
 */
function deriveBitcoinCashWallet(
  mnemonic: string,
  index: number
): { address: string; privateKey: string } {
  const seed = mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  // BCH uses coin type 145 per BIP44
  const path = `m/44'/145'/0'/0/${index}`;
  const child = hdKey.derive(path);

  if (!child.privateKey || !child.publicKey) {
    throw new Error('Failed to derive Bitcoin Cash keys');
  }

  // Get the hash160 from P2PKH payment
  const { hash } = bitcoin.payments.p2pkh({
    pubkey: Buffer.from(child.publicKey),
    network: bitcoin.networks.bitcoin,
  });

  if (!hash) {
    throw new Error('Failed to generate Bitcoin Cash address hash');
  }

  // Convert to CashAddr format
  const address = hashToCashAddress(hash);

  return {
    address,
    privateKey: Buffer.from(child.privateKey).toString('hex'),
  };
}

/**
 * Derive an Ethereum/Polygon address and private key from mnemonic
 */
function deriveEthereumWallet(
  mnemonic: string,
  index: number
): { address: string; privateKey: string } {
  const seed = mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  const path = `m/44'/60'/0'/0/${index}`;
  const child = hdKey.derive(path);

  if (!child.privateKey) {
    throw new Error('Failed to derive Ethereum keys');
  }

  const privateKeyHex = '0x' + Buffer.from(child.privateKey).toString('hex');
  const wallet = new ethers.Wallet(privateKeyHex);

  return {
    address: wallet.address,
    privateKey: Buffer.from(child.privateKey).toString('hex'),
  };
}

/**
 * Base58 alphabet for Solana addresses
 */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Encode bytes to base58
 */
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
  // Leading zeros
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    result += BASE58_ALPHABET[0];
  }
  // Convert digits to string
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }
  return result;
}

/**
 * SLIP-0010 Ed25519 key derivation
 * Derives Ed25519 keys using HMAC-SHA512 as per SLIP-0010 spec
 */
function deriveEd25519Key(seed: Buffer, path: string): { key: Buffer; chainCode: Buffer } {
  // Master key derivation
  const hmac = createHmac('sha512', 'ed25519 seed');
  hmac.update(seed);
  const I = hmac.digest();
  let key = I.subarray(0, 32);
  let chainCode = I.subarray(32);

  // Parse path
  const segments = path.split('/').slice(1); // Remove 'm'
  
  for (const segment of segments) {
    const hardened = segment.endsWith("'");
    const indexStr = hardened ? segment.slice(0, -1) : segment;
    const index = parseInt(indexStr, 10);
    
    if (hardened) {
      // Hardened derivation
      const data = Buffer.alloc(37);
      data[0] = 0;
      key.copy(data, 1);
      data.writeUInt32BE(index + 0x80000000, 33);
      
      const hmacChild = createHmac('sha512', chainCode);
      hmacChild.update(data);
      const childI = hmacChild.digest();
      key = childI.subarray(0, 32);
      chainCode = childI.subarray(32);
    } else {
      throw new Error('Ed25519 only supports hardened derivation');
    }
  }

  return { key, chainCode };
}

/**
 * Simple Ed25519 public key derivation using Node.js crypto
 * Note: This is a simplified implementation for address generation
 */
async function getEd25519PublicKey(privateKey: Buffer): Promise<Buffer> {
  // Use Node.js crypto for Ed25519
  const { createPrivateKey, createPublicKey } = await import('crypto');
  
  // Create a proper Ed25519 private key
  const privateKeyObj = createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'), // ASN.1 prefix for Ed25519 private key
      privateKey
    ]),
    format: 'der',
    type: 'pkcs8'
  });
  
  // Derive public key
  const publicKeyObj = createPublicKey(privateKeyObj);
  const publicKeyDer = publicKeyObj.export({ format: 'der', type: 'spki' });
  
  // Extract raw public key (last 32 bytes of DER encoding)
  return Buffer.from(publicKeyDer.subarray(-32));
}

/**
 * Derive a Solana address and private key from mnemonic
 * Uses SLIP-0010 Ed25519 derivation (no external dependencies with ws issues)
 */
async function deriveSolanaWallet(
  mnemonic: string,
  index: number
): Promise<{ address: string; privateKey: string }> {
  const seedUint8 = mnemonicToSeedSync(mnemonic);
  const seed = Buffer.from(seedUint8);
  const path = `m/44'/501'/${index}'/0'`;
  const { key } = deriveEd25519Key(seed, path);

  // Get public key using Node.js crypto
  const publicKey = await getEd25519PublicKey(key);

  return {
    address: base58Encode(publicKey),
    privateKey: key.toString('hex'),
  };
}

/**
 * Derive a Dogecoin address and private key from mnemonic
 * DOGE uses coin type 3 (BIP44)
 */
function deriveDogecoinWallet(
  mnemonic: string,
  index: number
): { address: string; privateKey: string } {
  const seed = mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  // DOGE uses coin type 3 per BIP44
  const path = `m/44'/3'/0'/0/${index}`;
  const child = hdKey.derive(path);

  if (!child.privateKey || !child.publicKey) {
    throw new Error('Failed to derive Dogecoin keys');
  }

  // DOGE uses P2PKH with version byte 0x1e (30)
  const pubkeyHash = bitcoin.crypto.hash160(Buffer.from(child.publicKey));
  const versionByte = Buffer.from([0x1e]); // DOGE mainnet P2PKH
  const payload = Buffer.concat([versionByte, pubkeyHash]);
  
  // Double SHA256 for checksum
  const checksum = bitcoin.crypto.hash256(payload).subarray(0, 4);
  const addressBytes = Buffer.concat([payload, checksum]);
  
  const address = base58Encode(addressBytes);

  return {
    address,
    privateKey: Buffer.from(child.privateKey).toString('hex'),
  };
}

/**
 * XRP Base58 alphabet (different from standard)
 */
const XRP_ALPHABET = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';

/**
 * Base58 encode with custom alphabet (for XRP)
 */
function base58EncodeWithAlphabet(bytes: Uint8Array, alphabet: string): string {
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
    result += alphabet[0];
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += alphabet[digits[i]];
  }
  return result;
}

/**
 * Derive an XRP address and private key from mnemonic
 * XRP uses coin type 144 (BIP44)
 */
function deriveXRPWallet(
  mnemonic: string,
  index: number
): { address: string; privateKey: string } {
  const seed = mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  // XRP uses coin type 144 per BIP44
  const path = `m/44'/144'/0'/0/${index}`;
  const child = hdKey.derive(path);

  if (!child.privateKey || !child.publicKey) {
    throw new Error('Failed to derive XRP keys');
  }

  // XRP uses RIPEMD160(SHA256(pubkey)) with version byte 0x00
  const pubkeyHash = bitcoin.crypto.hash160(Buffer.from(child.publicKey));
  const versionByte = Buffer.from([0x00]); // XRP mainnet
  const payload = Buffer.concat([versionByte, pubkeyHash]);
  
  // XRP uses a different checksum: first 4 bytes of SHA256(SHA256(payload))
  const checksum = bitcoin.crypto.hash256(payload).subarray(0, 4);
  const addressBytes = Buffer.concat([payload, checksum]);
  
  // XRP uses base58 with a different alphabet
  const address = base58EncodeWithAlphabet(addressBytes, XRP_ALPHABET);

  return {
    address,
    privateKey: Buffer.from(child.privateKey).toString('hex'),
  };
}

/**
 * Derive a Cardano address and private key from mnemonic (simplified)
 * ADA uses coin type 1815 (BIP44)
 * Note: Full Cardano address derivation is complex (uses Ed25519-BIP32)
 * This generates a simplified enterprise address for receiving
 */
async function deriveCardanoWallet(
  mnemonic: string,
  index: number
): Promise<{ address: string; privateKey: string }> {
  const seedUint8 = mnemonicToSeedSync(mnemonic);
  const seed = Buffer.from(seedUint8);
  // Cardano uses coin type 1815
  const path = `m/44'/1815'/${index}'/0'`;
  const { key } = deriveEd25519Key(seed, path);

  const publicKey = await getEd25519PublicKey(key);
  
  // Simplified: return hex-encoded public key as placeholder
  // Full Cardano addresses require bech32 encoding with specific prefixes
  // For production, use a proper Cardano library
  const address = `addr1_${publicKey.toString('hex').substring(0, 40)}...`;

  return {
    address,
    privateKey: key.toString('hex'),
  };
}

/**
 * Derive a unique payment address from the system's HD wallet
 */
export async function deriveSystemPaymentAddress(
  cryptocurrency: SystemBlockchain,
  index: number
): Promise<SystemDerivedAddress> {
  const mnemonic = getSystemMnemonic(cryptocurrency);
  let wallet: { address: string; privateKey: string };
  let derivationPath: string;

  switch (cryptocurrency) {
    case 'BTC':
      wallet = deriveBitcoinWallet(mnemonic, index);
      derivationPath = `m/44'/0'/0'/0/${index}`;
      break;
    case 'BCH':
      wallet = deriveBitcoinCashWallet(mnemonic, index);
      derivationPath = `m/44'/145'/0'/0/${index}`;
      break;
    case 'ETH':
    case 'POL':
    case 'BNB':
    case 'USDT':
    case 'USDC':
    case 'USDC_ETH':
    case 'USDC_POL':
      wallet = deriveEthereumWallet(mnemonic, index);
      derivationPath = `m/44'/60'/0'/0/${index}`;
      break;
    case 'SOL':
    case 'USDC_SOL':
      wallet = await deriveSolanaWallet(mnemonic, index);
      derivationPath = `m/44'/501'/${index}'/0'`;
      break;
    case 'DOGE':
      wallet = deriveDogecoinWallet(mnemonic, index);
      derivationPath = `m/44'/3'/0'/0/${index}`;
      break;
    case 'XRP':
      wallet = deriveXRPWallet(mnemonic, index);
      derivationPath = `m/44'/144'/0'/0/${index}`;
      break;
    case 'ADA':
      wallet = await deriveCardanoWallet(mnemonic, index);
      derivationPath = `m/44'/1815'/${index}'/0'`;
      break;
    default:
      throw new Error(`Unsupported cryptocurrency: ${cryptocurrency}`);
  }

  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
    index,
    derivationPath,
    cryptocurrency,
  };
}

/**
 * Generate a unique payment address for a new payment
 * This is the main function called when creating a payment
 *
 * @param supabase - Supabase client
 * @param paymentId - Payment ID
 * @param businessId - Business ID
 * @param cryptocurrency - Cryptocurrency type
 * @param merchantWallet - Merchant's wallet address
 * @param amountCrypto - Amount in cryptocurrency
 * @param isPaidTier - Whether merchant has a paid subscription (affects commission rate)
 */
export async function generatePaymentAddress(
  supabase: SupabaseClient,
  paymentId: string,
  businessId: string,
  cryptocurrency: SystemBlockchain,
  merchantWallet: string,
  amountCrypto: number,
  isPaidTier: boolean = true // Default to paid tier for backward compatibility
): Promise<{
  success: boolean;
  address?: string;
  paymentInfo?: PaymentAddressInfo;
  error?: string;
}> {
  try {
    // Get the next available index for this cryptocurrency
    const { data: indexData, error: indexError } = await supabase
      .from('system_wallet_indexes')
      .select('next_index')
      .eq('cryptocurrency', cryptocurrency)
      .single();

    let nextIndex = 0;
    if (indexError || !indexData) {
      // Initialize the index if it doesn't exist
      await supabase.from('system_wallet_indexes').insert({
        cryptocurrency,
        next_index: 1,
      });
    } else {
      nextIndex = indexData.next_index;
      // Increment the index atomically
      await supabase
        .from('system_wallet_indexes')
        .update({ next_index: nextIndex + 1 })
        .eq('cryptocurrency', cryptocurrency);
    }

    // Derive the payment address
    const derivedAddress = await deriveSystemPaymentAddress(cryptocurrency, nextIndex);

    // Encrypt the private key for storage
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      return {
        success: false,
        error: 'Encryption key not configured',
      };
    }
    const encryptedPrivateKey = await encrypt(derivedAddress.privateKey, encryptionKey);

    // Get commission wallet
    const commissionWallet = getCommissionWallet(cryptocurrency);

    // Calculate commission and merchant amounts based on subscription tier
    const commissionRate = getCommissionRate(isPaidTier);
    const commissionAmount = amountCrypto * commissionRate;
    const merchantAmount = amountCrypto - commissionAmount;

    // Store the payment address record
    const paymentInfo: PaymentAddressInfo = {
      payment_id: paymentId,
      address: derivedAddress.address,
      cryptocurrency,
      derivation_index: nextIndex,
      encrypted_private_key: encryptedPrivateKey,
      merchant_wallet: merchantWallet,
      commission_wallet: commissionWallet,
      amount_expected: amountCrypto,
      commission_amount: commissionAmount,
      merchant_amount: merchantAmount,
    };

    const { error: insertError } = await supabase
      .from('payment_addresses')
      .insert({
        payment_id: paymentId,
        business_id: businessId,
        cryptocurrency,
        address: derivedAddress.address,
        derivation_index: nextIndex,
        derivation_path: derivedAddress.derivationPath,
        encrypted_private_key: encryptedPrivateKey,
        merchant_wallet: merchantWallet,
        commission_wallet: commissionWallet,
        amount_expected: amountCrypto,
        commission_amount: commissionAmount,
        merchant_amount: merchantAmount,
        is_used: false,
      });

    if (insertError) {
      return {
        success: false,
        error: `Failed to store payment address: ${insertError.message}`,
      };
    }

    // Update the payment record with the generated address
    await supabase
      .from('payments')
      .update({ payment_address: derivedAddress.address })
      .eq('id', paymentId);

    return {
      success: true,
      address: derivedAddress.address,
      paymentInfo,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate payment address',
    };
  }
}

/**
 * Get the private key for a payment address (for forwarding)
 */
export async function getPaymentPrivateKey(
  supabase: SupabaseClient,
  paymentId: string
): Promise<{ success: boolean; privateKey?: string; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('payment_addresses')
      .select('encrypted_private_key')
      .eq('payment_id', paymentId)
      .single();

    if (error || !data) {
      return {
        success: false,
        error: 'Payment address not found',
      };
    }

    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      return {
        success: false,
        error: 'Encryption key not configured',
      };
    }

    const privateKey = await decrypt(data.encrypted_private_key, encryptionKey);

    return {
      success: true,
      privateKey,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get private key',
    };
  }
}

/**
 * Get payment address info for forwarding
 */
export async function getPaymentAddressInfo(
  supabase: SupabaseClient,
  paymentId: string
): Promise<{ success: boolean; info?: PaymentAddressInfo; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('payment_addresses')
      .select('*')
      .eq('payment_id', paymentId)
      .single();

    if (error || !data) {
      return {
        success: false,
        error: 'Payment address not found',
      };
    }

    return {
      success: true,
      info: data as PaymentAddressInfo,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get payment info',
    };
  }
}

/**
 * Calculate commission and merchant amounts based on subscription tier
 * @param totalAmount - Total payment amount
 * @param isPaidTier - Whether merchant has a paid subscription
 * @returns Commission and merchant amounts
 */
export function calculateTieredSplit(
  totalAmount: number,
  isPaidTier: boolean
): { commission: number; merchant: number; commissionRate: number } {
  const commissionRate = getCommissionRate(isPaidTier);
  const commission = totalAmount * commissionRate;
  const merchant = totalAmount - commission;
  return { commission, merchant, commissionRate };
}

/**
 * Calculate commission and merchant amounts
 * Uses paid tier rate for backward compatibility
 * @deprecated Use calculateTieredSplit(totalAmount, isPaidTier) instead
 */
export function calculateSplit(
  totalAmount: number
): { commission: number; merchant: number } {
  const { commission, merchant } = calculateTieredSplit(totalAmount, true);
  return { commission, merchant };
}

/**
 * Generate a new system mnemonic (for initial setup only)
 * This should be run once per cryptocurrency and stored securely
 */
export function generateSystemMnemonic(): string {
  return bip39GenerateMnemonic(wordlist, 256); // 24 words for extra security
}