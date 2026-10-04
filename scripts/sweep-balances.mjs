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

import * as bitcoin from 'bitcoinjs-lib';
import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import { config } from 'dotenv';
import { existsSync } from 'fs';
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
 * Convert hex private key to WIF format for BCH.
 *
 * Retained (and completed) because exporting a key in WIF is what an operator
 * needs to sweep an address by hand once this tool has found it. Verified
 * against the canonical Bitcoin test vector: private key 0C28FC…AA1D encodes to
 * 5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ uncompressed, and to a
 * K/L-prefixed key compressed.
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
  
  // The file was truncated here, mid-way through a second, inline base58
  // implementation — even though `base58Encode` is defined above. That is why
  // `node --check` has failed since the script was introduced: the documented
  // emergency fund-recovery procedure has never been runnable (F5-L1-06).
  return base58Encode(wifBytes);
}

/**
 * Ask a chain how much is sitting at an address.
 *
 * Deliberately mirrors `src/lib/payments/monitor-balance.ts`, including its
 * environment-variable overrides, so this reports the same numbers production
 * does. Returns `null` — never 0 — when the balance could not be read, because
 * "the node did not answer" and "the address is empty" must not look alike to
 * an operator hunting for stranded funds.
 */
const RPC = {
  BTC: process.env.BITCOIN_RPC_URL || 'https://blockstream.info/api',
  BCH: process.env.BCH_RPC_URL || 'https://api.blockchair.com/bitcoin-cash',
  ETH: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
  POL: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
  SOL: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
};

async function readBalance(crypto, address) {
  try {
    if (crypto === 'BTC') {
      const { data } = await axios.get(`${RPC.BTC}/address/${address}`, { timeout: 15000 });
      const sats =
        (data.chain_stats?.funded_txo_sum ?? 0) - (data.chain_stats?.spent_txo_sum ?? 0);
      return sats / 1e8;
    }

    if (crypto === 'BCH') {
      const { data } = await axios.get(
        `${RPC.BCH}/dashboards/address/${address}`,
        { timeout: 15000 }
      );
      const sats = data?.data?.[address]?.address?.balance;
      return typeof sats === 'number' ? sats / 1e8 : null;
    }

    if (crypto === 'ETH' || crypto === 'POL') {
      const { data } = await axios.post(
        RPC[crypto],
        { jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] },
        { timeout: 15000 }
      );
      if (!data?.result) return null;
      return Number(ethers.formatEther(BigInt(data.result)));
    }

    if (crypto === 'SOL') {
      const { data } = await axios.post(
        RPC.SOL,
        { jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] },
        { timeout: 15000 }
      );
      const lamports = data?.result?.value;
      return typeof lamports === 'number' ? lamports / 1e9 : null;
    }

    return null;
  } catch (err) {
    console.error(`    ! ${crypto} ${address}: ${err.message}`);
    return null;
  }
}

function parseArgs(argv) {
  const args = { execute: false, crypto: null, limit: 500 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--execute') args.execute = true;
    else if (argv[i] === '--crypto') args.crypto = (argv[++i] || '').toUpperCase();
    else if (argv[i] === '--limit') args.limit = Math.max(1, Number(argv[++i]) || 500);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.crypto && !SUPPORTED_CRYPTOS.includes(args.crypto)) {
    console.error(`Unsupported --crypto ${args.crypto}. Supported: ${SUPPORTED_CRYPTOS.join(', ')}`);
    process.exit(1);
  }

  if (args.execute) {
    // Refusing rather than pretending.
    //
    // Restoring this script (F5-L1-06) restores the half that can be verified:
    // finding the money. Broadcasting sweeps is new, untested, multi-chain
    // fund-moving code, and shipping that unexercised is how funds get sent
    // somewhere unrecoverable — a worse outcome than the stranded dust it is
    // meant to recover. Discovery output below feeds the existing, exercised
    // forwarding path.
    console.error('--execute is not implemented.');
    console.error('');
    console.error('This tool reports stranded balances; it does not move them.');
    console.error('To move funds, use the reviewed forwarding path');
    console.error('(src/lib/wallets/secure-forwarding.ts) against the specific payment,');
    console.error('or sweep manually with the derived key for the address.');
    process.exit(2);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  let query = supabase
    .from('payment_addresses')
    .select('id, address, cryptocurrency, payment_id, forwarded_at, created_at')
    .order('created_at', { ascending: false })
    .limit(args.limit);
  if (args.crypto) query = query.eq('cryptocurrency', args.crypto);

  const { data: addresses, error } = await query;
  if (error) {
    console.error(`Could not read payment_addresses: ${error.message}`);
    process.exit(1);
  }
  if (!addresses?.length) {
    console.log('No payment addresses to scan.');
    return;
  }

  console.log(`Scanning ${addresses.length} payment address(es)${args.crypto ? ` (${args.crypto})` : ''}…`);
  console.log('');

  const stranded = [];
  let unreadable = 0;

  for (const row of addresses) {
    const crypto = (row.cryptocurrency || '').toUpperCase();
    if (!SUPPORTED_CRYPTOS.includes(crypto)) continue;

    const balance = await readBalance(crypto, row.address);
    if (balance === null) {
      unreadable++;
      continue;
    }

    const threshold = MIN_BALANCE_THRESHOLDS[crypto] ?? 0;
    if (balance > threshold) {
      stranded.push({ ...row, crypto, balance });
      console.log(`  ${crypto.padEnd(4)} ${row.address}  ${balance}  (payment ${row.payment_id}${row.forwarded_at ? ', already forwarded' : ''})`);
    }
  }

  console.log('');
  console.log(`Above dust: ${stranded.length}`);
  // An address we could not read is not an address we know is empty. Saying so
  // is the difference between "nothing stranded" and "nothing found *yet*".
  if (unreadable > 0) {
    console.log(`Could not read: ${unreadable} — these were NOT checked and may hold funds.`);
  }

  const byCrypto = {};
  for (const s of stranded) byCrypto[s.crypto] = (byCrypto[s.crypto] || 0) + s.balance;
  for (const [crypto, total] of Object.entries(byCrypto)) {
    console.log(`  ${crypto}: ${total}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
