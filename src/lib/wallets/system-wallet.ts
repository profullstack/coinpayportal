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

/**
 * Supported blockchains
 */
export type SystemBlockchain = 'BTC' | 'ETH' | 'MATIC' | 'SOL';

/**
 * Commission rate (0.5%)
 */
export const COMMISSION_RATE = 0.005;

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
  const envKey = `SYSTEM_MNEMONIC_${cryptocurrency}`;
  const mnemonic = process.env[envKey];

  if (!mnemonic) {
    throw new Error(
      `System mnemonic not configured for ${cryptocurrency}. ` +
        `Set ${envKey} environment variable.`
    );
  }

  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new Error(`Invalid system mnemonic for ${cryptocurrency}`);
  }

  return mnemonic;
}

/**
 * Get the system's commission wallet address
 */
function getCommissionWallet(cryptocurrency: SystemBlockchain): string {
  const envKey = `COMMISSION_WALLET_${cryptocurrency}`;
  const wallet = process.env[envKey];

  if (!wallet) {
    throw new Error(
      `Commission wallet not configured for ${cryptocurrency}. ` +
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
    case 'ETH':
    case 'MATIC':
      wallet = deriveEthereumWallet(mnemonic, index);
      derivationPath = `m/44'/60'/0'/0/${index}`;
      break;
    case 'SOL':
      wallet = await deriveSolanaWallet(mnemonic, index);
      derivationPath = `m/44'/501'/${index}'/0'`;
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
 */
export async function generatePaymentAddress(
  supabase: SupabaseClient,
  paymentId: string,
  businessId: string,
  cryptocurrency: SystemBlockchain,
  merchantWallet: string,
  amountCrypto: number
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

    // Calculate commission and merchant amounts
    const commissionAmount = amountCrypto * COMMISSION_RATE;
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
 * Calculate commission and merchant amounts
 */
export function calculateSplit(
  totalAmount: number
): { commission: number; merchant: number } {
  const commission = totalAmount * COMMISSION_RATE;
  const merchant = totalAmount - commission;
  return { commission, merchant };
}

/**
 * Generate a new system mnemonic (for initial setup only)
 * This should be run once per cryptocurrency and stored securely
 */
export function generateSystemMnemonic(): string {
  return bip39GenerateMnemonic(wordlist, 256); // 24 words for extra security
}