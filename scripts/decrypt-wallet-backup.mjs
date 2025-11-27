#!/usr/bin/env node

/**
 * Decrypt CoinPay Wallet Backup
 * 
 * Usage: node scripts/decrypt-wallet-backup.mjs <backup-file>
 * 
 * Example: node scripts/decrypt-wallet-backup.mjs backups/coinpay-wallets-2024-01-01.json.enc
 */

import { createDecipheriv, scryptSync } from 'crypto';
import { readFileSync } from 'fs';
import * as readline from 'readline';

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

function decryptData(encryptedObj, password) {
  const salt = Buffer.from(encryptedObj.salt, 'hex');
  const iv = Buffer.from(encryptedObj.iv, 'hex');
  const authTag = Buffer.from(encryptedObj.authTag, 'hex');
  const key = scryptSync(password, salt, 32);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedObj.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return JSON.parse(decrypted);
}

async function main() {
  const backupFile = process.argv[2];

  if (!backupFile) {
    console.log('\nUsage: node scripts/decrypt-wallet-backup.mjs <backup-file>\n');
    console.log('Example:');
    console.log('  node scripts/decrypt-wallet-backup.mjs backups/coinpay-wallets-2024-01-01.json.enc\n');
    process.exit(1);
  }

  console.log('\n' + '='.repeat(70));
  console.log('  🔓 CoinPay Wallet Backup Decryptor');
  console.log('='.repeat(70));

  try {
    const encryptedData = JSON.parse(readFileSync(backupFile, 'utf8'));
    const password = await prompt('\nEnter decryption password: ');

    console.log('\nDecrypting...\n');

    const data = decryptData(encryptedData, password);

    console.log('='.repeat(70));
    console.log('  ✅ DECRYPTED SUCCESSFULLY');
    console.log('='.repeat(70));
    console.log(`\nBackup created: ${data.created}\n`);

    // Display wallets
    console.log('='.repeat(70));
    console.log('  ₿  BITCOIN (BTC)');
    console.log('='.repeat(70));
    console.log(`\n  Mnemonic: ${data.wallets.btc.mnemonic}`);
    console.log(`  First address: ${data.wallets.btc.firstAddress}\n`);

    console.log('='.repeat(70));
    console.log('  Ξ  ETHEREUM (ETH) / POLYGON (MATIC)');
    console.log('='.repeat(70));
    console.log(`\n  Mnemonic: ${data.wallets.eth.mnemonic}`);
    console.log(`  First address: ${data.wallets.eth.firstAddress}\n`);

    console.log('='.repeat(70));
    console.log('  ◎  SOLANA (SOL)');
    console.log('='.repeat(70));
    console.log(`\n  Mnemonic: ${data.wallets.sol.mnemonic}`);
    console.log(`  First address: ${data.wallets.sol.firstAddress}\n`);

    // Show .env format
    console.log('='.repeat(70));
    console.log('  📋 ENVIRONMENT VARIABLES');
    console.log('='.repeat(70));
    console.log('\nAdd these to your .env file:\n');
    console.log(`SYSTEM_MNEMONIC_BTC=${data.wallets.btc.mnemonic}`);
    console.log(`SYSTEM_MNEMONIC_ETH=${data.wallets.eth.mnemonic}`);
    console.log(`SYSTEM_MNEMONIC_SOL=${data.wallets.sol.mnemonic}`);
    console.log('\n' + '='.repeat(70) + '\n');

  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`\n❌ File not found: ${backupFile}\n`);
    } else if (error.message.includes('Unsupported state') || error.message.includes('auth')) {
      console.error('\n❌ Wrong password or corrupted file.\n');
    } else {
      console.error(`\n❌ Error: ${error.message}\n`);
    }
    process.exit(1);
  }
}

main();