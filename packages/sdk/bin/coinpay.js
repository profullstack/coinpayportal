#!/usr/bin/env node

/**
 * CoinPay CLI
 * Command-line interface for CoinPay cryptocurrency payments
 * with persistent GPG-encrypted wallet storage
 */

import { CoinPayClient } from '../src/client.js';
import { PaymentStatus, Blockchain, FiatCurrency } from '../src/payments.js';
import { 
  WalletClient, 
  generateMnemonic, 
  validateMnemonic,
  DEFAULT_CHAINS,
} from '../src/wallet.js';
import { SwapClient, SwapCoins } from '../src/swap.js';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { createInterface } from 'readline';
import { homedir } from 'os';
import { join } from 'path';
import { tmpdir } from 'os';

const VERSION = '0.4.0';
const CONFIG_FILE = join(homedir(), '.coinpay.json');
const DEFAULT_WALLET_FILE = join(homedir(), '.coinpay-wallet.gpg');

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

/**
 * Print colored output
 */
const print = {
  error: (msg) => console.error(`${colors.red}Error:${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  info: (msg) => console.log(`${colors.cyan}ℹ${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  json: (data) => console.log(JSON.stringify(data, null, 2)),
};

/**
 * Load configuration
 */
function loadConfig() {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch {
    // Ignore errors
  }
  return {};
}

/**
 * Save configuration
 */
function saveConfig(config) {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

/**
 * Get wallet file path from config or default
 */
function getWalletFilePath(flags = {}) {
  if (flags['wallet-file']) {
    return flags['wallet-file'].replace(/^~/, homedir());
  }
  const config = loadConfig();
  if (config.walletFile) {
    return config.walletFile.replace(/^~/, homedir());
  }
  return DEFAULT_WALLET_FILE;
}

/**
 * Check if encrypted wallet exists
 */
function hasEncryptedWallet(flags = {}) {
  const walletFile = getWalletFilePath(flags);
  return existsSync(walletFile);
}

/**
 * Get API key from config or environment
 */
function getApiKey() {
  const config = loadConfig();
  return process.env.COINPAY_API_KEY || config.apiKey;
}

/**
 * Get base URL from config or environment
 */
function getBaseUrl() {
  const config = loadConfig();
  return process.env.COINPAY_BASE_URL || config.baseUrl || 'https://coinpayportal.com/api';
}

/**
 * Create client instance
 */
function createClient() {
  const apiKey = getApiKey();
  if (!apiKey) {
    print.error('API key not configured. Run: coinpay config set-key <api-key>');
    process.exit(1);
  }
  return new CoinPayClient({ apiKey, baseUrl: getBaseUrl() });
}

/**
 * Parse command line arguments
 */
function parseArgs(args) {
  const result = { command: null, subcommand: null, args: [], flags: {} };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        result.flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const next = args[i + 1];
        if (next && !next.startsWith('-')) {
          result.flags[arg.slice(2)] = next;
          i++;
        } else {
          result.flags[arg.slice(2)] = true;
        }
      }
    } else if (arg.startsWith('-')) {
      result.flags[arg.slice(1)] = args[++i] ?? true;
    } else if (!result.command) {
      result.command = arg;
    } else if (!result.subcommand) {
      result.subcommand = arg;
    } else {
      result.args.push(arg);
    }
  }
  
  return result;
}

/**
 * Show help
 */
function showHelp() {
  console.log(`
${colors.bright}CoinPay CLI${colors.reset} v${VERSION}

${colors.cyan}Usage:${colors.reset}
  coinpay <command> [options]

${colors.cyan}Commands:${colors.reset}
  ${colors.bright}config${colors.reset}
    set-key <api-key>     Set your API key
    set-url <base-url>    Set custom API URL
    show                  Show current configuration

  ${colors.bright}payment${colors.reset}
    create                Create a new payment
    get <id>              Get payment details
    list                  List payments
    qr <id>               Get payment QR code

  ${colors.bright}business${colors.reset}
    create                Create a new business
    get <id>              Get business details
    list                  List businesses
    update <id>           Update business

  ${colors.bright}rates${colors.reset}
    get <crypto>          Get exchange rate
    list                  Get all exchange rates

  ${colors.bright}wallet${colors.reset}
    create                Create new wallet (saves encrypted)
    import <mnemonic>     Import wallet (saves encrypted)
    unlock                Decrypt wallet and show info
    info                  Show wallet info
    addresses             List all addresses
    derive <chain>        Derive new address
    derive-missing        Derive addresses for missing chains
    balance [chain]       Get balance(s)
    send                  Send a transaction
    history               Transaction history
    backup                Export encrypted backup
    delete                Delete local wallet file

  ${colors.bright}swap${colors.reset}
    coins                 List supported coins
    quote                 Get swap quote
    create                Create swap transaction
    status <swap-id>      Check swap status
    history               Swap history

  ${colors.bright}escrow${colors.reset}
    create                Create a new escrow
    get <id>              Get escrow status
    list                  List escrows
    release <id>          Release funds to beneficiary
    refund <id>           Refund funds to depositor
    dispute <id>          Open a dispute
    events <id>           Get escrow audit log

  ${colors.bright}webhook${colors.reset}
    logs <business-id>    Get webhook logs
    test <business-id>    Send test webhook

${colors.cyan}Wallet Options:${colors.reset}
  --words <12|24>         Number of mnemonic words (default: 12)
  --chains <BTC,ETH,...>  Chains to derive (default: BTC,ETH,SOL,POL,BCH)
  --chain <chain>         Single chain for operations
  --to <address>          Recipient address
  --amount <amount>       Amount to send
  --password <pass>       Wallet encryption password
  --wallet-file <path>    Custom wallet file (default: ~/.coinpay-wallet.gpg)
  --no-save               Don't save wallet locally after create/import

${colors.cyan}Swap Options:${colors.reset}
  --from <coin>           Source coin (e.g., BTC)
  --to <coin>             Destination coin (e.g., ETH)
  --amount <amount>       Amount to swap
  --refund <address>      Refund address (recommended)

${colors.cyan}Examples:${colors.reset}
  # Create a new wallet (auto-saves encrypted)
  coinpay wallet create --words 12

  # Import existing wallet
  coinpay wallet import "word1 word2 ... word12"

  # Get wallet balance (auto-decrypts)
  coinpay wallet balance

  # Send transaction (auto-decrypts for signing)
  coinpay wallet send --chain ETH --to 0x123... --amount 0.1

  # Swap BTC to ETH
  coinpay swap quote --from BTC --to ETH --amount 0.1
  coinpay swap create --from BTC --to ETH --amount 0.1 --settle 0x...

${colors.cyan}Environment Variables:${colors.reset}
  COINPAY_API_KEY         API key (overrides config)
  COINPAY_BASE_URL        Custom API URL
`);
}

/**
 * Prompt for user input
 */
function prompt(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Prompt for password (hidden input)
 */
function promptPassword(promptText = 'Password: ') {
  return new Promise((resolve) => {
    process.stdout.write(promptText);
    
    if (process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = (chunk) => {
        if (typeof chunk === 'string' && chunk !== promptText && chunk !== '\n' && chunk !== '\r\n') {
          return true;
        }
        return origWrite(chunk);
      };
      
      rl.question('', (answer) => {
        process.stdout.write = origWrite;
        process.stdout.write('\n');
        rl.close();
        resolve(answer);
      });
    } else {
      const chunks = [];
      process.stdin.on('data', (chunk) => chunks.push(chunk));
      process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString().trim()));
      process.stdin.resume();
    }
  });
}

/**
 * Prompt yes/no confirmation
 */
async function promptYesNo(question, defaultYes = true) {
  const suffix = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = await prompt(`${question} ${suffix} `);
  
  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith('y');
}

/**
 * Check if gpg is available
 */
function hasGpg() {
  try {
    execSync('gpg --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Encrypt mnemonic with GPG and save to file
 */
async function saveEncryptedWallet(mnemonic, walletId, password, walletFile) {
  if (!hasGpg()) {
    throw new Error('GPG is required for wallet encryption. Install: apt install gnupg');
  }
  
  const content = JSON.stringify({
    version: 1,
    walletId,
    mnemonic,
    createdAt: new Date().toISOString(),
  });
  
  const tmpFile = join(tmpdir(), `coinpay-wallet-${Date.now()}.json`);
  const passFile = join(tmpdir(), `coinpay-pass-${Date.now()}`);
  
  try {
    writeFileSync(tmpFile, content, { mode: 0o600 });
    writeFileSync(passFile, password, { mode: 0o600 });
    
    execSync(
      `gpg --batch --yes --passphrase-file "${passFile}" --pinentry-mode loopback --symmetric --cipher-algo AES256 --output "${walletFile}" "${tmpFile}"`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    
    return true;
  } finally {
    // Secure cleanup
    try { writeFileSync(tmpFile, Buffer.alloc(content.length, 0)); unlinkSync(tmpFile); } catch {}
    try { writeFileSync(passFile, Buffer.alloc(password.length, 0)); unlinkSync(passFile); } catch {}
  }
}

/**
 * Decrypt wallet file and return contents
 */
async function loadEncryptedWallet(password, walletFile) {
  if (!hasGpg()) {
    throw new Error('GPG is required for wallet decryption');
  }
  
  if (!existsSync(walletFile)) {
    throw new Error(`Wallet file not found: ${walletFile}`);
  }
  
  const passFile = join(tmpdir(), `coinpay-pass-${Date.now()}`);
  
  try {
    writeFileSync(passFile, password, { mode: 0o600 });
    
    const result = execSync(
      `gpg --batch --yes --passphrase-file "${passFile}" --pinentry-mode loopback --decrypt "${walletFile}"`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    
    const data = JSON.parse(result.toString());
    return data;
  } finally {
    try { writeFileSync(passFile, Buffer.alloc(password.length, 0)); unlinkSync(passFile); } catch {}
  }
}

/**
 * Get decrypted mnemonic from wallet file
 * Prompts for password if needed
 */
async function getDecryptedMnemonic(flags) {
  const walletFile = getWalletFilePath(flags);
  
  if (!existsSync(walletFile)) {
    return null;
  }
  
  let password = flags.password;
  if (!password) {
    if (!process.stdin.isTTY) {
      throw new Error('Password required. Use --password or run interactively.');
    }
    password = await promptPassword('Wallet password: ');
  }
  
  try {
    const data = await loadEncryptedWallet(password, walletFile);
    return data.mnemonic;
  } catch (error) {
    if (error.message.includes('decrypt')) {
      throw new Error('Wrong password or corrupted wallet file');
    }
    throw error;
  }
}

/**
 * Securely clear a string from memory
 */
function clearString(str) {
  if (str && typeof str === 'string') {
    // Can't truly clear in JS, but we can try to minimize exposure
    return '';
  }
  return str;
}

// ═══════════════════════════════════════════════════════════════
// COMMAND HANDLERS
// ═══════════════════════════════════════════════════════════════

/**
 * Config commands
 */
async function handleConfig(subcommand, args) {
  const config = loadConfig();
  
  switch (subcommand) {
    case 'set-key':
      if (!args[0]) {
        print.error('API key required');
        return;
      }
      config.apiKey = args[0];
      saveConfig(config);
      print.success('API key saved');
      break;
      
    case 'set-url':
      if (!args[0]) {
        print.error('Base URL required');
        return;
      }
      config.baseUrl = args[0];
      saveConfig(config);
      print.success('Base URL saved');
      break;
      
    case 'show':
      print.info(`Config file: ${CONFIG_FILE}`);
      print.json({
        apiKey: config.apiKey ? `${config.apiKey.slice(0, 10)}...` : '(not set)',
        baseUrl: config.baseUrl || '(default)',
        walletId: config.walletId || '(none)',
        walletFile: config.walletFile || DEFAULT_WALLET_FILE,
      });
      break;
      
    default:
      print.error(`Unknown config command: ${subcommand}`);
      showHelp();
  }
}

/**
 * Payment commands
 */
async function handlePayment(subcommand, args, flags) {
  const client = createClient();
  
  switch (subcommand) {
    case 'create': {
      const { 'business-id': businessId, amount, currency = 'USD', blockchain, description } = flags;
      
      if (!businessId || !amount || !blockchain) {
        print.error('Required: --business-id, --amount, --blockchain');
        print.info('Example: coinpay payment create --business-id biz_123 --amount 100 --blockchain BTC');
        return;
      }
      
      const payment = await client.createPayment({
        businessId,
        amount: parseFloat(amount),
        currency,
        blockchain,
        description,
      });
      
      print.success('Payment created');
      if (payment.payment) {
        print.info(`Payment Address: ${payment.payment.payment_address}`);
        print.info(`Amount: ${payment.payment.crypto_amount} ${payment.payment.blockchain}`);
        print.info(`Expires: ${payment.payment.expires_at}`);
      }
      if (flags.json) {
        print.json(payment);
      }
      break;
    }
    
    case 'get': {
      const paymentId = args[0];
      if (!paymentId) {
        print.error('Payment ID required');
        return;
      }
      
      const payment = await client.getPayment(paymentId);
      print.json(payment);
      break;
    }
    
    case 'list': {
      const { 'business-id': businessId, status, limit } = flags;
      
      if (!businessId) {
        print.error('Required: --business-id');
        return;
      }
      
      const payments = await client.listPayments({
        businessId,
        status,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
      
      print.json(payments);
      break;
    }
    
    case 'qr': {
      const paymentId = args[0];
      
      if (!paymentId) {
        print.error('Payment ID required');
        return;
      }
      
      const url = client.getPaymentQRUrl(paymentId);
      print.info(`QR Code URL: ${url}`);
      break;
    }
    
    default:
      print.error(`Unknown payment command: ${subcommand}`);
      showHelp();
  }
}

/**
 * Business commands
 */
async function handleBusiness(subcommand, args, flags) {
  const client = createClient();
  
  switch (subcommand) {
    case 'create': {
      const { name, 'webhook-url': webhookUrl } = flags;
      
      if (!name) {
        print.error('Required: --name');
        return;
      }
      
      const business = await client.createBusiness({ name, webhookUrl });
      print.success('Business created');
      print.json(business);
      break;
    }
    
    case 'get': {
      const businessId = args[0];
      if (!businessId) {
        print.error('Business ID required');
        return;
      }
      
      const business = await client.getBusiness(businessId);
      print.json(business);
      break;
    }
    
    case 'list': {
      const businesses = await client.listBusinesses();
      print.json(businesses);
      break;
    }
    
    case 'update': {
      const businessId = args[0];
      const { name, 'webhook-url': webhookUrl } = flags;
      
      if (!businessId) {
        print.error('Business ID required');
        return;
      }
      
      const updates = {};
      if (name) updates.name = name;
      if (webhookUrl) updates.webhookUrl = webhookUrl;
      
      const business = await client.updateBusiness(businessId, updates);
      print.success('Business updated');
      print.json(business);
      break;
    }
    
    default:
      print.error(`Unknown business command: ${subcommand}`);
      showHelp();
  }
}

/**
 * Rates commands
 */
async function handleRates(subcommand, args, flags) {
  const client = createClient();
  
  switch (subcommand) {
    case 'get': {
      const crypto = args[0];
      const { fiat } = flags;
      
      if (!crypto) {
        print.error('Blockchain code required (BTC, ETH, SOL, etc.)');
        return;
      }
      
      const rate = await client.getExchangeRate(crypto, fiat);
      print.json(rate);
      break;
    }
    
    case 'list': {
      const { fiat } = flags;
      const cryptos = Object.values(Blockchain);
      const rates = await client.getExchangeRates(cryptos, fiat);
      print.json(rates);
      break;
    }
    
    default:
      print.error(`Unknown rates command: ${subcommand}`);
      showHelp();
  }
}

/**
 * Webhook commands
 */
async function handleWebhook(subcommand, args, flags) {
  const client = createClient();
  
  switch (subcommand) {
    case 'logs': {
      const businessId = args[0];
      const { limit } = flags;
      
      if (!businessId) {
        print.error('Business ID required');
        return;
      }
      
      const logs = await client.getWebhookLogs(businessId, limit ? parseInt(limit, 10) : undefined);
      print.json(logs);
      break;
    }
    
    case 'test': {
      const businessId = args[0];
      const { event } = flags;
      
      if (!businessId) {
        print.error('Business ID required');
        return;
      }
      
      const result = await client.testWebhook(businessId, event);
      print.success('Test webhook sent');
      print.json(result);
      break;
    }
    
    default:
      print.error(`Unknown webhook command: ${subcommand}`);
      showHelp();
  }
}

/**
 * Wallet commands
 */
async function handleWallet(subcommand, args, flags) {
  const baseUrl = getBaseUrl();
  const config = loadConfig();
  const walletFile = getWalletFilePath(flags);
  
  switch (subcommand) {
    case 'create': {
      const words = parseInt(flags.words || '12', 10);
      const chainsStr = flags.chains || DEFAULT_CHAINS.join(',');
      const chains = chainsStr.split(',').map(c => c.trim().toUpperCase());
      const noSave = flags['no-save'] === true;
      
      if (words !== 12 && words !== 24) {
        print.error('Words must be 12 or 24');
        return;
      }
      
      // Check if wallet already exists
      if (hasEncryptedWallet(flags)) {
        const overwrite = await promptYesNo('Wallet already exists. Overwrite?', false);
        if (!overwrite) {
          print.info('Aborted');
          return;
        }
      }
      
      print.info(`Creating wallet with ${words} words...`);
      
      // Generate mnemonic locally
      const mnemonic = generateMnemonic(words);
      
      try {
        // Register with server
        const wallet = await WalletClient.create({
          words,
          chains,
          baseUrl,
        });
        
        const walletId = wallet.getWalletId();
        
        // Show mnemonic to user
        console.log(`\n${colors.bright}${colors.yellow}⚠️  BACKUP YOUR SEED PHRASE:${colors.reset}`);
        console.log(`${colors.yellow}${wallet.getMnemonic()}${colors.reset}\n`);
        print.warn('Write this down and store it safely. It CANNOT be recovered!');
        
        // Save encrypted locally (unless --no-save)
        if (!noSave) {
          let shouldSave = true;
          if (process.stdin.isTTY) {
            shouldSave = await promptYesNo('\nSave encrypted wallet locally?', true);
          }
          
          if (shouldSave) {
            let password = flags.password;
            if (!password) {
              password = await promptPassword('Create wallet password: ');
              const confirm = await promptPassword('Confirm password: ');
              if (password !== confirm) {
                print.error('Passwords do not match. Wallet not saved locally.');
                print.warn('Your wallet is registered but NOT saved locally. Save your seed phrase!');
              } else {
                await saveEncryptedWallet(wallet.getMnemonic(), walletId, password, walletFile);
                print.success(`Encrypted wallet saved to: ${walletFile}`);
              }
            } else {
              await saveEncryptedWallet(wallet.getMnemonic(), walletId, password, walletFile);
              print.success(`Encrypted wallet saved to: ${walletFile}`);
            }
          }
        }
        
        // Update config
        config.walletId = walletId;
        config.walletFile = walletFile;
        saveConfig(config);
        
        print.success(`Wallet created: ${walletId}`);
      } catch (error) {
        print.error(error.message);
      }
      break;
    }
    
    case 'import': {
      const mnemonic = args.join(' ') || flags.mnemonic;
      const noSave = flags['no-save'] === true;
      
      if (!mnemonic) {
        print.error('Mnemonic required');
        print.info('Usage: coinpay wallet import "word1 word2 ... word12"');
        return;
      }
      
      if (!validateMnemonic(mnemonic)) {
        print.error('Invalid mnemonic phrase');
        return;
      }
      
      // Check if wallet already exists
      if (hasEncryptedWallet(flags)) {
        const overwrite = await promptYesNo('Wallet already exists. Overwrite?', false);
        if (!overwrite) {
          print.info('Aborted');
          return;
        }
      }
      
      const chainsStr = flags.chains || DEFAULT_CHAINS.join(',');
      const chains = chainsStr.split(',').map(c => c.trim().toUpperCase());
      
      print.info('Importing wallet...');
      
      try {
        const wallet = await WalletClient.fromSeed(mnemonic, {
          chains,
          baseUrl,
        });
        
        const walletId = wallet.getWalletId();
        
        // Save encrypted locally (unless --no-save)
        if (!noSave) {
          let shouldSave = true;
          if (process.stdin.isTTY) {
            shouldSave = await promptYesNo('Save encrypted wallet locally?', true);
          }
          
          if (shouldSave) {
            let password = flags.password;
            if (!password) {
              password = await promptPassword('Create wallet password: ');
              const confirm = await promptPassword('Confirm password: ');
              if (password !== confirm) {
                print.error('Passwords do not match. Wallet not saved locally.');
              } else {
                await saveEncryptedWallet(mnemonic, walletId, password, walletFile);
                print.success(`Encrypted wallet saved to: ${walletFile}`);
              }
            } else {
              await saveEncryptedWallet(mnemonic, walletId, password, walletFile);
              print.success(`Encrypted wallet saved to: ${walletFile}`);
            }
          }
        }
        
        // Update config
        config.walletId = walletId;
        config.walletFile = walletFile;
        saveConfig(config);
        
        print.success(`Wallet imported: ${walletId}`);
      } catch (error) {
        print.error(error.message);
      }
      break;
    }
    
    case 'unlock': {
      if (!hasEncryptedWallet(flags)) {
        print.error(`No wallet file found at: ${walletFile}`);
        print.info('Create a wallet with: coinpay wallet create');
        return;
      }
      
      try {
        const mnemonic = await getDecryptedMnemonic(flags);
        
        print.success('Wallet unlocked');
        print.info(`Wallet ID: ${config.walletId || 'unknown'}`);
        print.info(`Wallet file: ${walletFile}`);
        
        if (flags.show) {
          console.log(`\n${colors.bright}Seed Phrase:${colors.reset}`);
          console.log(`${colors.yellow}${mnemonic}${colors.reset}\n`);
          print.warn('This is sensitive data — do not share it.');
        }
        
        // Clear from memory
        clearString(mnemonic);
      } catch (error) {
        print.error(error.message);
      }
      break;
    }
    
    case 'info': {
      if (!config.walletId && !hasEncryptedWallet(flags)) {
        print.error('No wallet configured. Run: coinpay wallet create');
        return;
      }
      
      print.info(`Wallet ID: ${config.walletId || '(unknown)'}`);
      print.info(`Wallet file: ${walletFile}`);
      print.info(`File exists: ${existsSync(walletFile) ? 'yes' : 'no'}`);
      
      if (flags.json) {
        print.json({
          walletId: config.walletId,
          walletFile,
          exists: existsSync(walletFile),
        });
      }
      break;
    }
    
    case 'addresses': {
      if (!config.walletId) {
        print.error('No wallet configured. Run: coinpay wallet create');
        return;
      }
      
      print.info(`Wallet: ${config.walletId}`);
      print.info('Note: Full address list requires API authentication.');
      break;
    }
    
    case 'derive': {
      const chain = (args[0] || flags.chain || '').toUpperCase();
      const index = parseInt(flags.index || '0', 10);
      
      if (!chain) {
        print.error('Chain required');
        print.info('Usage: coinpay wallet derive ETH --index 0');
        return;
      }
      
      if (!config.walletId) {
        print.error('No wallet configured. Run: coinpay wallet create');
        return;
      }
      
      // Need mnemonic for derivation
      if (!hasEncryptedWallet(flags)) {
        print.error('No encrypted wallet found. Cannot derive addresses.');
        return;
      }
      
      try {
        const mnemonic = await getDecryptedMnemonic(flags);
        
        // Create wallet client with mnemonic
        const wallet = await WalletClient.fromSeed(mnemonic, { baseUrl });
        const result = await wallet.deriveAddress(chain, index);
        
        print.success(`Derived ${chain} address at index ${index}`);
        if (flags.json) {
          print.json(result);
        }
        
        clearString(mnemonic);
      } catch (error) {
        print.error(error.message);
      }
      break;
    }
    
    case 'derive-missing': {
      const chainsStr = flags.chains;
      
      if (!config.walletId) {
        print.error('No wallet configured. Run: coinpay wallet create');
        return;
      }
      
      if (!hasEncryptedWallet(flags)) {
        print.error('No encrypted wallet found.');
        return;
      }
      
      try {
        const mnemonic = await getDecryptedMnemonic(flags);
        const wallet = await WalletClient.fromSeed(mnemonic, { baseUrl });
        
        const chains = chainsStr ? chainsStr.split(',').map(c => c.trim().toUpperCase()) : undefined;
        const results = await wallet.deriveMissingChains(chains);
        
        print.success(`Derived ${results.length} new addresses`);
        if (flags.json) {
          print.json(results);
        }
        
        clearString(mnemonic);
      } catch (error) {
        print.error(error.message);
      }
      break;
    }
    
    case 'balance': {
      const chain = (args[0] || flags.chain || '').toUpperCase();
      
      if (!config.walletId) {
        print.error('No wallet configured. Run: coinpay wallet create');
        return;
      }
      
      // For balance, we need the wallet client with mnemonic for authenticated requests
      if (!hasEncryptedWallet(flags)) {
        print.info(`Wallet: ${config.walletId}`);
        if (chain) {
          print.info(`Chain: ${chain}`);
        }
        print.info('Note: Balance check requires encrypted wallet file.');
        return;
      }
      
      try {
        const mnemonic = await getDecryptedMnemonic(flags);
        const wallet = await WalletClient.fromSeed(mnemonic, { baseUrl });
        
        const result = chain ? await wallet.getBalance(chain) : await wallet.getBalances();
        
        if (flags.json) {
          print.json(result);
        } else {
          print.success('Balances:');
          for (const bal of result.balances || []) {
            console.log(`  ${colors.bright}${bal.chain}${colors.reset}: ${bal.balance}`);
          }
        }
        
        clearString(mnemonic);
      } catch (error) {
        print.error(error.message);
      }
      break;
    }
    
    case 'send': {
      const chain = (flags.chain || '').toUpperCase();
      const to = flags.to;
      const amount = flags.amount;
      const priority = flags.priority || 'medium';
      
      if (!chain || !to || !amount) {
        print.error('Required: --chain, --to, --amount');
        print.info('Usage: coinpay wallet send --chain ETH --to 0x123... --amount 0.1');
        return;
      }
      
      if (!config.walletId) {
        print.error('No wallet configured. Run: coinpay wallet create');
        return;
      }
      
      if (!hasEncryptedWallet(flags)) {
        print.error('No encrypted wallet found. Cannot sign transactions.');
        return;
      }
      
      try {
        const mnemonic = await getDecryptedMnemonic(flags);
        const wallet = await WalletClient.fromSeed(mnemonic, { baseUrl });
        
        print.info(`Sending ${amount} ${chain} to ${to}...`);
        
        const result = await wallet.send({ chain, to, amount, priority });
        
        print.success('Transaction sent!');
        if (result.tx_hash) {
          print.info(`TX Hash: ${result.tx_hash}`);
        }
        
        if (flags.json) {
          print.json(result);
        }
        
        clearString(mnemonic);
      } catch (error) {
        print.error(error.message);
      }
      break;
    }
    
    case 'history': {
      const chain = (flags.chain || '').toUpperCase();
      const limit = parseInt(flags.limit || '20', 10);
      
      if (!config.walletId) {
        print.error('No wallet configured. Run: coinpay wallet create');
        return;
      }
      
      if (!hasEncryptedWallet(flags)) {
        print.info(`Wallet: ${config.walletId}`);
        print.info('Note: Transaction history requires encrypted wallet file.');
        return;
      }
      
      try {
        const mnemonic = await getDecryptedMnemonic(flags);
        const wallet = await WalletClient.fromSeed(mnemonic, { baseUrl });
        
        const result = await wallet.getHistory({ chain: chain || undefined, limit });
        
        if (flags.json) {
          print.json(result);
        } else {
          print.info(`Transactions (${result.total || 0} total):`);
          for (const tx of result.transactions || []) {
            const dir = tx.direction === 'incoming' ? colors.green + '←' : colors.red + '→';
            console.log(`  ${dir}${colors.reset} ${tx.amount} ${tx.chain} | ${tx.status} | ${tx.created_at}`);
          }
        }
        
        clearString(mnemonic);
      } catch (error) {
        print.error(error.message);
      }
      break;
    }
    
    case 'backup': {
      if (!hasEncryptedWallet(flags)) {
        print.error(`No wallet file found at: ${walletFile}`);
        return;
      }
      
      const outputPath = flags.output || `coinpay-wallet-backup-${Date.now()}.gpg`;
      
      try {
        // Just copy the encrypted file
        const content = readFileSync(walletFile);
        writeFileSync(outputPath, content, { mode: 0o600 });
        
        print.success(`Backup saved to: ${outputPath}`);
        print.info('This file is GPG encrypted. Keep your password safe!');
      } catch (error) {
        print.error(error.message);
      }
      break;
    }
    
    case 'delete': {
      if (!hasEncryptedWallet(flags)) {
        print.info('No wallet file to delete');
        return;
      }
      
      const confirm = await promptYesNo('Are you sure you want to delete the local wallet?', false);
      if (!confirm) {
        print.info('Aborted');
        return;
      }
      
      try {
        unlinkSync(walletFile);
        
        // Clear from config
        delete config.walletFile;
        saveConfig(config);
        
        print.success('Wallet file deleted');
        print.warn('Your wallet is still registered on the server. Keep your seed phrase safe!');
      } catch (error) {
        print.error(error.message);
      }
      break;
    }

    default:
      print.error(`Unknown wallet command: ${subcommand}`);
      print.info('Available: create, import, unlock, info, addresses, derive, derive-missing, balance, send, history, backup, delete');
      process.exit(1);
  }
}

/**
 * Swap commands
 */
async function handleSwap(subcommand, args, flags) {
  const baseUrl = getBaseUrl();
  const config = loadConfig();
  const swap = new SwapClient({ baseUrl, walletId: config.walletId });
  
  switch (subcommand) {
    case 'coins': {
      const result = await swap.getSwapCoins({ search: flags.search });
      
      if (flags.json) {
        print.json(result);
      } else {
        print.info(`Supported coins (${result.count}):`);
        for (const coin of result.coins) {
          console.log(`  ${colors.bright}${coin.symbol}${colors.reset} - ${coin.name} (${coin.network})`);
        }
      }
      break;
    }
    
    case 'quote': {
      const from = (flags.from || '').toUpperCase();
      const to = (flags.to || '').toUpperCase();
      const amount = flags.amount;
      
      if (!from || !to || !amount) {
        print.error('Required: --from, --to, --amount');
        print.info('Example: coinpay swap quote --from BTC --to ETH --amount 0.1');
        return;
      }
      
      try {
        const result = await swap.getSwapQuote(from, to, amount);
        
        if (flags.json) {
          print.json(result);
        } else {
          const q = result.quote;
          print.success('Swap Quote:');
          console.log(`  ${colors.bright}${q.from}${colors.reset} → ${colors.bright}${q.to}${colors.reset}`);
          console.log(`  You send: ${colors.yellow}${q.depositAmount} ${q.from}${colors.reset}`);
          console.log(`  You receive: ${colors.green}~${q.settleAmount} ${q.to}${colors.reset}`);
          console.log(`  Rate: 1 ${q.from} = ${q.rate} ${q.to}`);
          console.log(`  Min amount: ${q.minAmount} ${q.from}`);
        }
      } catch (error) {
        print.error(error.message);
      }
      break;
    }
    
    case 'create': {
      const from = (flags.from || '').toUpperCase();
      const to = (flags.to || '').toUpperCase();
      const amount = flags.amount;
      const settleAddress = flags.settle;
      const refundAddress = flags.refund;
      
      if (!from || !to || !amount) {
        print.error('Required: --from, --to, --amount');
        print.info('Example: coinpay swap create --from BTC --to ETH --amount 0.1 --settle 0x...');
        return;
      }
      
      if (!config.walletId) {
        print.error('No wallet configured. Run: coinpay wallet create');
        return;
      }
      
      if (!settleAddress) {
        print.error('Required: --settle <address>');
        return;
      }
      
      print.info(`Creating swap: ${amount} ${from} → ${to}`);
      
      try {
        const result = await swap.createSwap({
          from,
          to,
          amount,
          settleAddress,
          refundAddress,
        });
        
        if (flags.json) {
          print.json(result);
        } else {
          const s = result.swap;
          print.success('Swap created!');
          console.log(`\n  ${colors.bright}Swap ID:${colors.reset} ${s.id}`);
          console.log(`  ${colors.bright}Status:${colors.reset} ${s.status}`);
          console.log(`\n  ${colors.yellow}⚠️  Send exactly ${s.depositAmount} ${from} to:${colors.reset}`);
          console.log(`  ${colors.bright}${s.depositAddress}${colors.reset}\n`);
        }
      } catch (error) {
        print.error(error.message);
      }
      break;
    }
    
    case 'status': {
      const swapId = args[0] || flags.id;
      
      if (!swapId) {
        print.error('Swap ID required');
        print.info('Usage: coinpay swap status <swap-id>');
        return;
      }
      
      try {
        const result = await swap.getSwapStatus(swapId);
        
        if (flags.json) {
          print.json(result);
        } else {
          const s = result.swap;
          const statusColor = s.status === 'settled' ? colors.green : 
                             s.status === 'failed' ? colors.red : colors.yellow;
          
          print.info(`Swap ${s.id}:`);
          console.log(`  Status: ${statusColor}${s.status}${colors.reset}`);
          console.log(`  ${s.depositCoin || s.from} → ${s.settleCoin || s.to}`);
          console.log(`  Deposit: ${s.depositAmount}`);
          if (s.settleAmount) {
            console.log(`  Settled: ${s.settleAmount}`);
          }
        }
      } catch (error) {
        print.error(error.message);
      }
      break;
    }
    
    case 'history': {
      const limit = parseInt(flags.limit || '20', 10);
      
      if (!config.walletId) {
        print.error('No wallet configured. Run: coinpay wallet create');
        return;
      }
      
      try {
        const result = await swap.getSwapHistory(config.walletId, {
          status: flags.status,
          limit,
        });
        
        if (flags.json) {
          print.json(result);
        } else {
          print.info(`Swap history (${result.pagination?.total || 0} total):`);
          
          if (!result.swaps || result.swaps.length === 0) {
            console.log('  No swaps found.');
          } else {
            for (const s of result.swaps) {
              const statusColor = s.status === 'settled' ? colors.green : 
                                 s.status === 'failed' ? colors.red : colors.yellow;
              console.log(`  ${s.id} | ${s.from_coin} → ${s.to_coin} | ${statusColor}${s.status}${colors.reset}`);
            }
          }
        }
      } catch (error) {
        print.error(error.message);
      }
      break;
    }
    
    default:
      print.error(`Unknown swap command: ${subcommand}`);
      print.info('Available: coins, quote, create, status, history');
      process.exit(1);
  }
}

/**
 * Escrow commands
 */
async function handleEscrow(subcommand, args, flags) {
  const client = createClient();

  switch (subcommand) {
    case 'create': {
      const chain = flags.chain || flags.blockchain;
      const amount = parseFloat(flags.amount);
      const depositor = flags.depositor || flags['depositor-address'];
      const beneficiary = flags.beneficiary || flags['beneficiary-address'];

      if (!chain || !amount || !depositor || !beneficiary) {
        print.error('Required: --chain, --amount, --depositor, --beneficiary');
        process.exit(1);
      }

      print.info(`Creating escrow: ${amount} ${chain}`);

      const escrow = await client.createEscrow({
        chain,
        amount,
        depositorAddress: depositor,
        beneficiaryAddress: beneficiary,
        metadata: flags.metadata ? JSON.parse(flags.metadata) : undefined,
        expiresInHours: flags['expires-in'] ? parseFloat(flags['expires-in']) : undefined,
      });

      print.success(`Escrow created: ${escrow.id}`);
      print.info(`  Deposit to: ${escrow.escrowAddress}`);
      print.info(`  Status: ${escrow.status}`);
      print.warn(`  Release Token: ${escrow.releaseToken}`);
      print.warn('  ⚠️  Save these tokens!');

      if (flags.json) print.json(escrow);
      break;
    }

    case 'get': {
      const id = args[0];
      if (!id) { print.error('Escrow ID required'); process.exit(1); }

      const escrow = await client.getEscrow(id);
      print.success(`Escrow ${escrow.id}`);
      print.info(`  Status: ${escrow.status}`);
      print.info(`  Chain: ${escrow.chain}`);
      print.info(`  Amount: ${escrow.amount}`);

      if (flags.json) print.json(escrow);
      break;
    }

    case 'list': {
      const result = await client.listEscrows({
        status: flags.status,
        limit: flags.limit ? parseInt(flags.limit) : 20,
      });

      print.info(`Escrows (${result.total} total):`);
      for (const e of result.escrows) {
        console.log(`  ${e.id} | ${e.status} | ${e.amount} ${e.chain}`);
      }

      if (flags.json) print.json(result);
      break;
    }

    case 'release': {
      const id = args[0];
      const token = flags.token;
      if (!id || !token) { print.error('Required: <id> --token <token>'); process.exit(1); }

      const escrow = await client.releaseEscrow(id, token);
      print.success(`Escrow ${id} released`);
      break;
    }

    case 'refund': {
      const id = args[0];
      const token = flags.token;
      if (!id || !token) { print.error('Required: <id> --token <token>'); process.exit(1); }

      const escrow = await client.refundEscrow(id, token);
      print.success(`Escrow ${id} refunded`);
      break;
    }

    case 'dispute': {
      const id = args[0];
      const token = flags.token;
      const reason = flags.reason;
      if (!id || !token || !reason) {
        print.error('Required: <id> --token <token> --reason "description"');
        process.exit(1);
      }

      const escrow = await client.disputeEscrow(id, token, reason);
      print.success(`Escrow ${id} disputed`);
      break;
    }

    case 'events': {
      const id = args[0];
      if (!id) { print.error('Escrow ID required'); process.exit(1); }

      const events = await client.getEscrowEvents(id);
      print.info(`Events for escrow ${id}:`);
      for (const e of events) {
        console.log(`  ${e.createdAt} | ${e.eventType}`);
      }

      if (flags.json) print.json(events);
      break;
    }

    default:
      print.error(`Unknown escrow command: ${subcommand}`);
      print.info('Available: create, get, list, release, refund, dispute, events');
      process.exit(1);
  }
}

/**
 * Main entry point
 */
async function main() {
  const { command, subcommand, args, flags } = parseArgs(process.argv.slice(2));
  
  if (flags.version || flags.v) {
    console.log(VERSION);
    return;
  }
  
  if (flags.help || flags.h || !command) {
    showHelp();
    return;
  }
  
  try {
    switch (command) {
      case 'config':
        await handleConfig(subcommand, args);
        break;
        
      case 'payment':
        await handlePayment(subcommand, args, flags);
        break;
        
      case 'business':
        await handleBusiness(subcommand, args, flags);
        break;
        
      case 'rates':
        await handleRates(subcommand, args, flags);
        break;
        
      case 'wallet':
        await handleWallet(subcommand, args, flags);
        break;
        
      case 'swap':
        await handleSwap(subcommand, args, flags);
        break;
        
      case 'escrow':
        await handleEscrow(subcommand, args, flags);
        break;

      case 'webhook':
        await handleWebhook(subcommand, args, flags);
        break;
        
      default:
        print.error(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
    }
  } catch (error) {
    print.error(error.message);
    if (flags.debug) {
      console.error(error);
    }
    process.exit(1);
  }
}

main();
