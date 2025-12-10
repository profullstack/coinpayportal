#!/usr/bin/env node

/**
 * Sweep Balances Script for CoinPay
 *
 * This script scans all payment addresses from the database and sweeps any
 * remaining balances to the platform fee wallets.
 *
 * Use cases:
 * - Recover funds from failed forwarding transactions
 * - Clean up dust amounts left in payment addresses
 * - Emergency fund recovery
 *
 * Usage:
 *   pnpm sweep-balances              # Dry run - show what would be swept
 *   pnpm sweep-balances --execute    # Actually execute the sweeps
 *   pnpm sweep-balances --crypto BCH # Only sweep BCH addresses
 */

import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { HDKey } from '@scure/bip32';
import * as bitcoin from 'bitcoinjs-lib';
import { ethers } from 'ethers';
import { createHmac } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import { config } from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Load environment variables
const envPath = join(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  config({ path: envPath });
} else {
  config();
}

// Also load .env.prod for mnemonics if available
const envProdPath = join(process.cwd(), '.env.prod');
if (existsSync(envProdPath)) {
  config({ path: envProdPath, override: false });
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Supported cryptocurrencies for sweeping
 */
const SUPPORTED_CRYPTOS = ['BTC', 'BCH', 'ETH', 'POL', 'SOL'];

/**
 * Minimum balance thresholds (in native units) - below this is considered dust
 */
const MIN_BALANCE_THRESHOLDS = {
  BTC: 0.00001,    // ~$1 at $100k/BTC
  BCH: 0.0001,     // ~$0.05 at $500/BCH
  ETH: 0.0001,     // ~$0.40 at $4k/ETH
  POL: 0.01,       // ~$0.01 at $1/POL
  SOL: 0.001,      // ~$0.20 at $200/SOL
};

/**
 * Base58 encode bytes
 */
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

/**
 * Convert hex private key to WIF format for BCH
 */
function hexToWIF(hexPrivateKey, compressed = true) {
  if (!/^[0-9a-fA-F]{64}$/.test(hexPrivateKey)) {
    throw new Error(`Invalid hex private key: expected 64 hex characters, got ${hexPrivateKey.length}`);
  }

  const versionByte = 0x80;
  const privateKeyBytes = Buffer.from(hexPrivateKey, 'hex');
  let payload;
  
  if (compressed) {
    payload = Buffer.concat([
      Buffer.from([versionByte]),
      privateKeyBytes,
      Buffer.from([0x01])
    ]);
  } else {
    payload = Buffer.concat([
      Buffer.from([versionByte]),
      privateKeyBytes
    ]);
  }
  
  const checksum = bitcoin.crypto.hash256(payload).subarray(0, 4);
  const wifBytes = Buffer.concat([payload, checksum]);
  
  const digits = [0];
  for (let i = 0; i < wifBytes.length; i++) {
