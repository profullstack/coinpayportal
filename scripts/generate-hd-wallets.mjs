#!/usr/bin/env node

/**
 * HD Wallet Generator for CoinPay
 *
 * Generates HD wallets for all supported cryptocurrencies:
 * - BTC (Bitcoin) - coin type 0
 * - BCH (Bitcoin Cash) - coin type 145
 * - ETH (Ethereum) - coin type 60
 * - POL (Polygon) - uses ETH derivation (coin type 60)
 * - BNB (Binance Smart Chain) - uses ETH derivation (coin type 60)
 * - SOL (Solana) - coin type 501
 * - DOGE (Dogecoin) - coin type 3
 * - XRP (Ripple) - coin type 144
 * - ADA (Cardano) - coin type 1815 (simplified)
 *
 * Tokens (use parent chain addresses):
 * - USDT - ERC-20 token on ETH/POL
 * - USDC - ERC-20 token on ETH/POL/SOL
 *
 * Creates encrypted backup and outputs .env format
 *
 * Usage:
 *   pnpm generate-wallet              # Generate all wallets
 *   pnpm generate-wallet --no-backup  # Skip encrypted backup
 */

import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { HDKey } from '@scure/bip32';
import * as bitcoin from 'bitcoinjs-lib';
import { ethers } from 'ethers';
import { createHmac, createCipheriv, randomBytes, scryptSync } from 'crypto';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as readline from 'readline';
import { config } from 'dotenv';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(bytes) {
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

function deriveEd25519Key(seed, path) {
  const hmac = createHmac('sha512', 'ed25519 seed');
  hmac.update(seed);
  const I = hmac.digest();
  let key = I.subarray(0, 32);
  let chainCode = I.subarray(32);

  const segments = path.split('/').slice(1);

  for (const segment of segments) {
    const hardened = segment.endsWith("'");
    const indexStr = hardened ? segment.slice(0, -1) : segment;
    const index = parseInt(indexStr, 10);

    if (hardened) {
      const data = Buffer.alloc(37);
      data[0] = 0;
      key.copy(data, 1);
      data.writeUInt32BE(index + 0x80000000, 33);

      const hmacChild = createHmac('sha512', chainCode);
      hmacChild.update(data);
      const childI = hmacChild.digest();
      key = childI.subarray(0, 32);
      chainCode = childI.subarray(32);
    }
  }

  return { key, chainCode };
}

async function getEd25519PublicKey(privateKey) {
  const { createPrivateKey, createPublicKey } = await import('crypto');

  const privateKeyObj = createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      privateKey,
    ]),
    format: 'der',
    type: 'pkcs8',
  });

  const publicKeyObj = createPublicKey(privateKeyObj);
  const publicKeyDer = publicKeyObj.export({ format: 'der', type: 'spki' });

  return Buffer.from(publicKeyDer.subarray(-32));
}

function deriveBitcoinAddress(mnemonic, index = 0) {
  const seed = mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  const path = `m/44'/0'/0'/0/${index}`;
  const child = hdKey.derive(path);

  const { address } = bitcoin.payments.p2pkh({
    pubkey: Buffer.from(child.publicKey),
    network: bitcoin.networks.bitcoin,
  });

  return address;
}

/**
 * Derive Bitcoin Cash address from mnemonic
 * BCH uses coin type 145 (BIP44)
 * Returns CashAddr format (bitcoincash:q...)
 */
function deriveBitcoinCashAddress(mnemonic, index = 0) {
  const seed = mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  // BCH uses coin type 145 per BIP44
  const path = `m/44'/145'/0'/0/${index}`;
  const child = hdKey.derive(path);

  // BCH uses the same P2PKH format as BTC but with different address prefix
  // We'll generate the legacy address first, then convert to CashAddr
  const { hash } = bitcoin.payments.p2pkh({
    pubkey: Buffer.from(child.publicKey),
    network: bitcoin.networks.bitcoin,
  });

  // Convert to CashAddr format
  const cashAddress = hashToCashAddress(hash);
  return cashAddress;
}

/**
 * Convert a P2PKH hash160 to CashAddr format
 * CashAddr uses a custom base32 encoding with prefix "bitcoincash:"
 */
function hashToCashAddress(hash160) {
  // CashAddr charset (different from standard base32)
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  
  // Version byte: 0x00 for P2PKH
  const versionByte = 0x00;
  
  // Create payload: version byte + hash160
  const payload = Buffer.concat([Buffer.from([versionByte]), hash160]);
  
  // Convert to 5-bit groups for base32 encoding
  const data = convertBits(payload, 8, 5, true);
  
  // Calculate checksum
  const prefix = 'bitcoincash';
  const prefixData = [];
  for (let i = 0; i < prefix.length; i++) {
    prefixData.push(prefix.charCodeAt(i) & 0x1f);
  }
  prefixData.push(0); // separator
  
  const checksumInput = [...prefixData, ...data, 0, 0, 0, 0, 0, 0, 0, 0];
  const checksum = polymod(checksumInput) ^ 1;
  
  // Extract 8 5-bit checksum values
  const checksumData = [];
  for (let i = 0; i < 8; i++) {
    checksumData.push((checksum >> (5 * (7 - i))) & 0x1f);
  }
  
  // Encode to CashAddr
  let result = prefix + ':';
  for (const d of [...data, ...checksumData]) {
    result += CHARSET[d];
  }
  
  return result;
}

/**
 * Convert between bit sizes (used for CashAddr encoding)
 */
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
function polymod(values) {
  const GENERATORS = [
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
  return Number(chk);
}

function deriveEthereumAddress(mnemonic, index = 0) {
  const seed = mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  const path = `m/44'/60'/0'/0/${index}`;
  const child = hdKey.derive(path);

  const privateKeyHex = '0x' + Buffer.from(child.privateKey).toString('hex');
  const wallet = new ethers.Wallet(privateKeyHex);

  return wallet.address;
}

async function deriveSolanaAddress(mnemonic, index = 0) {
  const seedUint8 = mnemonicToSeedSync(mnemonic);
  const seed = Buffer.from(seedUint8);
  const path = `m/44'/501'/${index}'/0'`;
  const { key } = deriveEd25519Key(seed, path);

  const publicKey = await getEd25519PublicKey(key);

  return base58Encode(publicKey);
}

/**
 * Derive Dogecoin address from mnemonic
 * DOGE uses coin type 3 (BIP44)
 */
function deriveDogecoinAddress(mnemonic, index = 0) {
  const seed = mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  // DOGE uses coin type 3 per BIP44
  const path = `m/44'/3'/0'/0/${index}`;
  const child = hdKey.derive(path);

  // DOGE uses P2PKH with version byte 0x1e (30)
  const pubkeyHash = bitcoin.crypto.hash160(Buffer.from(child.publicKey));
  const versionByte = Buffer.from([0x1e]); // DOGE mainnet P2PKH
  const payload = Buffer.concat([versionByte, pubkeyHash]);
  
  // Double SHA256 for checksum
  const checksum = bitcoin.crypto.hash256(payload).subarray(0, 4);
  const addressBytes = Buffer.concat([payload, checksum]);
  
  return base58Encode(addressBytes);
}

/**
 * Derive XRP address from mnemonic
 * XRP uses coin type 144 (BIP44)
 */
function deriveXRPAddress(mnemonic, index = 0) {
  const seed = mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  // XRP uses coin type 144 per BIP44
  const path = `m/44'/144'/0'/0/${index}`;
  const child = hdKey.derive(path);

  // XRP uses RIPEMD160(SHA256(pubkey)) with version byte 0x00
  const pubkeyHash = bitcoin.crypto.hash160(Buffer.from(child.publicKey));
  const versionByte = Buffer.from([0x00]); // XRP mainnet
  const payload = Buffer.concat([versionByte, pubkeyHash]);
  
  // XRP uses a different checksum: first 4 bytes of SHA256(SHA256(payload))
  const checksum = bitcoin.crypto.hash256(payload).subarray(0, 4);
  const addressBytes = Buffer.concat([payload, checksum]);
  
  // XRP uses base58 with a different alphabet
  const XRP_ALPHABET = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';
  return base58EncodeWithAlphabet(addressBytes, XRP_ALPHABET);
}

/**
 * Base58 encode with custom alphabet (for XRP)
 */
function base58EncodeWithAlphabet(bytes, alphabet) {
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
 * Derive Cardano address from mnemonic (simplified)
 * ADA uses coin type 1815 (BIP44)
 * Note: Full Cardano address derivation is complex (uses Ed25519-BIP32)
 * This generates a simplified enterprise address for receiving
 */
async function deriveCardanoAddress(mnemonic, index = 0) {
  const seedUint8 = mnemonicToSeedSync(mnemonic);
  const seed = Buffer.from(seedUint8);
  // Cardano uses coin type 1815
  const path = `m/44'/1815'/${index}'/0'`;
  const { key } = deriveEd25519Key(seed, path);

  const publicKey = await getEd25519PublicKey(key);
  
  // Simplified: return hex-encoded public key as placeholder
  // Full Cardano addresses require bech32 encoding with specific prefixes
  // For production, use a proper Cardano library
  return `addr1_${publicKey.toString('hex').substring(0, 40)}...`;
}

function encryptData(data, password) {
  const salt = randomBytes(32);
  const key = scryptSync(password, salt, 32);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return {
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    encrypted,
  };
}

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Load existing mnemonics from .env.prod file
 * Returns an object with existing mnemonics keyed by cryptocurrency
 */
function loadExistingMnemonics() {
  const envProdPath = join(process.cwd(), '.env.prod');
  const existing = {};
  
  if (existsSync(envProdPath)) {
    console.log('📂 Found .env.prod file, loading existing mnemonics...\n');
    
    // Parse .env.prod file
    const envContent = readFileSync(envProdPath, 'utf8');
    const lines = envContent.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('SYSTEM_MNEMONIC_')) {
        const match = trimmed.match(/^SYSTEM_MNEMONIC_(\w+)=(.+)$/);
        if (match) {
          const [, crypto, mnemonic] = match;
          const cleanMnemonic = mnemonic.replace(/["']/g, '').trim();
          
          // Validate the mnemonic
          if (validateMnemonic(cleanMnemonic, wordlist)) {
            existing[crypto] = cleanMnemonic;
            console.log(`  ✓ Loaded existing ${crypto} mnemonic`);
          } else {
            console.log(`  ⚠ Invalid ${crypto} mnemonic in .env.prod, will generate new one`);
          }
        }
      }
    }
    console.log();
  } else {
    console.log('📂 No .env.prod file found, will generate all new mnemonics\n');
  }
  
  return existing;
}

/**
 * Get mnemonic for a cryptocurrency - use existing if available, otherwise generate new
 */
function getMnemonic(existing, crypto, fallbackCrypto = null) {
  // Check if we have an existing mnemonic for this crypto
  if (existing[crypto]) {
    return { mnemonic: existing[crypto], isExisting: true };
  }
  
  // Check fallback (e.g., POL uses ETH mnemonic)
  if (fallbackCrypto && existing[fallbackCrypto]) {
    return { mnemonic: existing[fallbackCrypto], isExisting: true };
  }
  
  // Generate new mnemonic
  return { mnemonic: generateMnemonic(wordlist, 128), isExisting: false };
}

async function main() {
  const skipBackup = process.argv.includes('--no-backup');
  const forceNew = process.argv.includes('--force-new');

  console.log('\n' + '='.repeat(70));
  console.log('  🔐 CoinPay HD Wallet Generator');
  console.log('='.repeat(70));
  console.log('\nGenerating HD wallets for all supported cryptocurrencies...\n');
  console.log('Supported: BTC, BCH, ETH, POL, BNB, SOL, DOGE, XRP, ADA');
  console.log('Tokens (use parent chain): USDT, USDC\n');
  
  if (forceNew) {
    console.log('⚠️  --force-new flag detected, generating all new mnemonics\n');
  }

  // Load existing mnemonics from .env.prod
  const existing = forceNew ? {} : loadExistingMnemonics();
  
  // Determine which cryptos need new mnemonics
  const cryptosToGenerate = ['BTC', 'BCH', 'ETH', 'SOL', 'DOGE', 'XRP', 'ADA'].filter(
    crypto => !existing[crypto]
  );
  
  if (cryptosToGenerate.length > 0) {
    console.log(`\n🔑 Generating new mnemonics for: ${cryptosToGenerate.join(', ')}\n`);
  } else {
    console.log('\n✅ All mnemonics found in .env.prod, no new generation needed\n');
  }
  
  // Get or generate mnemonics for each unique derivation path
  const btcResult = getMnemonic(existing, 'BTC');
  const bchResult = getMnemonic(existing, 'BCH');
  const ethResult = getMnemonic(existing, 'ETH');
  const solResult = getMnemonic(existing, 'SOL');
  const dogeResult = getMnemonic(existing, 'DOGE');
  const xrpResult = getMnemonic(existing, 'XRP');
  const adaResult = getMnemonic(existing, 'ADA');
  
  const btcMnemonic = btcResult.mnemonic;
  const bchMnemonic = bchResult.mnemonic;
  const ethMnemonic = ethResult.mnemonic; // Also used for POL, BNB, USDT, USDC
  const solMnemonic = solResult.mnemonic; // Also used for USDC on Solana
  const dogeMnemonic = dogeResult.mnemonic;
  const xrpMnemonic = xrpResult.mnemonic;
  const adaMnemonic = adaResult.mnemonic;
  
  // Track which mnemonics are new vs existing
  const mnemonicStatus = {
    BTC: btcResult.isExisting ? '(existing from .env.prod)' : '(NEW - generated)',
    BCH: bchResult.isExisting ? '(existing from .env.prod)' : '(NEW - generated)',
    ETH: ethResult.isExisting ? '(existing from .env.prod)' : '(NEW - generated)',
    SOL: solResult.isExisting ? '(existing from .env.prod)' : '(NEW - generated)',
    DOGE: dogeResult.isExisting ? '(existing from .env.prod)' : '(NEW - generated)',
    XRP: xrpResult.isExisting ? '(existing from .env.prod)' : '(NEW - generated)',
    ADA: adaResult.isExisting ? '(existing from .env.prod)' : '(NEW - generated)',
  };

  // Derive addresses
  const btcAddress = deriveBitcoinAddress(btcMnemonic, 0);
  const bchAddress = deriveBitcoinCashAddress(bchMnemonic, 0);
  const ethAddress = deriveEthereumAddress(ethMnemonic, 0);
  const solAddress = await deriveSolanaAddress(solMnemonic, 0);
  const dogeAddress = deriveDogecoinAddress(dogeMnemonic, 0);
  const xrpAddress = deriveXRPAddress(xrpMnemonic, 0);
  const adaAddress = await deriveCardanoAddress(adaMnemonic, 0);

  // Display results
  console.log('='.repeat(70));
  console.log(`  ₿  BITCOIN (BTC) ${mnemonicStatus.BTC}`);
  console.log('='.repeat(70));
  console.log('\n  Mnemonic (12 words):');
  console.log(`  ${btcMnemonic}`);
  console.log('\n  First address:');
  console.log(`  ${btcAddress}\n`);

  console.log('='.repeat(70));
  console.log(`  ₿  BITCOIN CASH (BCH) ${mnemonicStatus.BCH}`);
  console.log('='.repeat(70));
  console.log('\n  Mnemonic (12 words):');
  console.log(`  ${bchMnemonic}`);
  console.log('\n  First address (CashAddr format):');
  console.log(`  ${bchAddress}\n`);

  console.log('='.repeat(70));
  console.log(`  Ξ  ETHEREUM (ETH) ${mnemonicStatus.ETH}`);
  console.log('='.repeat(70));
  console.log('\n  Mnemonic (12 words):');
  console.log(`  ${ethMnemonic}`);
  console.log('\n  First address:');
  console.log(`  ${ethAddress}\n`);

  console.log('='.repeat(70));
  console.log(`  ⬡  POLYGON (POL) ${mnemonicStatus.ETH}`);
  console.log('='.repeat(70));
  console.log('\n  Mnemonic (12 words):');
  console.log(`  ${ethMnemonic}`);
  console.log('  (Same as ETH - Polygon uses ETH derivation path)');
  console.log('\n  First address:');
  console.log(`  ${ethAddress}`);
  console.log('  (Same address works on both ETH and Polygon networks)\n');

  console.log('='.repeat(70));
  console.log(`  ◎  SOLANA (SOL) ${mnemonicStatus.SOL}`);
  console.log('='.repeat(70));
  console.log('\n  Mnemonic (12 words):');
  console.log(`  ${solMnemonic}`);
  console.log('\n  First address:');
  console.log(`  ${solAddress}\n`);

  console.log('='.repeat(70));
  console.log(`  Ð  DOGECOIN (DOGE) ${mnemonicStatus.DOGE}`);
  console.log('='.repeat(70));
  console.log('\n  Mnemonic (12 words):');
  console.log(`  ${dogeMnemonic}`);
  console.log('\n  First address:');
  console.log(`  ${dogeAddress}\n`);

  console.log('='.repeat(70));
  console.log(`  ✕  RIPPLE (XRP) ${mnemonicStatus.XRP}`);
  console.log('='.repeat(70));
  console.log('\n  Mnemonic (12 words):');
  console.log(`  ${xrpMnemonic}`);
  console.log('\n  First address:');
  console.log(`  ${xrpAddress}\n`);

  console.log('='.repeat(70));
  console.log(`  ₳  CARDANO (ADA) ${mnemonicStatus.ADA}`);
  console.log('='.repeat(70));
  console.log('\n  Mnemonic (12 words):');
  console.log(`  ${adaMnemonic}`);
  console.log('\n  First address (simplified):');
  console.log(`  ${adaAddress}`);
  console.log('  Note: For production, use a proper Cardano wallet for full address support\n');

  console.log('='.repeat(70));
  console.log('  💵 TOKENS (USDT, USDC, BNB)');
  console.log('='.repeat(70));
  console.log('\n  These tokens use parent chain addresses:');
  console.log('  • USDT (ERC-20): Use ETH address');
  console.log('  • USDC (ERC-20): Use ETH address');
  console.log('  • USDC (SPL): Use SOL address');
  console.log('  • BNB (BSC): Use ETH address (same derivation path)\n');

  // Show .env format
  console.log('='.repeat(70));
  console.log('  📋 ENVIRONMENT VARIABLES');
  console.log('='.repeat(70));
  console.log('\nAdd these to your .env file:\n');
  console.log(`SYSTEM_MNEMONIC_BTC=${btcMnemonic}`);
  console.log(`SYSTEM_MNEMONIC_BCH=${bchMnemonic}`);
  console.log(`SYSTEM_MNEMONIC_ETH=${ethMnemonic}`);
  console.log(`SYSTEM_MNEMONIC_POL=${ethMnemonic}`);
  console.log(`SYSTEM_MNEMONIC_BNB=${ethMnemonic}`);
  console.log(`SYSTEM_MNEMONIC_SOL=${solMnemonic}`);
  console.log(`SYSTEM_MNEMONIC_DOGE=${dogeMnemonic}`);
  console.log(`SYSTEM_MNEMONIC_XRP=${xrpMnemonic}`);
  console.log(`SYSTEM_MNEMONIC_ADA=${adaMnemonic}`);
  console.log(`SYSTEM_MNEMONIC_USDT=${ethMnemonic}`);
  console.log(`SYSTEM_MNEMONIC_USDC=${ethMnemonic}`);
  console.log('\n  Notes:');
  console.log('  • ETH, POL, BNB, USDT, USDC use the same mnemonic (EVM compatible)');
  console.log('  • USDC on Solana uses the SOL mnemonic');
  console.log();

  // Create encrypted backup
  if (!skipBackup) {
    console.log('='.repeat(70));
    console.log('  🔒 ENCRYPTED BACKUP');
    console.log('='.repeat(70));

    const password = await prompt('\nEnter password for encrypted backup (min 8 chars): ');

    if (password.length >= 8) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = join(process.cwd(), 'backups');

      if (!existsSync(backupDir)) {
        mkdirSync(backupDir, { recursive: true });
      }

      const backupData = {
        version: 3,
        created: new Date().toISOString(),
        source: existsSync(join(process.cwd(), '.env.prod')) ? '.env.prod' : 'generated',
        wallets: {
          btc: { mnemonic: btcMnemonic, firstAddress: btcAddress, isExisting: btcResult.isExisting },
          bch: { mnemonic: bchMnemonic, firstAddress: bchAddress, isExisting: bchResult.isExisting },
          eth: { mnemonic: ethMnemonic, firstAddress: ethAddress, isExisting: ethResult.isExisting },
          pol: { mnemonic: ethMnemonic, firstAddress: ethAddress, note: 'Same as ETH', isExisting: ethResult.isExisting },
          bnb: { mnemonic: ethMnemonic, firstAddress: ethAddress, note: 'Same as ETH', isExisting: ethResult.isExisting },
          sol: { mnemonic: solMnemonic, firstAddress: solAddress, isExisting: solResult.isExisting },
          doge: { mnemonic: dogeMnemonic, firstAddress: dogeAddress, isExisting: dogeResult.isExisting },
          xrp: { mnemonic: xrpMnemonic, firstAddress: xrpAddress, isExisting: xrpResult.isExisting },
          ada: { mnemonic: adaMnemonic, firstAddress: adaAddress, isExisting: adaResult.isExisting },
          usdt: { mnemonic: ethMnemonic, firstAddress: ethAddress, note: 'ERC-20 on ETH', isExisting: ethResult.isExisting },
          usdc: { mnemonic: ethMnemonic, firstAddress: ethAddress, note: 'ERC-20 on ETH', isExisting: ethResult.isExisting },
        },
        // Include platform fee wallets if they exist in .env.prod
        platformFeeWallets: loadPlatformFeeWallets(),
      };

      const encrypted = encryptData(backupData, password);
      const backupPath = join(backupDir, `coinpay-wallets-${timestamp}.json.enc`);
      writeFileSync(backupPath, JSON.stringify(encrypted, null, 2));

      console.log(`\n✅ Encrypted backup saved to:`);
      console.log(`   ${backupPath}`);
      console.log('\n   Store this file securely (USB, cloud, etc.)');
      console.log('   You will need the password to decrypt it.\n');
    } else {
      console.log('\n⚠️  Password too short, skipping backup.\n');
    }
  }

  // Security warnings
  console.log('='.repeat(70));
  console.log('  ⚠️  SECURITY WARNINGS');
  console.log('='.repeat(70));
  console.log(`
  • WRITE DOWN the mnemonics and store them OFFLINE
  • NEVER share mnemonics with anyone
  • Anyone with the mnemonic can access ALL funds
  • Consider a hardware wallet (Ledger/Trezor) for large amounts

  To import into wallet apps:
  • BTC: Electrum (Linux) or BlueWallet (iOS)
  • BCH: Electron Cash (Linux) or Bitcoin.com Wallet (iOS)
  • ETH/POL/BNB: MetaMask (Linux/iOS)
  • SOL: Phantom (Linux/iOS)
  • DOGE: Dogecoin Core or Trust Wallet
  • XRP: XUMM Wallet
  • ADA: Daedalus or Yoroi Wallet
  • USDT/USDC: MetaMask (ERC-20) or Phantom (SPL)

  Usage:
  • pnpm generate-wallet              # Use existing from .env.prod or generate new
  • pnpm generate-wallet --force-new  # Generate all new mnemonics
  • pnpm generate-wallet --no-backup  # Skip encrypted backup
`);
  console.log('='.repeat(70) + '\n');
}

/**
 * Load platform fee wallet addresses from .env.prod
 */
function loadPlatformFeeWallets() {
  const envProdPath = join(process.cwd(), '.env.prod');
  const wallets = {};
  
  if (existsSync(envProdPath)) {
    const envContent = readFileSync(envProdPath, 'utf8');
    const lines = envContent.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('PLATFORM_FEE_WALLET_')) {
        const match = trimmed.match(/^PLATFORM_FEE_WALLET_(\w+)=(.+)$/);
        if (match) {
          const [, crypto, address] = match;
          wallets[crypto] = address.replace(/["']/g, '').trim();
        }
      }
    }
  }
  
  return wallets;
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});