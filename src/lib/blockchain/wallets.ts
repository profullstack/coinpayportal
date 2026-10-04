import { generateMnemonic as bip39GenerateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { HDKey } from '@scure/bip32';
import * as bitcoin from 'bitcoinjs-lib';
import { ethers } from 'ethers';
import { Keypair } from '@solana/web3.js';
import { encrypt } from '../crypto/encryption';
import { requireEncryptionKey, requireMasterMnemonic } from '../crypto/require-key';
import type { BlockchainType } from './providers';
import { secp256k1 } from '@noble/curves/secp256k1';
import { createHash } from 'crypto';

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
  chain: BlockchainType,
  /**
   * Explicit derivation index, overriding the hash of `businessId`.
   *
   * F-1.3-14: the hash alone is not safe to derive money-holding addresses
   * from — see `hashStringToNumber`. Callers that can check the resulting
   * address for uniqueness pass an index and retry on collision.
   */
  indexOverride?: number
): Promise<PaymentAddress> {
  // Both secrets are fail-closed: an ephemeral mnemonic loses the keys to any
  // funds received at the derived address, and a fallback encryption key means
  // a database leak alone decrypts every private key.
  const masterMnemonic = requireMasterMnemonic();

  // Use business ID hash as index for deterministic address generation
  const index = indexOverride ?? hashStringToNumber(businessId);

  const wallet = await generateWalletFromMnemonic(masterMnemonic, chain, index);

  const encryptedPrivateKey = await encrypt(wallet.privateKey, requireEncryptionKey('address derivation'));

  return {
    address: wallet.address,
    chain,
    encryptedPrivateKey,
  };
}

/**
 * Hash a string to a derivation index.
 *
 * F-1.3-14: this is a 32-bit string fold reduced modulo 10^6, and the addresses
 * it derives hold customer money. A million slots means two different inputs
 * share an index — and therefore an address and a private key — with about even
 * odds by the 1,180th one. When that happens, one collection payment's funds
 * land at another's address: the balance check confirms the wrong payment, and
 * the sweep sends the money to the wrong destination. It is not an attack, just
 * arithmetic.
 *
 * The range is widened to the full non-hardened BIP32 space using a real hash,
 * which pushes the even-odds point from ~1,180 to ~54,000. That is a mitigation
 * rather than a fix, and it is deliberately not the whole answer: callers that
 * can check for uniqueness pass `indexOverride` and retry, which is what makes
 * a collision impossible rather than merely unlikely.
 */
export function hashStringToNumber(str: string): number {
  // 2^31 - 1: the largest non-hardened BIP32 index.
  const MAX_INDEX = 0x7fffffff;
  const digest = createHash('sha256').update(str).digest();
  return digest.readUInt32BE(0) % MAX_INDEX;
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