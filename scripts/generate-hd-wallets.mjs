#!/usr/bin/env node

/**
 * HD Wallet Generator for CoinPay
 * 
 * Generates HD wallets for BTC, ETH, and SOL
 * Creates encrypted backup and outputs .env format
 * 
 * Usage: 
 *   pnpm generate-wallet              # Generate all wallets
 *   pnpm generate-wallet --no-backup  # Skip encrypted backup
 */

import { generateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { HDKey } from '@scure/bip32';
import * as bitcoin from 'bitcoinjs-lib';
import { ethers } from 'ethers';
import { createHmac, createCipheriv, randomBytes, scryptSync } from 'crypto';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import * as readline from 'readline';

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

async function main() {
  const skipBackup = process.argv.includes('--no-backup');

  console.log('\n' + '='.repeat(70));
  console.log('  🔐 CoinPay HD Wallet Generator');
  console.log('='.repeat(70));
  console.log('\nGenerating HD wallets for BTC, ETH, and SOL...\n');

  // Generate mnemonics
  const btcMnemonic = generateMnemonic(wordlist, 128);
  const ethMnemonic = generateMnemonic(wordlist, 128);
  const solMnemonic = generateMnemonic(wordlist, 128);

  // Derive addresses
  const btcAddress = deriveBitcoinAddress(btcMnemonic, 0);
  const ethAddress = deriveEthereumAddress(ethMnemonic, 0);
  const solAddress = await deriveSolanaAddress(solMnemonic, 0);

  // Display results
  console.log('='.repeat(70));
  console.log('  ₿  BITCOIN (BTC)');
  console.log('='.repeat(70));
  console.log('\n  Mnemonic (12 words):');
  console.log(`  ${btcMnemonic}`);
  console.log('\n  First address:');
  console.log(`  ${btcAddress}\n`);

  console.log('='.repeat(70));
  console.log('  Ξ  ETHEREUM (ETH)');
  console.log('='.repeat(70));
  console.log('\n  Mnemonic (12 words):');
  console.log(`  ${ethMnemonic}`);
  console.log('\n  First address:');
  console.log(`  ${ethAddress}\n`);

  console.log('='.repeat(70));
  console.log('  ⬡  POLYGON (MATIC)');
  console.log('='.repeat(70));
  console.log('\n  Mnemonic (12 words):');
  console.log(`  ${ethMnemonic}`);
  console.log('  (Same as ETH - Polygon uses ETH derivation path)');
  console.log('\n  First address:');
  console.log(`  ${ethAddress}`);
  console.log('  (Same address works on both ETH and Polygon networks)\n');

  console.log('='.repeat(70));
  console.log('  ◎  SOLANA (SOL)');
  console.log('='.repeat(70));
  console.log('\n  Mnemonic (12 words):');
  console.log(`  ${solMnemonic}`);
  console.log('\n  First address:');
  console.log(`  ${solAddress}\n`);

  // Show .env format
  console.log('='.repeat(70));
  console.log('  📋 ENVIRONMENT VARIABLES');
  console.log('='.repeat(70));
  console.log('\nAdd these to your .env file:\n');
  console.log(`SYSTEM_MNEMONIC_BTC=${btcMnemonic}`);
  console.log(`SYSTEM_MNEMONIC_ETH=${ethMnemonic}`);
  console.log(`SYSTEM_MNEMONIC_MATIC=${ethMnemonic}`);
  console.log(`SYSTEM_MNEMONIC_SOL=${solMnemonic}`);
  console.log('\n  Note: ETH and MATIC use the same mnemonic (same derivation path)');
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
        version: 1,
        created: new Date().toISOString(),
        wallets: {
          btc: { mnemonic: btcMnemonic, firstAddress: btcAddress },
          eth: { mnemonic: ethMnemonic, firstAddress: ethAddress },
          sol: { mnemonic: solMnemonic, firstAddress: solAddress },
        },
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
  • ETH/MATIC: MetaMask (Linux/iOS)
  • SOL: Phantom (Linux/iOS)
`);
  console.log('='.repeat(70) + '\n');
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});