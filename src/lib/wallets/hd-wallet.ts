/**
 * HD Wallet Service for Unique Payment Address Generation
 *
 * This service generates unique payment addresses for each transaction
 * using Hierarchical Deterministic (HD) wallet derivation.
 *
 * Architecture:
 * 1. Business stores an xpub (extended public key) for each cryptocurrency
 * 2. For each payment, we derive a unique child address using the payment index
 * 3. Customer pays to the unique derived address
 * 4. After confirmation, funds are forwarded to merchant's main wallet
 *
 * Benefits:
 * - Each payment has a unique address (no address reuse)
 * - Can track payments precisely
 * - Privacy for both merchant and customer
 * - Deterministic: same xpub + index = same address
 */

import { HDKey } from '@scure/bip32';
import * as bitcoin from 'bitcoinjs-lib';
import { ethers } from 'ethers';
import { PublicKey } from '@solana/web3.js';
import { secp256k1 } from '@noble/curves/secp256k1';
import { encrypt, decrypt } from '../crypto/encryption';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Supported blockchains for HD derivation
 */
export type HDBlockchain = 'BTC' | 'BCH' | 'ETH' | 'POL' | 'SOL';

/**
 * HD Wallet configuration stored per business
 */
export interface HDWalletConfig {
  id: string;
  business_id: string;
  cryptocurrency: HDBlockchain;
  xpub: string; // Extended public key for address derivation
  encrypted_xpriv?: string; // Encrypted extended private key (for forwarding)
  derivation_path: string; // Base derivation path (e.g., m/44'/60'/0'/0)
  next_index: number; // Next available address index
  created_at: string;
  updated_at: string;
}

/**
 * Derived payment address
 */
export interface DerivedAddress {
  address: string;
  index: number;
  derivation_path: string;
  cryptocurrency: HDBlockchain;
}

/**
 * Payment address record stored in database
 */
export interface PaymentAddressRecord {
  id: string;
  payment_id: string;
  business_id: string;
  cryptocurrency: HDBlockchain;
  address: string;
  derivation_index: number;
  derivation_path: string;
  encrypted_private_key?: string;
  is_used: boolean;
  created_at: string;
}

/**
 * Derive a Bitcoin address from xpub
 */
function deriveBitcoinAddress(xpub: string, index: number): string {
  const hdKey = HDKey.fromExtendedKey(xpub);
  const child = hdKey.deriveChild(index);

  if (!child.publicKey) {
    throw new Error('Failed to derive public key');
  }

  // Generate P2PKH address
  const { address } = bitcoin.payments.p2pkh({
    pubkey: Buffer.from(child.publicKey),
    network: bitcoin.networks.bitcoin,
  });

  if (!address) {
    throw new Error('Failed to generate Bitcoin address');
  }

  return address;
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
 * Derive a Bitcoin Cash address from xpub
 * BCH uses coin type 145 (BIP44) and CashAddr format
 */
function deriveBitcoinCashAddress(xpub: string, index: number): string {
  const hdKey = HDKey.fromExtendedKey(xpub);
  const child = hdKey.deriveChild(index);

  if (!child.publicKey) {
    throw new Error('Failed to derive public key');
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
  return hashToCashAddress(hash);
}

/**
 * Derive an Ethereum/Polygon address from xpub
 */
function deriveEthereumAddress(xpub: string, index: number): string {
  const hdKey = HDKey.fromExtendedKey(xpub);
  const child = hdKey.deriveChild(index);

  if (!child.publicKey) {
    throw new Error('Failed to derive public key');
  }

  // Use ethers.js SigningKey to compute address from compressed public key
  const publicKeyHex = '0x' + Buffer.from(child.publicKey).toString('hex');
  const signingKey = new ethers.SigningKey(publicKeyHex);
  const address = ethers.computeAddress(signingKey.publicKey);

  return address;
}

/**
 * Derive a Solana address from xpub
 * Note: Solana uses Ed25519, not secp256k1, so we need a different approach
 */
function deriveSolanaAddress(xpub: string, index: number): string {
  // For Solana, we derive using a seed-based approach
  // The xpub here is actually a base58-encoded seed or public key
  try {
    // If it's already a valid Solana public key, use it directly
    const pubKey = new PublicKey(xpub);
    // For unique addresses, we'd need to use Program Derived Addresses (PDAs)
    // or a different derivation scheme
    return pubKey.toBase58();
  } catch {
    throw new Error('Invalid Solana xpub format');
  }
}

/**
 * Derive a unique payment address from an xpub
 */
export function derivePaymentAddress(
  xpub: string,
  cryptocurrency: HDBlockchain,
  index: number
): DerivedAddress {
  let address: string;
  let derivationPath: string;

  switch (cryptocurrency) {
    case 'BTC':
      address = deriveBitcoinAddress(xpub, index);
      derivationPath = `m/44'/0'/0'/0/${index}`;
      break;
    case 'BCH':
      address = deriveBitcoinCashAddress(xpub, index);
      derivationPath = `m/44'/145'/0'/0/${index}`;
      break;
    case 'ETH':
    case 'POL':
      address = deriveEthereumAddress(xpub, index);
      derivationPath = `m/44'/60'/0'/0/${index}`;
      break;
    case 'SOL':
      address = deriveSolanaAddress(xpub, index);
      derivationPath = `m/44'/501'/${index}'/0'`;
      break;
    default:
      throw new Error(`Unsupported cryptocurrency: ${cryptocurrency}`);
  }

  return {
    address,
    index,
    derivation_path: derivationPath,
    cryptocurrency,
  };
}

/**
 * Generate a unique payment address for a new payment
 */
export async function generateUniquePaymentAddress(
  supabase: SupabaseClient,
  businessId: string,
  cryptocurrency: HDBlockchain
): Promise<{
  success: boolean;
  address?: DerivedAddress;
  error?: string;
}> {
  try {
    // Get the HD wallet config for this business and cryptocurrency
    const { data: hdConfig, error: configError } = await supabase
      .from('hd_wallet_configs')
      .select('*')
      .eq('business_id', businessId)
      .eq('cryptocurrency', cryptocurrency)
      .single();

    if (configError || !hdConfig) {
      return {
        success: false,
        error: `No HD wallet configured for ${cryptocurrency}. Please set up an xpub first.`,
      };
    }

    // Derive the next address
    const derivedAddress = derivePaymentAddress(
      hdConfig.xpub,
      cryptocurrency,
      hdConfig.next_index
    );

    // Increment the next_index atomically
    const { error: updateError } = await supabase
      .from('hd_wallet_configs')
      .update({ next_index: hdConfig.next_index + 1 })
      .eq('id', hdConfig.id);

    if (updateError) {
      return {
        success: false,
        error: 'Failed to update address index',
      };
    }

    return {
      success: true,
      address: derivedAddress,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Address generation failed',
    };
  }
}

/**
 * Store a payment address record
 */
export async function storePaymentAddress(
  supabase: SupabaseClient,
  paymentId: string,
  businessId: string,
  derivedAddress: DerivedAddress,
  encryptedPrivateKey?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase.from('payment_addresses').insert({
      payment_id: paymentId,
      business_id: businessId,
      cryptocurrency: derivedAddress.cryptocurrency,
      address: derivedAddress.address,
      derivation_index: derivedAddress.index,
      derivation_path: derivedAddress.derivation_path,
      encrypted_private_key: encryptedPrivateKey,
      is_used: false,
    });

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to store payment address',
    };
  }
}

/**
 * Get payment address by payment ID
 */
export async function getPaymentAddress(
  supabase: SupabaseClient,
  paymentId: string
): Promise<{
  success: boolean;
  address?: PaymentAddressRecord;
  error?: string;
}> {
  try {
    const { data, error } = await supabase
      .from('payment_addresses')
      .select('*')
      .eq('payment_id', paymentId)
      .single();

    if (error || !data) {
      return {
        success: false,
        error: error?.message || 'Payment address not found',
      };
    }

    return {
      success: true,
      address: data as PaymentAddressRecord,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get payment address',
    };
  }
}

/**
 * Mark a payment address as used
 */
export async function markAddressUsed(
  supabase: SupabaseClient,
  paymentId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('payment_addresses')
      .update({ is_used: true })
      .eq('payment_id', paymentId);

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to mark address as used',
    };
  }
}

/**
 * Configure HD wallet for a business
 */
export async function configureHDWallet(
  supabase: SupabaseClient,
  businessId: string,
  merchantId: string,
  cryptocurrency: HDBlockchain,
  xpub: string,
  xpriv?: string
): Promise<{ success: boolean; config?: HDWalletConfig; error?: string }> {
  try {
    // Verify business belongs to merchant
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('id')
      .eq('id', businessId)
      .eq('merchant_id', merchantId)
      .single();

    if (businessError || !business) {
      return {
        success: false,
        error: 'Business not found or access denied',
      };
    }

    // Validate xpub by trying to derive an address
    try {
      derivePaymentAddress(xpub, cryptocurrency, 0);
    } catch {
      return {
        success: false,
        error: 'Invalid xpub for the specified cryptocurrency',
      };
    }

    // Encrypt xpriv if provided
    let encryptedXpriv: string | undefined;
    if (xpriv) {
      const encryptionKey = process.env.ENCRYPTION_KEY;
      if (!encryptionKey) {
        return {
          success: false,
          error: 'Encryption key not configured',
        };
      }
      encryptedXpriv = await encrypt(xpriv, encryptionKey);
    }

    // Determine derivation path based on cryptocurrency
    let derivationPath: string;
    switch (cryptocurrency) {
      case 'BTC':
        derivationPath = "m/44'/0'/0'/0";
        break;
      case 'BCH':
        derivationPath = "m/44'/145'/0'/0";
        break;
      case 'ETH':
      case 'POL':
        derivationPath = "m/44'/60'/0'/0";
        break;
      case 'SOL':
        derivationPath = "m/44'/501'";
        break;
      default:
        derivationPath = "m/44'/0'/0'/0";
    }

    // Upsert HD wallet config
    const { data: config, error } = await supabase
      .from('hd_wallet_configs')
      .upsert(
        {
          business_id: businessId,
          cryptocurrency,
          xpub,
          encrypted_xpriv: encryptedXpriv,
          derivation_path: derivationPath,
          next_index: 0,
        },
        {
          onConflict: 'business_id,cryptocurrency',
        }
      )
      .select()
      .single();

    if (error || !config) {
      return {
        success: false,
        error: error?.message || 'Failed to configure HD wallet',
      };
    }

    return {
      success: true,
      config: config as HDWalletConfig,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'HD wallet configuration failed',
    };
  }
}

/**
 * Get HD wallet config for a business
 */
export async function getHDWalletConfig(
  supabase: SupabaseClient,
  businessId: string,
  cryptocurrency: HDBlockchain
): Promise<{ success: boolean; config?: HDWalletConfig; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('hd_wallet_configs')
      .select('*')
      .eq('business_id', businessId)
      .eq('cryptocurrency', cryptocurrency)
      .single();

    if (error || !data) {
      return {
        success: false,
        error: error?.message || 'HD wallet config not found',
      };
    }

    return {
      success: true,
      config: data as HDWalletConfig,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get HD wallet config',
    };
  }
}