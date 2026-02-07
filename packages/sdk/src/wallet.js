/**
 * Wallet Module for CoinPay SDK
 * 
 * Client-side wallet management with server-side address registration.
 * IMPORTANT: Mnemonic/seed phrases are NEVER sent to the server.
 * Only public keys and signed proofs are transmitted.
 */

import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { HDKey } from '@scure/bip32';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/ripemd160.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { ed25519 } from '@noble/curves/ed25519';
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

const DEFAULT_BASE_URL = 'https://coinpayportal.com/api';

/**
 * Supported blockchain chains
 */
export const WalletChain = {
  BTC: 'BTC',
  BCH: 'BCH',
  ETH: 'ETH',
  POL: 'POL',
  SOL: 'SOL',
  BNB: 'BNB',
  USDC_ETH: 'USDC_ETH',
  USDC_POL: 'USDC_POL',
  USDC_SOL: 'USDC_SOL',
  USDT_ETH: 'USDT_ETH',
  USDT_POL: 'USDT_POL',
  USDT_SOL: 'USDT_SOL',
};

/**
 * Default chains to derive on wallet creation
 */
export const DEFAULT_CHAINS = ['BTC', 'ETH', 'SOL', 'POL', 'BCH'];

/**
 * BIP44 coin types for derivation paths
 */
const COIN_TYPES = {
  BTC: 0,
  BCH: 145,
  ETH: 60,
  POL: 60, // Uses ETH path
  BNB: 60, // Uses ETH path (BSC is EVM)
  SOL: 501,
  USDC_ETH: 60,
  USDC_POL: 60,
  USDC_SOL: 501,
  USDT_ETH: 60,
  USDT_POL: 60,
  USDT_SOL: 501,
};

/**
 * Chains that use secp256k1 curve (vs ed25519 for Solana)
 */
const SECP256K1_CHAINS = ['BTC', 'BCH', 'ETH', 'POL', 'BNB', 'USDC_ETH', 'USDC_POL', 'USDT_ETH', 'USDT_POL'];

// ============================================================
// Address derivation helpers
// ============================================================

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Base58 encode a byte array
 */
function base58Encode(bytes) {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
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
  // Leading zeros
  let result = '';
  for (const byte of bytes) {
    if (byte === 0) result += BASE58_ALPHABET[0];
    else break;
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }
  return result;
}

/**
 * Base58Check encode (used for BTC addresses)
 */
function base58CheckEncode(version, payload) {
  const data = new Uint8Array(1 + payload.length);
  data[0] = version;
  data.set(payload, 1);
  const checksum = sha256(sha256(data)).slice(0, 4);
  const full = new Uint8Array(data.length + 4);
  full.set(data);
  full.set(checksum, data.length);
  return base58Encode(full);
}

/**
 * Hash160: SHA256 then RIPEMD160
 */
function hash160(data) {
  return ripemd160(sha256(data));
}

/**
 * Derive BTC P2PKH address from compressed public key
 */
function deriveBTCAddress(compressedPubKey) {
  const h = hash160(compressedPubKey);
  return base58CheckEncode(0x00, h);
}

/**
 * Derive BCH CashAddr from compressed public key
 * Uses simplified CashAddr encoding (lowercase bech32-like with bitcoincash: prefix)
 */
function deriveBCHAddress(compressedPubKey) {
  const h = hash160(compressedPubKey);
  // CashAddr encoding
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  
  // Convert hash160 to 5-bit groups with version byte
  // Version byte: 0 = P2PKH, 160-bit hash → type=0, hash_size=0 → version_byte = 0
  const payload8 = new Uint8Array(1 + h.length);
  payload8[0] = 0; // version byte
  payload8.set(h, 1);
  
  // Convert 8-bit to 5-bit
  const payload5 = convertBits(payload8, 8, 5, true);
  
  // Polymod checksum
  const prefixData = expandPrefix('bitcoincash');
  const checksumInput = new Uint8Array(prefixData.length + payload5.length + 8);
  checksumInput.set(prefixData);
  checksumInput.set(payload5, prefixData.length);
  // Last 8 bytes are zeros for checksum calculation
  const polymod = cashAddrPolymod(checksumInput) ^ 1n;
  
  const checksum = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    checksum[i] = Number((polymod >> BigInt(5 * (7 - i))) & 0x1fn);
  }
  
  let encoded = 'bitcoincash:';
  for (const val of payload5) encoded += CHARSET[val];
  for (const val of checksum) encoded += CHARSET[val];
  
  return encoded;
}

function convertBits(data, fromBits, toBits, pad) {
  let acc = 0;
  let bits = 0;
  const result = [];
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
  return new Uint8Array(result);
}

function expandPrefix(prefix) {
  const result = new Uint8Array(prefix.length + 1);
  for (let i = 0; i < prefix.length; i++) {
    result[i] = prefix.charCodeAt(i) & 0x1f;
  }
  result[prefix.length] = 0;
  return result;
}

function cashAddrPolymod(values) {
  const GENERATORS = [
    0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n
  ];
  let c = 1n;
  for (const d of values) {
    const c0 = c >> 35n;
    c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(d);
    for (let i = 0; i < 5; i++) {
      if ((c0 >> BigInt(i)) & 1n) {
        c ^= GENERATORS[i];
      }
    }
  }
  return c;
}

/**
 * Derive ETH/EVM address from compressed public key bytes
 */
function deriveETHAddress(compressedPubKey) {
  // Decompress: get uncompressed point (65 bytes: 04 || x || y)
  const point = secp256k1.ProjectivePoint.fromHex(compressedPubKey);
  const uncompressed = point.toRawBytes(false); // 65 bytes with 04 prefix
  // Keccak256 of the 64 bytes (without 04 prefix)
  const hash = keccak_256(uncompressed.slice(1));
  // Last 20 bytes — EIP-55 checksummed
  const addr = bytesToHex(hash.slice(12));
  const addrHash = bytesToHex(keccak_256(new TextEncoder().encode(addr)));
  let checksummed = '';
  for (let i = 0; i < addr.length; i++) {
    checksummed += parseInt(addrHash[i], 16) >= 8 ? addr[i].toUpperCase() : addr[i];
  }
  return '0x' + checksummed;
}

/**
 * SLIP-0010 ed25519 key derivation from seed
 * Solana uses ed25519, derived via SLIP-0010 (not BIP32 secp256k1)
 */
function deriveEd25519Key(seed, path) {
  // SLIP-0010 master key derivation
  const I = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed);
  let key = I.slice(0, 32);
  let chainCode = I.slice(32);
  
  // Parse path
  const segments = path.replace('m/', '').split('/');
  for (const seg of segments) {
    const hardened = seg.endsWith("'");
    const index = parseInt(seg.replace("'", ''), 10);
    if (!hardened) throw new Error('SLIP-0010 ed25519 only supports hardened derivation');
    
    const indexBuf = new Uint8Array(4);
    const val = (index | 0x80000000) >>> 0;
    indexBuf[0] = (val >> 24) & 0xff;
    indexBuf[1] = (val >> 16) & 0xff;
    indexBuf[2] = (val >> 8) & 0xff;
    indexBuf[3] = val & 0xff;
    
    const data = new Uint8Array(1 + 32 + 4);
    data[0] = 0x00;
    data.set(key, 1);
    data.set(indexBuf, 33);
    
    const derived = hmac(sha512, chainCode, data);
    key = derived.slice(0, 32);
    chainCode = derived.slice(32);
  }
  
  return key;
}

/**
 * Derive SOL address from seed using SLIP-0010 ed25519
 */
function deriveSOLAddress(seed, index = 0) {
  const path = `m/44'/501'/${index}'/0'`;
  const privateKey = deriveEd25519Key(seed, path);
  const publicKey = ed25519.getPublicKey(privateKey);
  return { address: base58Encode(publicKey), publicKey, privateKey, path };
}

/**
 * Derive the blockchain address for a given chain from seed/public key
 * @param {Uint8Array} seed - Master seed
 * @param {string} chain - Chain code
 * @param {number} index - Derivation index
 * @returns {string} The derived address
 */
export function deriveAddress(seed, chain, index = 0) {
  // Solana-based chains
  if (chain === 'SOL' || chain === 'USDC_SOL' || chain === 'USDT_SOL') {
    return deriveSOLAddress(seed, index).address;
  }
  
  // secp256k1-based chains
  const { publicKey } = deriveKeyPair(seed, chain, index);
  
  switch (chain) {
    case 'BTC':
      return deriveBTCAddress(publicKey);
    case 'BCH':
      return deriveBCHAddress(publicKey);
    case 'ETH':
    case 'POL':
    case 'BNB':
    case 'USDC_ETH':
    case 'USDC_POL':
    case 'USDT_ETH':
    case 'USDT_POL':
      return deriveETHAddress(publicKey);
    default:
      throw new Error(`Unsupported chain for address derivation: ${chain}`);
  }
}

/**
 * Generate a new mnemonic phrase
 * @param {number} [words=12] - Number of words (12 or 24)
 * @returns {string} BIP39 mnemonic phrase
 */
export function generateMnemonic(words = 12) {
  if (words !== 12 && words !== 24) {
    throw new Error('Invalid word count. Must be 12 or 24.');
  }
  const strength = words === 12 ? 128 : 256;
  return bip39.generateMnemonic(wordlist, strength);
}

/**
 * Validate a mnemonic phrase
 * @param {string} mnemonic - BIP39 mnemonic phrase
 * @returns {boolean} Whether the mnemonic is valid
 */
export function validateMnemonic(mnemonic) {
  if (!mnemonic || typeof mnemonic !== 'string') {
    return false;
  }
  return bip39.validateMnemonic(mnemonic.trim(), wordlist);
}

/**
 * Derive seed from mnemonic
 * @param {string} mnemonic - BIP39 mnemonic phrase
 * @returns {Uint8Array} Seed bytes
 */
function mnemonicToSeed(mnemonic) {
  return bip39.mnemonicToSeedSync(mnemonic.trim());
}

/**
 * Get derivation path for a chain
 * @param {string} chain - Chain code
 * @param {number} [index=0] - Address index
 * @returns {string} BIP44 derivation path
 */
export function getDerivationPath(chain, index = 0) {
  const coinType = COIN_TYPES[chain];
  if (coinType === undefined) {
    throw new Error(`Unsupported chain: ${chain}`);
  }
  
  // BIP44 path: m / purpose' / coin_type' / account' / change / address_index
  if (chain === 'SOL' || chain.startsWith('USDC_SOL') || chain.startsWith('USDT_SOL')) {
    // Solana uses different derivation
    return `m/44'/${coinType}'/${index}'/0'`;
  }
  
  return `m/44'/${coinType}'/0'/0/${index}`;
}

/**
 * Derive key pair from seed for a specific chain
 * @private
 */
function deriveKeyPair(seed, chain, index = 0) {
  const path = getDerivationPath(chain, index);
  const hdKey = HDKey.fromMasterSeed(seed);
  const derived = hdKey.derive(path);
  
  if (!derived.privateKey) {
    throw new Error('Failed to derive private key');
  }
  
  return {
    privateKey: derived.privateKey,
    publicKey: derived.publicKey,
    path,
  };
}

/**
 * Get public key hex from seed for secp256k1 chains
 * @private
 */
function getSecp256k1PublicKey(seed) {
  // Use ETH derivation for the master secp256k1 key
  const hdKey = HDKey.fromMasterSeed(seed);
  const derived = hdKey.derive("m/44'/60'/0'/0/0");
  return bytesToHex(derived.publicKey);
}

/**
 * Sign a message with secp256k1 private key
 * @private
 */
function signMessage(message, privateKey) {
  const messageHash = sha256(new TextEncoder().encode(message));
  const signature = secp256k1.sign(messageHash, privateKey);
  // Handle different noble-curves versions:
  // v1.x returns Signature object with toCompactHex()
  // v2.x returns raw Uint8Array directly
  if (signature instanceof Uint8Array) {
    return bytesToHex(signature);
  }
  if (typeof signature.toCompactHex === 'function') {
    return signature.toCompactHex();
  }
  // Fallback: try toCompactRawBytes
  return bytesToHex(signature.toCompactRawBytes());
}

/**
 * Derive address placeholder - actual address derivation happens on client
 * This returns the public key that the server can use to verify ownership
 * @private
 */
function deriveAddressInfo(seed, chain, index = 0) {
  const address = deriveAddress(seed, chain, index);
  const path = getDerivationPath(chain, index);
  
  // For SOL chains, the public key is derived differently (ed25519)
  let publicKeyHex;
  if (chain === 'SOL' || chain === 'USDC_SOL' || chain === 'USDT_SOL') {
    const solInfo = deriveSOLAddress(seed, index);
    publicKeyHex = bytesToHex(solInfo.publicKey);
  } else {
    const { publicKey } = deriveKeyPair(seed, chain, index);
    publicKeyHex = bytesToHex(publicKey);
  }
  
  return {
    chain,
    address,
    publicKey: publicKeyHex,
    derivation_path: path,
    derivation_index: index,
  };
}

/**
 * WalletClient - Manages wallet operations
 * 
 * The wallet client handles:
 * - Local key derivation (seed never leaves client)
 * - Server registration of public keys/addresses
 * - Authenticated API calls using signature-based auth
 */
export class WalletClient {
  #mnemonic;
  #seed;
  #walletId;
  #authToken;
  #baseUrl;
  #timeout;
  #publicKeySecp256k1;
  
  /**
   * Create a wallet client
   * @private - Use WalletClient.create() or WalletClient.fromSeed() instead
   */
  constructor(options = {}) {
    this.#baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.#timeout = options.timeout || 30000;
    this.#mnemonic = options.mnemonic || null;
    this.#seed = options.seed || null;
    this.#walletId = options.walletId || null;
    this.#authToken = options.authToken || null;
    this.#publicKeySecp256k1 = options.publicKeySecp256k1 || null;
  }
  
  /**
   * Create a new wallet with a fresh mnemonic
   * @param {Object} options - Creation options
   * @param {number} [options.words=12] - Number of words (12 or 24)
   * @param {string[]} [options.chains] - Chains to derive initial addresses for
   * @param {string} [options.baseUrl] - API base URL
   * @param {number} [options.timeout] - Request timeout
   * @returns {Promise<WalletClient>} Wallet client with fresh mnemonic
   */
  static async create(options = {}) {
    const words = options.words || 12;
    const chains = options.chains || DEFAULT_CHAINS;
    
    const mnemonic = generateMnemonic(words);
    const seed = mnemonicToSeed(mnemonic);
    const publicKeySecp256k1 = getSecp256k1PublicKey(seed);
    
    const client = new WalletClient({
      baseUrl: options.baseUrl,
      timeout: options.timeout,
      mnemonic,
      seed,
      publicKeySecp256k1,
    });
    
    // Register wallet with server
    const initialAddresses = chains.map(chain => {
      const info = deriveAddressInfo(seed, chain, 0);
      // For registration, we need to provide a placeholder address
      // The actual address would be derived client-side with full implementation
      return {
        chain: info.chain,
        address: info.address,
        derivation_path: info.derivation_path,
      };
    });
    
    const result = await client.#request('/web-wallet/create', {
      method: 'POST',
      body: JSON.stringify({
        public_key_secp256k1: publicKeySecp256k1,
        initial_addresses: initialAddresses,
      }),
    });
    
    client.#walletId = result.wallet_id;
    
    return client;
  }
  
  /**
   * Import an existing wallet from a mnemonic
   * @param {string} mnemonic - BIP39 mnemonic phrase
   * @param {Object} options - Import options
   * @param {string[]} [options.chains] - Chains to derive addresses for
   * @param {string} [options.baseUrl] - API base URL
   * @param {number} [options.timeout] - Request timeout
   * @returns {Promise<WalletClient>} Wallet client with imported mnemonic
   */
  static async fromSeed(mnemonic, options = {}) {
    if (!validateMnemonic(mnemonic)) {
      throw new Error('Invalid mnemonic phrase');
    }
    
    const chains = options.chains || DEFAULT_CHAINS;
    const seed = mnemonicToSeed(mnemonic);
    const publicKeySecp256k1 = getSecp256k1PublicKey(seed);
    
    const client = new WalletClient({
      baseUrl: options.baseUrl,
      timeout: options.timeout,
      mnemonic: mnemonic.trim(),
      seed,
      publicKeySecp256k1,
    });
    
    // Create proof of ownership
    const proofMessage = `CoinPay Wallet Import: ${Date.now()}`;
    const { privateKey } = deriveKeyPair(seed, 'ETH', 0);
    const signature = signMessage(proofMessage, privateKey);
    
    // Derive addresses for registration
    const addresses = chains.map(chain => {
      const info = deriveAddressInfo(seed, chain, 0);
      return {
        chain: info.chain,
        address: info.address,
        derivation_path: info.derivation_path,
      };
    });
    
    // Register/import wallet with server
    const result = await client.#request('/web-wallet/import', {
      method: 'POST',
      body: JSON.stringify({
        public_key_secp256k1: publicKeySecp256k1,
        addresses,
        proof_of_ownership: {
          message: proofMessage,
          signature,
        },
      }),
    });
    
    client.#walletId = result.wallet_id;
    
    return client;
  }
  
  /**
   * Make an API request
   * @private
   */
  async #request(endpoint, options = {}) {
    const url = `${this.#baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.#timeout);
    
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };
    
    // Add auth token if we have one
    if (this.#authToken) {
      headers['Authorization'] = `Bearer ${this.#authToken}`;
    }
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers,
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        const error = new Error(data.error || `HTTP ${response.status}`);
        error.status = response.status;
        error.code = data.code;
        error.response = data;
        throw error;
      }
      
      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.#timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  
  /**
   * Authenticate with the server to get a JWT token
   * @returns {Promise<void>}
   */
  async authenticate() {
    if (!this.#walletId || !this.#seed) {
      throw new Error('Wallet not initialized. Use create() or fromSeed() first.');
    }
    
    // Get challenge
    const { challenge } = await this.#request(`/web-wallet/auth/challenge`, {
      method: 'POST',
      body: JSON.stringify({ wallet_id: this.#walletId }),
    });
    
    // Sign challenge
    const { privateKey } = deriveKeyPair(this.#seed, 'ETH', 0);
    const signature = signMessage(challenge, privateKey);
    
    // Verify and get token
    const result = await this.#request('/web-wallet/auth/verify', {
      method: 'POST',
      body: JSON.stringify({
        wallet_id: this.#walletId,
        challenge_id: result.challenge_id,
        signature,
      }),
    });
    
    this.#authToken = result.auth_token;
  }
  
  /**
   * Get the mnemonic phrase (for backup)
   * @returns {string|null} Mnemonic phrase
   */
  getMnemonic() {
    return this.#mnemonic;
  }
  
  /**
   * Get the wallet ID
   * @returns {string|null} Wallet ID
   */
  getWalletId() {
    return this.#walletId;
  }
  
  /**
   * Get wallet info
   * @returns {Promise<Object>} Wallet information
   */
  async getInfo() {
    if (!this.#walletId) {
      throw new Error('Wallet not initialized');
    }
    
    return this.#request(`/web-wallet/${this.#walletId}`);
  }
  
  /**
   * Get all addresses for this wallet
   * @param {Object} [options] - Query options
   * @param {string} [options.chain] - Filter by chain
   * @param {boolean} [options.activeOnly=true] - Only return active addresses
   * @returns {Promise<Object>} Address list
   */
  async getAddresses(options = {}) {
    if (!this.#walletId) {
      throw new Error('Wallet not initialized');
    }
    
    const params = new URLSearchParams();
    if (options.chain) params.set('chain', options.chain);
    if (options.activeOnly !== false) params.set('active_only', 'true');
    
    const query = params.toString();
    const endpoint = `/web-wallet/${this.#walletId}/addresses${query ? `?${query}` : ''}`;
    
    return this.#request(endpoint);
  }
  
  /**
   * Derive a new address for a chain
   * @param {string} chain - Blockchain chain code
   * @param {number} [index=0] - Derivation index
   * @returns {Promise<Object>} Derived address info
   */
  async deriveAddress(chain, index = 0) {
    if (!this.#walletId || !this.#seed) {
      throw new Error('Wallet not initialized');
    }
    
    const info = deriveAddressInfo(this.#seed, chain, index);
    
    const result = await this.#request(`/web-wallet/${this.#walletId}/derive`, {
      method: 'POST',
      body: JSON.stringify({
        chain: info.chain,
        address: info.address,
        derivation_index: info.derivation_index,
        derivation_path: info.derivation_path,
      }),
    });
    
    return result;
  }
  
  /**
   * Derive addresses for any missing chains
   * @param {string[]} [targetChains] - Chains to check (default: all supported)
   * @returns {Promise<Object[]>} Newly derived addresses
   */
  async deriveMissingChains(targetChains) {
    const chains = targetChains || Object.keys(WalletChain);
    const { addresses } = await this.getAddresses({ activeOnly: true });
    
    const existingChains = new Set(addresses.map(a => a.chain));
    const missingChains = chains.filter(c => !existingChains.has(c));
    
    const results = [];
    for (const chain of missingChains) {
      try {
        const result = await this.deriveAddress(chain, 0);
        results.push(result);
      } catch (error) {
        console.warn(`Failed to derive ${chain}: ${error.message}`);
      }
    }
    
    return results;
  }
  
  /**
   * Get all balances for this wallet
   * @param {Object} [options] - Query options
   * @param {string} [options.chain] - Filter by chain
   * @param {boolean} [options.refresh=false] - Force refresh from blockchain
   * @returns {Promise<Object>} Balances
   */
  async getBalances(options = {}) {
    if (!this.#walletId) {
      throw new Error('Wallet not initialized');
    }
    
    const params = new URLSearchParams();
    if (options.chain) params.set('chain', options.chain);
    if (options.refresh) params.set('refresh', 'true');
    
    const query = params.toString();
    const endpoint = `/web-wallet/${this.#walletId}/balances${query ? `?${query}` : ''}`;
    
    return this.#request(endpoint);
  }
  
  /**
   * Get balance for a specific chain
   * @param {string} chain - Chain code
   * @returns {Promise<Object>} Balance for the chain
   */
  async getBalance(chain) {
    return this.getBalances({ chain });
  }
  
  /**
   * Send a transaction
   * @param {Object} options - Send options
   * @param {string} options.chain - Target chain
   * @param {string} options.to - Recipient address
   * @param {string} options.amount - Amount to send
   * @param {string} [options.priority='medium'] - Fee priority (low/medium/high)
   * @returns {Promise<Object>} Transaction result
   */
  async send(options) {
    if (!this.#walletId || !this.#seed) {
      throw new Error('Wallet not initialized');
    }
    
    const { chain, to, amount, priority = 'medium' } = options;
    
    if (!chain || !to || !amount) {
      throw new Error('chain, to, and amount are required');
    }
    
    // Get our address for this chain
    const { addresses } = await this.getAddresses({ chain });
    if (!addresses || addresses.length === 0) {
      throw new Error(`No address found for chain ${chain}`);
    }
    
    const fromAddress = addresses[0].address;
    
    // Step 1: Prepare the transaction
    const prepareResult = await this.#request(`/web-wallet/${this.#walletId}/prepare-tx`, {
      method: 'POST',
      body: JSON.stringify({
        from_address: fromAddress,
        to_address: to,
        chain,
        amount,
        priority,
      }),
    });
    
    // Step 2: Sign the transaction locally
    // Note: This is a simplified version - real implementation would need
    // chain-specific signing logic
    const { privateKey } = deriveKeyPair(this.#seed, chain, 0);
    const unsignedTx = prepareResult.unsigned_tx;
    
    // For EVM chains, sign the transaction hash
    // For BTC, sign each input
    // This is simplified - real implementation needs chain-specific logic
    const signedTx = signMessage(unsignedTx, privateKey);
    
    // Step 3: Broadcast the signed transaction
    const broadcastResult = await this.#request(`/web-wallet/${this.#walletId}/broadcast`, {
      method: 'POST',
      body: JSON.stringify({
        tx_id: prepareResult.tx_id,
        signed_tx: signedTx,
        chain,
      }),
    });
    
    return broadcastResult;
  }
  
  /**
   * Get transaction history
   * @param {Object} [options] - Query options
   * @param {string} [options.chain] - Filter by chain
   * @param {string} [options.direction] - Filter by direction (incoming/outgoing)
   * @param {number} [options.limit=50] - Number of results
   * @param {number} [options.offset=0] - Pagination offset
   * @returns {Promise<Object>} Transaction history
   */
  async getHistory(options = {}) {
    if (!this.#walletId) {
      throw new Error('Wallet not initialized');
    }
    
    const params = new URLSearchParams();
    if (options.chain) params.set('chain', options.chain);
    if (options.direction) params.set('direction', options.direction);
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));
    
    const query = params.toString();
    const endpoint = `/web-wallet/${this.#walletId}/transactions${query ? `?${query}` : ''}`;
    
    return this.#request(endpoint);
  }
  
  /**
   * Estimate transaction fee
   * @param {string} chain - Target chain
   * @param {string} [to] - Recipient address (optional, for more accurate estimate)
   * @param {string} [amount] - Amount (optional, for more accurate estimate)
   * @returns {Promise<Object>} Fee estimates
   */
  async estimateFee(chain, to, amount) {
    if (!this.#walletId) {
      throw new Error('Wallet not initialized');
    }
    
    const body = { chain };
    if (to) body.to_address = to;
    if (amount) body.amount = amount;
    
    return this.#request(`/web-wallet/${this.#walletId}/estimate-fee`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
  
  /**
   * Encrypt and backup the seed phrase
   * @param {string} password - Encryption password
   * @returns {Promise<string>} Encrypted seed (base64)
   */
  async backupSeed(password) {
    if (!this.#mnemonic) {
      throw new Error('No mnemonic available');
    }
    
    if (!password || password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }
    
    // Simple encryption using Web Crypto API
    const encoder = new TextEncoder();
    const data = encoder.encode(this.#mnemonic);
    
    // Derive key from password
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );
    
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );
    
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );
    
    // Combine salt + iv + encrypted data
    const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(encrypted), salt.length + iv.length);
    
    // Return as base64
    return btoa(String.fromCharCode(...combined));
  }
}

/**
 * Restore a seed from encrypted backup
 * @param {string} encryptedBackup - Base64 encrypted backup
 * @param {string} password - Decryption password
 * @returns {Promise<string>} Decrypted mnemonic
 */
export async function restoreFromBackup(encryptedBackup, password) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  
  // Decode base64
  const combined = Uint8Array.from(atob(encryptedBackup), c => c.charCodeAt(0));
  
  // Extract salt, iv, and encrypted data
  const salt = combined.slice(0, 16);
  const iv = combined.slice(16, 28);
  const encrypted = combined.slice(28);
  
  // Derive key from password
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encrypted
  );
  
  return decoder.decode(decrypted);
}

export default WalletClient;
