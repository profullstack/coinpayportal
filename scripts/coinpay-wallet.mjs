#!/usr/bin/env node

/**
 * CoinPayPortal Wallet CLI
 *
 * A command-line interface for managing web wallets via the SDK.
 *
 * Usage:
 *   pnpm coinpay-wallet create [--words 12|24] [--chains ETH,BTC,SOL]
 *   pnpm coinpay-wallet import <mnemonic> [--chains ETH,BTC,SOL]
 *   pnpm coinpay-wallet balance <wallet-id>
 *   pnpm coinpay-wallet send <wallet-id> --from <addr> --to <addr> --chain <chain> --amount <amount>
 *   pnpm coinpay-wallet address <wallet-id> [--chain <chain>]
 *   pnpm coinpay-wallet history <wallet-id> [--chain <chain>] [--limit <n>]
 *
 * Configuration:
 *   COINPAY_API_URL   - API base URL (default: http://localhost:8080)
 *   COINPAY_AUTH_TOKEN - JWT auth token (for read-only operations)
 *
 *   Or use a config file at ~/.coinpayrc.json:
 *   { "apiUrl": "https://coinpayportal.com", "authToken": "..." }
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ── Config Loading ──

function loadConfig() {
  const config = {
    apiUrl: process.env.COINPAY_API_URL || 'http://localhost:8080',
    authToken: process.env.COINPAY_AUTH_TOKEN || null,
  };

  // Try loading from config file
  const configPath = join(homedir(), '.coinpayrc.json');
  if (existsSync(configPath)) {
    try {
      const fileConfig = JSON.parse(readFileSync(configPath, 'utf8'));
      if (fileConfig.apiUrl) config.apiUrl = fileConfig.apiUrl;
      if (fileConfig.authToken) config.authToken = fileConfig.authToken;
    } catch {
      // Ignore malformed config files
    }
  }

  return config;
}

// ── Argument Parsing ──

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0];
  const positional = [];
  const flags = {};

  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true';
      flags[key] = value;
      if (value !== 'true') i++;
    } else {
      positional.push(args[i]);
    }
  }

  return { command, positional, flags };
}

// ── Output Helpers ──

function printTable(rows) {
  if (rows.length === 0) {
    console.log('  (none)');
    return;
  }

  const keys = Object.keys(rows[0]);
  const widths = keys.map((k) =>
    Math.max(k.length, ...rows.map((r) => String(r[k] ?? '').length))
  );

  const header = keys.map((k, i) => k.padEnd(widths[i])).join('  ');
  const separator = widths.map((w) => '-'.repeat(w)).join('  ');
  console.log(`  ${header}`);
  console.log(`  ${separator}`);

  for (const row of rows) {
    const line = keys.map((k, i) => String(row[k] ?? '').padEnd(widths[i])).join('  ');
    console.log(`  ${line}`);
  }
}

function error(msg) {
  console.error(`\nError: ${msg}\n`);
  process.exit(1);
}

// ── Auth Helper ──

/**
 * Get an authenticated wallet instance.
 * Uses COINPAY_MNEMONIC (signature auth) or COINPAY_AUTH_TOKEN (JWT).
 */
async function getAuthenticatedWallet(walletId, config) {
  const { Wallet } = await import('../src/lib/wallet-sdk/index.ts');

  const mnemonic = process.env.COINPAY_MNEMONIC;
  if (mnemonic) {
    // fromSeed re-derives keys and uses signature auth — no JWT needed
    // Must pass chains to derive private keys for signing transactions
    const wallet = await Wallet.fromSeed(mnemonic, {
      baseUrl: config.apiUrl,
      chains: ['BTC', 'BCH', 'ETH', 'POL', 'SOL'],
    });
    if (wallet.walletId !== walletId) {
      error(`Mnemonic wallet ID (${wallet.walletId}) doesn't match requested ID (${walletId})`);
    }
    return wallet;
  }

  if (config.authToken) {
    return Wallet.fromWalletId(walletId, {
      baseUrl: config.apiUrl,
      authToken: config.authToken,
      authTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
  }

  error('Authentication required. Set COINPAY_MNEMONIC or COINPAY_AUTH_TOKEN.');
}

// ── Commands ──

async function cmdCreate(flags, config) {
  // Dynamic import of the SDK (ESM-compatible)
  const { Wallet } = await import('../src/lib/wallet-sdk/index.ts');

  const words = parseInt(flags.words || '12', 10);
  if (words !== 12 && words !== 24) {
    error('--words must be 12 or 24');
  }

  const chains = flags.chains
    ? flags.chains.split(',').map((c) => c.trim().toUpperCase())
    : ['BTC', 'BCH', 'ETH', 'POL', 'SOL'];

  console.log(`\nCreating wallet with ${words}-word mnemonic...`);
  console.log(`Chains: ${chains.join(', ')}\n`);

  const wallet = await Wallet.create({
    baseUrl: config.apiUrl,
    chains,
    words,
  });

  console.log('Wallet created successfully!\n');
  console.log(`  Wallet ID:  ${wallet.walletId}`);
  console.log(`  Mnemonic:   ${wallet.getMnemonic()}`);
  console.log('\n  IMPORTANT: Write down your mnemonic and store it securely!');
  console.log('  Anyone with the mnemonic can access your funds.\n');
}

async function cmdImport(positional, flags, config) {
  const { Wallet } = await import('../src/lib/wallet-sdk/index.ts');

  const mnemonic = positional.join(' ');
  if (!mnemonic) {
    error('Usage: coinpay-wallet import <mnemonic words>');
  }

  const chains = flags.chains
    ? flags.chains.split(',').map((c) => c.trim().toUpperCase())
    : ['BTC', 'BCH', 'ETH', 'POL', 'SOL'];

  console.log(`\nImporting wallet...`);
  console.log(`Chains: ${chains.join(', ')}\n`);

  const wallet = await Wallet.fromSeed(mnemonic, {
    baseUrl: config.apiUrl,
    chains,
  });

  console.log('Wallet imported successfully!\n');
  console.log(`  Wallet ID: ${wallet.walletId}\n`);
}

async function cmdBalance(positional, config) {
  const walletId = positional[0];
  if (!walletId) {
    error('Usage: coinpay-wallet balance <wallet-id>');
  }

  const wallet = await getAuthenticatedWallet(walletId, config);

  console.log(`\nFetching balances for wallet ${walletId}...\n`);

  try {
    const result = await wallet.getTotalBalanceUSD();

    printTable(
      result.balances.map((b) => ({
        Chain: b.chain,
        Address: b.address.length > 20
          ? b.address.slice(0, 10) + '...' + b.address.slice(-8)
          : b.address,
        Balance: b.balance,
        'USD Value': `$${b.usdValue.toFixed(2)}`,
        Rate: `$${b.rate.toFixed(2)}`,
      }))
    );

    console.log(`\n  Total: $${result.totalUsd.toFixed(2)} USD\n`);
  } catch (e) {
    // Fallback to basic balance if total-usd fails
    const balances = await wallet.getBalances();
    printTable(
      balances.map((b) => ({
        Chain: b.chain,
        Address: b.address.length > 20
          ? b.address.slice(0, 10) + '...' + b.address.slice(-8)
          : b.address,
        Balance: b.balance,
      }))
    );
    console.log();
  }
}

async function cmdSend(positional, flags, config) {
  const walletId = positional[0];
  if (!walletId || !flags.from || !flags.to || !flags.chain || !flags.amount) {
    error(
      'Usage: coinpay-wallet send <wallet-id> --from <addr> --to <addr> --chain <chain> --amount <amount>'
    );
  }

  console.log(`\nPreparing transaction...`);
  console.log(`  From:   ${flags.from}`);
  console.log(`  To:     ${flags.to}`);
  console.log(`  Chain:  ${flags.chain}`);
  console.log(`  Amount: ${flags.amount}\n`);

  const wallet = await getAuthenticatedWallet(walletId, config);

  const result = await wallet.send({
    fromAddress: flags.from,
    toAddress: flags.to,
    chain: flags.chain.toUpperCase(),
    amount: flags.amount,
    priority: flags.priority || 'medium',
  });

  console.log('Transaction sent!\n');
  console.log(`  TX Hash:  ${result.txHash}`);
  console.log(`  Status:   ${result.status}`);
  console.log(`  Explorer: ${result.explorerUrl}\n`);
}

async function cmdAddress(positional, flags, config) {
  const walletId = positional[0];
  if (!walletId) {
    error('Usage: coinpay-wallet address <wallet-id> [--chain <chain>]');
  }

  const wallet = await getAuthenticatedWallet(walletId, config);

  console.log(`\nAddresses for wallet ${walletId}:\n`);

  const addresses = await wallet.getAddresses({
    chain: flags.chain?.toUpperCase(),
  });

  printTable(
    addresses.map((a) => ({
      Chain: a.chain,
      Address: a.address,
      Index: a.derivationIndex,
      Active: a.isActive ? 'yes' : 'no',
      Balance: a.cachedBalance || '-',
    }))
  );
  console.log();
}

async function cmdHistory(positional, flags, config) {
  const walletId = positional[0];
  if (!walletId) {
    error('Usage: coinpay-wallet history <wallet-id> [--chain <chain>] [--limit <n>]');
  }

  const wallet = await getAuthenticatedWallet(walletId, config);

  const limit = parseInt(flags.limit || '20', 10);
  console.log(`\nTransaction history for wallet ${walletId}:\n`);

  const result = await wallet.getTransactions({
    chain: flags.chain?.toUpperCase(),
    limit,
  });

  printTable(
    result.transactions.map((tx) => ({
      Direction: tx.direction,
      Chain: tx.chain,
      Amount: tx.amount,
      Status: tx.status,
      Hash: tx.txHash.length > 20
        ? tx.txHash.slice(0, 10) + '...' + tx.txHash.slice(-8)
        : tx.txHash,
      Date: tx.createdAt?.split('T')[0] || '-',
    }))
  );

  console.log(`\n  Showing ${result.transactions.length} of ${result.total} transactions\n`);
}

async function cmdSync(positional, flags, config) {
  const walletId = positional[0];
  if (!walletId) {
    error('Usage: coinpay-wallet sync <wallet-id> [--chain <chain>]');
  }

  const wallet = await getAuthenticatedWallet(walletId, config);

  const chain = flags.chain?.toUpperCase();
  console.log(`\nSyncing on-chain history for wallet ${walletId}${chain ? ` (${chain})` : ' (all chains)'}...\n`);

  const result = await wallet.syncHistory(chain);
  console.log(`  Synced: ${JSON.stringify(result)}\n`);
}

// ── Help ──

function showHelp() {
  console.log(`
CoinPayPortal Wallet CLI

Usage:
  pnpm coinpay-wallet <command> [options]

Commands:
  create                Create a new wallet
    --words <12|24>     Number of mnemonic words (default: 12)
    --chains <list>     Comma-separated chains (default: BTC,BCH,ETH,POL,SOL)

  import <mnemonic>     Import wallet from mnemonic phrase
    --chains <list>     Comma-separated chains (default: BTC,BCH,ETH,POL,SOL)

  balance <wallet-id>   Show wallet balances with USD values

  send <wallet-id>      Send a transaction
    --from <address>    Source address
    --to <address>      Destination address
    --chain <chain>     Blockchain (BTC, ETH, etc.)
    --amount <value>    Amount to send
    --priority <level>  Fee priority: low, medium, high (default: medium)

  address <wallet-id>   List wallet addresses
    --chain <chain>     Filter by chain

  history <wallet-id>   Show transaction history
    --chain <chain>     Filter by chain
    --limit <n>         Number of transactions (default: 20)

  sync <wallet-id>      Sync on-chain transaction history
    --chain <chain>     Sync specific chain only

Environment Variables:
  COINPAY_API_URL       API base URL (default: http://localhost:8080)
  COINPAY_AUTH_TOKEN    JWT auth token for read-only operations
  COINPAY_MNEMONIC      Mnemonic phrase (required for send)

Config File:
  ~/.coinpayrc.json     { "apiUrl": "...", "authToken": "..." }
`);
}

// ── Main ──

async function main() {
  const { command, positional, flags } = parseArgs(process.argv);
  const config = loadConfig();

  if (!command || command === 'help' || flags.help) {
    showHelp();
    process.exit(0);
  }

  try {
    switch (command) {
      case 'create':
        await cmdCreate(flags, config);
        break;
      case 'import':
        await cmdImport(positional, flags, config);
        break;
      case 'balance':
        await cmdBalance(positional, config);
        break;
      case 'send':
        await cmdSend(positional, flags, config);
        break;
      case 'address':
        await cmdAddress(positional, flags, config);
        break;
      case 'history':
        await cmdHistory(positional, flags, config);
        break;
      case 'sync':
        await cmdSync(positional, flags, config);
        break;
      default:
        error(`Unknown command: ${command}\nRun 'coinpay-wallet help' for usage.`);
    }
  } catch (err) {
    if (err.code) {
      error(`[${err.code}] ${err.message}`);
    } else {
      error(err.message || err);
    }
  }
}

main();
