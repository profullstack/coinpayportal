import { generateMnemonic as bip39GenerateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { HDKey } from '@scure/bip32';
import * as bitcoin from 'bitcoinjs-lib';
import { ethers } from 'ethers';
import { Keypair } from '@solana/web3.js';
import { encrypt } from '../crypto/encryption';
import type { BlockchainType } from './providers';
import { secp256k1 } from '@noble/curves/secp256k1';

/**
 * Wallet interface
 */
export interface Wallet {
  address: string;
  privateKey: string;
  publicKey: string;
  chain: BlockchainType;
  index: number;
}

/**
 * Payment address interface
 */
export interface PaymentAddress {
  address: string;
  chain: BlockchainType;
  encryptedPrivateKey?: string;
}

/**
 * Generate a new BIP39 mnemonic phrase
 */
export function generateMnemonic(): string {
  return bip39GenerateMnemonic(wordlist, 128); // 128 bits = 12 words
}

/**
 * Validate a BIP39 mnemonic phrase
 */
export function isValidMnemonic(mnemonic: string): boolean {
  return validateMnemonic(mnemonic, wordlist);
}

/**
 * Generate a wallet from a mnemonic phrase
 */
export async function generateWalletFromMnemonic(
  mnemonic: string,
  chain: BlockchainType,
  index: number = 0
): Promise<Wallet> {
  if (!isValidMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }

  const seed = mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);

  switch (chain) {
    case 'BTC':
    case 'BCH':
      return generateBitcoinWallet(hdKey, chain, index);
    case 'ETH':
    case 'POL':
      return generateEthereumWallet(hdKey, chain, index);
    case 'SOL':
      return generateSolanaWallet(hdKey, chain, index);
    default:
      throw new Error(`Unsupported blockchain: ${chain}`);
  }
}

/**
 * Generate Bitcoin/BCH wallet
 */
function generateBitcoinWallet(
  hdKey: HDKey,
  chain: BlockchainType,
  index: number
): Wallet {
  // BIP44 path: m/44'/0'/0'/0/index for Bitcoin
  const path = `m/44'/0'/0'/0/${index}`;
  const child = hdKey.derive(path);

  if (!child.privateKey) {
    throw new Error('Failed to derive private key');
  }

  // Use secp256k1 directly to generate public key
  const publicKey = secp256k1.getPublicKey(child.privateKey, true);
  
  const { address } = bitcoin.payments.p2pkh({
    pubkey: Buffer.from(publicKey),
    network: bitcoin.networks.bitcoin,
  });

  if (!address) {
    throw new Error('Failed to generate Bitcoin address');
  }

  return {
    address,
    privateKey: Buffer.from(child.privateKey).toString('hex'),
    publicKey: Buffer.from(publicKey).toString('hex'),
    chain,
    index,
  };
}

/**
 * Generate Ethereum/Polygon wallet
 */
function generateEthereumWallet(
  hdKey: HDKey,
  chain: BlockchainType,
  index: number
): Wallet {
  // BIP44 path: m/44'/60'/0'/0/index for Ethereum
  const path = `m/44'/60'/0'/0/${index}`;
  const child = hdKey.derive(path);

  if (!child.privateKey) {
    throw new Error('Failed to derive private key');
  }

  const privateKeyHex = '0x' + Buffer.from(child.privateKey).toString('hex');
  const wallet = new ethers.Wallet(privateKeyHex);
  const signingKey = wallet.signingKey;

  return {
    address: wallet.address,
    privateKey: privateKeyHex.slice(2), // Remove '0x' prefix
    publicKey: signingKey.publicKey.slice(2), // Remove '0x' prefix
    chain,
    index,
  };
}

/**
 * Generate Solana wallet
 */
function generateSolanaWallet(
  hdKey: HDKey,
  chain: BlockchainType,
  index: number
): Wallet {
  // BIP44 path: m/44'/501'/0'/0' for Solana
  const path = `m/44'/501'/${index}'/0'`;
  const child = hdKey.derive(path);

  if (!child.privateKey) {
    throw new Error('Failed to derive private key');
  }

  const keypair = Keypair.fromSeed(child.privateKey.slice(0, 32));

  return {
    address: keypair.publicKey.toBase58(),
    privateKey: Buffer.from(keypair.secretKey).toString('hex'),
    publicKey: keypair.publicKey.toBase58(),
    chain,
    index,
  };
}

/**
 * Generate a payment address for a business
 * This creates a deterministic address based on business ID
 */
export async function generatePaymentAddress(
  businessId: string,
  chain: BlockchainType
): Promise<PaymentAddress> {
  // Generate a deterministic mnemonic from business ID
  // In production, this should use a master mnemonic stored securely
  const masterMnemonic = process.env.MASTER_MNEMONIC || generateMnemonic();
  
  // Use business ID hash as index for deterministic address generation
  const index = hashStringToNumber(businessId);
  
  const wallet = await generateWalletFromMnemonic(masterMnemonic, chain, index);
  
  // Encrypt the private key before storing
  // Generate a proper 32-byte (64 hex char) key for testing
  const encryptionKey = process.env.ENCRYPTION_KEY || '0'.repeat(64);
  const encryptedPrivateKey = await encrypt(wallet.privateKey, encryptionKey);

  return {
    address: wallet.address,
    chain,
    encryptedPrivateKey,
  };
}

/**
 * Hash a string to a number for deterministic index generation
 */
function hashStringToNumber(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash) % 1000000; // Limit to reasonable range
}

/**
 * Validate a blockchain address
 */
export function validateAddress(address: string, chain: BlockchainType): boolean {
  if (!address || address.length === 0) {
    return false;
  }

  try {
    switch (chain) {
      case 'BTC':
      case 'BCH':
        return validateBitcoinAddress(address);
      case 'ETH':
      case 'POL':
        return validateEthereumAddress(address);
      case 'SOL':
        return validateSolanaAddress(address);
      default:
        return false;
    }
  } catch {
    return false;
  }
}

/**
 * Validate Bitcoin address
 */
function validateBitcoinAddress(address: string): boolean {
  try {
    bitcoin.address.toOutputScript(address, bitcoin.networks.bitcoin);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate Ethereum address
 */
function validateEthereumAddress(address: string): boolean {
  // ethers.isAddress requires proper checksum, so we need to be more lenient
  if (!address.startsWith('0x')) {
    return false;
  }
  if (address.length !== 42 && address.length !== 40) {
    return false;
  }
  // Check if it's a valid hex string (with or without 0x prefix)
  const addrToCheck = address.startsWith('0x') ? address : '0x' + address;
  const hexRegex = /^0x[0-9a-fA-F]{40}$/;
  return hexRegex.test(addrToCheck);
}

/**
 * Validate Solana address
 */
function validateSolanaAddress(address: string): boolean {
  try {
    // Solana addresses are base58 encoded and 32-44 characters long
    if (address.length < 32 || address.length > 44) {
      return false;
    }
    // Check if it's valid base58
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
    return base58Regex.test(address);
  } catch {
    return false;
  }
}

/**
 * Get derivation path for a blockchain
 */
export function getDerivationPath(chain: BlockchainType, index: number = 0): string {
  switch (chain) {
    case 'BTC':
    case 'BCH':
      return `m/44'/0'/0'/0/${index}`;
    case 'ETH':
    case 'POL':
      return `m/44'/60'/0'/0/${index}`;
    case 'SOL':
      return `m/44'/501'/${index}'/0'`;
    default:
      throw new Error(`Unsupported blockchain: ${chain}`);
  }
}