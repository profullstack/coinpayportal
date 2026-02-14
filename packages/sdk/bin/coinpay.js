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

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
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

  ${colors.bright}payout${colors.reset}
    create                Create a payout to your Stripe account
    list                  List payouts
    get <id>              Get payout details

  ${colors.bright}card${colors.reset}
    create                Create a card payment via Stripe
    get <id>              Get card payment status
    list                  List card payments
    connect onboard <id>  Create Stripe onboarding link
    connect status <id>   Check Stripe account status
    escrow release <id>   Release card escrow funds
    escrow refund <id>    Refund card escrow

  ${colors.bright}escrow${colors.reset}
    create                Create a new escrow
    get <id>              Get escrow status
    list                  List escrows
    release <id>          Release funds to beneficiary
    refund <id>           Refund funds to depositor
    dispute <id>          Open a dispute
    events <id>           Get escrow audit log
    auth <id>             Authenticate with escrow token

  ${colors.bright}reputation${colors.reset}
    submit                Submit a task receipt
    query <agent-did>     Query agent reputation
    credential <id>       Get credential details
    credentials [did]     List all credentials for a DID
    receipts [did]        List all task receipts for a DID
    badge [did]           Get embeddable reputation badge URL
    verify <id>           Verify a credential
    revocations           List revoked credentials
    issuer register       Register platform issuer (--name, --domain)
    issuer list           List your platform issuers
    issuer rotate         Rotate issuer API key (--id)
    issuer deactivate     Deactivate an issuer (--id)

  ${colors.bright}webhook${colors.reset}
    logs <business-id>    Get webhook logs
    test <business-id>    Send test webhook

${colors.cyan}Wallet Options:${colors.reset}
  --words <12|24>         Number of mnemonic words (default: 12)
  --chains <BTC,ETH,...>  Chains to derive (default: BTC,ETH,SOL,POL,BCH)
  --chain <chain>         Single chain for operations
  --to <address>          Recipient address
  --amount <amount>       Amount to send (crypto)
  --amount-fiat <amount>  Amount to send (fiat, requires --fiat)
  --fiat <currency>       Fiat currency (USD, EUR, GBP, CAD, AUD, JPY, CHF, CNY, INR, BRL)
  --password <pass>       Wallet encryption password
  --wallet-file <path>    Custom wallet file (default: ~/.coinpay-wallet.gpg)
  --no-save               Don't save wallet locally after create/import

${colors.cyan}Escrow Options:${colors.reset}
  --chain <chain>         Blockchain (BTC, ETH, SOL, POL, BCH, etc.)
  --amount <amount>       Crypto amount to escrow
  --amount-fiat <amount>  Fiat amount to escrow (alternative to --amount)
  --fiat <currency>       Fiat currency (required with --amount-fiat)
  --depositor <address>   Depositor wallet address
  --beneficiary <address> Beneficiary wallet address
  --token <token>         Release or beneficiary token (for auth/release/refund)

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
  
  # Send transaction with fiat amount
  coinpay wallet send --chain SOL --to abc123... --amount-fiat 10 --fiat USD

  # Create escrow with crypto amount
  coinpay escrow create --chain SOL --amount 0.5 --depositor abc... --beneficiary def...
  
  # Create escrow with fiat amount
  coinpay escrow create --chain SOL --amount-fiat 50 --fiat USD --depositor abc... --beneficiary def...
  
  # Authenticate with escrow token
  coinpay escrow auth escr_123 --token rel_abc456

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
        let walletId = null;
        try {
          const wallet = await WalletClient.fromSeed(mnemonic, {
            chains,
            baseUrl,
          });
          walletId = wallet.getWalletId();
        } catch (serverErr) {
          print.warn(`Server registration failed (wallet saved locally only): ${serverErr.message || serverErr}`);
        }
        
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
        
        print.success(walletId ? `Wallet imported (ID: ${walletId})` : 'Wallet imported (local only)');
      } catch (error) {
        print.error(error.message || String(error));
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
        print.info(`Wallet ID: ${config.walletId || '(local only)'}`);
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
      const amountFiat = flags['amount-fiat'] ? parseFloat(flags['amount-fiat']) : undefined;
      const fiatCurrency = flags.fiat;
      const priority = flags.priority || 'medium';
      
      if (!chain || !to || (!amount && !amountFiat)) {
        print.error('Required: --chain, --to, --amount (or --amount-fiat --fiat)');
        print.info('Usage: coinpay wallet send --chain ETH --to 0x123... --amount 0.1');
        print.info('   or: coinpay wallet send --chain SOL --to abc123... --amount-fiat 10 --fiat USD');
        return;
      }

      if (amountFiat && !fiatCurrency) {
        print.error('--fiat is required when using --amount-fiat');
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
        let finalAmount = amount;

        // Convert fiat to crypto if needed
        if (amountFiat && fiatCurrency) {
          print.info(`Converting ${fiatCurrency} ${amountFiat.toFixed(2)} to ${chain}...`);
          const apiClient = createClient();
          const conversion = await apiClient.convertFiatToCrypto(amountFiat, fiatCurrency, chain);
          finalAmount = conversion.cryptoAmount.toString();
          print.success(`Converting ${fiatCurrency} ${amountFiat.toFixed(2)} → ${conversion.cryptoAmount.toFixed(6)} ${chain} (rate: 1 ${chain} = ${fiatCurrency} ${conversion.rate.toFixed(2)})`);
        }

        const mnemonic = await getDecryptedMnemonic(flags);
        const wallet = await WalletClient.fromSeed(mnemonic, { baseUrl });
        
        print.info(`Sending ${finalAmount} ${chain} to ${to}...`);
        
        const result = await wallet.send({ chain, to, amount: finalAmount, priority });
        
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
      const amount = flags.amount ? parseFloat(flags.amount) : undefined;
      const amountFiat = flags['amount-fiat'] ? parseFloat(flags['amount-fiat']) : undefined;
      const fiatCurrency = flags.fiat;
      const depositor = flags.depositor || flags['depositor-address'];
      const beneficiary = flags.beneficiary || flags['beneficiary-address'];

      if (!chain || (!amount && !amountFiat) || !depositor || !beneficiary) {
        print.error('Required: --chain, --amount (or --amount-fiat --fiat), --depositor, --beneficiary');
        process.exit(1);
      }

      if (amountFiat && !fiatCurrency) {
        print.error('--fiat is required when using --amount-fiat');
        process.exit(1);
      }

      // Show conversion if using fiat
      let finalAmount = amount;
      if (amountFiat && fiatCurrency) {
        print.info(`Converting ${fiatCurrency} ${amountFiat.toFixed(2)} to ${chain}...`);
        const conversion = await client.convertFiatToCrypto(amountFiat, fiatCurrency, chain);
        finalAmount = conversion.cryptoAmount;
        print.success(`Converting ${fiatCurrency} ${amountFiat.toFixed(2)} → ${finalAmount.toFixed(6)} ${chain} (rate: 1 ${chain} = ${fiatCurrency} ${conversion.rate.toFixed(2)})`);
      }

      print.info(`Creating escrow: ${finalAmount} ${chain}`);

      const escrow = await client.createEscrow({
        chain,
        amount: finalAmount,
        depositorAddress: depositor,
        beneficiaryAddress: beneficiary,
        metadata: flags.metadata ? JSON.parse(flags.metadata) : undefined,
        expiresInHours: flags['expires-in'] ? parseFloat(flags['expires-in']) : undefined,
      });

      print.success(`Escrow created: ${escrow.id}`);
      print.info(`  Deposit to: ${escrow.escrowAddress}`);
      print.info(`  Status: ${escrow.status}`);
      print.warn(`  Release Token: ${escrow.releaseToken}`);
      print.warn(`  Beneficiary Token: ${escrow.beneficiaryToken}`);
      print.warn('  ⚠️  Save these tokens!');
      print.info(`  Manage: coinpay escrow auth ${escrow.id} --token <token>`);

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

    case 'auth': {
      const id = args[0];
      const token = flags.token;
      if (!id || !token) { 
        print.error('Required: <id> --token <token>'); 
        process.exit(1); 
      }

      const auth = await client.authenticateEscrow(id, token);
      print.success(`Authenticated as: ${auth.role}`);
      print.info(`Escrow Details:`);
      print.info(`  ID: ${auth.escrow.id}`);
      print.info(`  Status: ${auth.escrow.status}`);
      print.info(`  Chain: ${auth.escrow.chain}`);
      print.info(`  Amount: ${auth.escrow.amount}`);
      print.info(`  Depositor: ${auth.escrow.depositorAddress}`);
      print.info(`  Beneficiary: ${auth.escrow.beneficiaryAddress}`);
      
      // Show available actions based on role and status
      if (auth.escrow.status === 'funded') {
        if (auth.role === 'depositor') {
          print.info(`Available actions: release, refund, dispute`);
        } else if (auth.role === 'beneficiary') {
          print.info(`Available actions: dispute`);
        }
      } else if (auth.escrow.status === 'pending') {
        print.info(`Waiting for deposit to: ${auth.escrow.escrowAddress}`);
      }

      if (flags.json) print.json(auth);
      break;
    }

    case 'series': {
      const seriesCmd = args[0];
      const seriesId = args[1];

      switch (seriesCmd) {
        case 'create': {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          const ask = (q) => new Promise((r) => rl.question(q, r));

          try {
            const businessId = flags['business-id'] || await ask('Business ID: ');
            const paymentMethod = flags['payment-method'] || await ask('Payment method (crypto/card): ');
            const amount = flags.amount || await ask('Amount (cents for card, satoshis-equiv for crypto): ');
            const currency = flags.currency || await ask('Currency [USD]: ') || 'USD';
            const interval = flags.interval || await ask('Interval (weekly/biweekly/monthly): ');
            const maxPeriods = flags['max-periods'] || await ask('Max periods (blank=infinite): ') || undefined;
            const customerEmail = flags.email || await ask('Customer email (optional): ') || undefined;
            const description = flags.description || await ask('Description (optional): ') || undefined;

            const params = {
              business_id: businessId,
              payment_method: paymentMethod,
              amount: parseInt(amount),
              currency,
              interval,
              max_periods: maxPeriods ? parseInt(maxPeriods) : undefined,
              customer_email: customerEmail,
              description,
            };

            if (paymentMethod === 'crypto') {
              params.coin = flags.coin || await ask('Coin (BTC/ETH/SOL/etc): ');
              params.beneficiary_address = flags.beneficiary || await ask('Beneficiary address: ');
              params.depositor_address = flags.depositor || await ask('Depositor address: ');
            } else {
              params.stripe_account_id = flags['stripe-account'] || await ask('Stripe account ID: ');
            }

            rl.close();

            const series = await client.createEscrowSeries(params);
            print.success(`Escrow series created: ${series.id}`);
            print.info(`  Status: ${series.status}`);
            print.info(`  Interval: ${series.interval}`);
            print.info(`  Amount: ${series.amount} ${series.currency}`);
            if (flags.json) print.json(series);
          } catch (e) {
            rl.close();
            throw e;
          }
          break;
        }

        case 'list': {
          const businessId = flags['business-id'];
          if (!businessId) { print.error('--business-id required'); process.exit(1); }
          const result = await client.listEscrowSeries(businessId, flags.status);
          print.info(`Series (${result.series.length}):`);
          for (const s of result.series) {
            console.log(`  ${s.id} | ${s.status} | ${s.payment_method} | ${s.interval} | ${s.amount} ${s.currency}`);
          }
          if (flags.json) print.json(result);
          break;
        }

        case 'get': {
          if (!seriesId) { print.error('Series ID required'); process.exit(1); }
          const result = await client.getEscrowSeries(seriesId);
          print.success(`Series ${result.series.id}`);
          print.info(`  Status: ${result.series.status}`);
          print.info(`  Method: ${result.series.payment_method}`);
          print.info(`  Amount: ${result.series.amount} ${result.series.currency}`);
          print.info(`  Interval: ${result.series.interval}`);
          print.info(`  Periods: ${result.series.periods_completed}${result.series.max_periods ? '/' + result.series.max_periods : ''}`);
          print.info(`  Next charge: ${result.series.next_charge_at}`);
          print.info(`  Crypto escrows: ${result.escrows.crypto.length}`);
          print.info(`  Stripe escrows: ${result.escrows.stripe.length}`);
          if (flags.json) print.json(result);
          break;
        }

        case 'pause': {
          if (!seriesId) { print.error('Series ID required'); process.exit(1); }
          await client.updateEscrowSeries(seriesId, { status: 'paused' });
          print.success(`Series ${seriesId} paused`);
          break;
        }

        case 'resume': {
          if (!seriesId) { print.error('Series ID required'); process.exit(1); }
          await client.updateEscrowSeries(seriesId, { status: 'active' });
          print.success(`Series ${seriesId} resumed`);
          break;
        }

        case 'cancel': {
          if (!seriesId) { print.error('Series ID required'); process.exit(1); }
          await client.cancelEscrowSeries(seriesId);
          print.success(`Series ${seriesId} cancelled`);
          break;
        }

        default:
          print.error(`Unknown series command: ${seriesCmd}`);
          print.info('Available: create, list, get, pause, resume, cancel');
          process.exit(1);
      }
      break;
    }

    default:
      print.error(`Unknown escrow command: ${subcommand}`);
      print.info('Available: create, get, list, release, refund, dispute, events, auth, series');
      process.exit(1);
  }
}

/**
 * Reputation commands
 */
async function handleReputation(subcommand, args, flags) {
  switch (subcommand) {
    case 'submit': {
      const receiptArg = flags.receipt;
      if (!receiptArg) {
        print.error('Required: --receipt <json-file-or-inline-json>');
        print.info('Example: coinpay reputation submit --receipt receipt.json');
        print.info('Example: coinpay reputation submit --receipt \'{"receipt_id":"..."}\'');
        return;
      }

      let receipt;
      try {
        if (existsSync(receiptArg)) {
          receipt = JSON.parse(readFileSync(receiptArg, 'utf-8'));
        } else {
          receipt = JSON.parse(receiptArg);
        }
      } catch {
        print.error('Could not parse receipt JSON. Provide a valid JSON file path or inline JSON.');
        return;
      }

      const client = createClient();
      const { submitReceipt } = await import('../src/reputation.js');
      const result = await submitReceipt(client, receipt);

      if (result.success) {
        print.success('Receipt submitted');
      } else {
        print.error(result.error || 'Submission failed');
      }

      if (flags.json) print.json(result);
      else if (result.receipt) print.json(result.receipt);
      break;
    }

    case 'query': {
      const agentDid = args[0];
      if (!agentDid) {
        print.error('Agent DID required');
        print.info('Usage: coinpay reputation query <agent-did> [--window 30d|90d|all]');
        return;
      }

      const client = createClient();
      const { getReputation } = await import('../src/reputation.js');
      const result = await getReputation(client, agentDid);

      if (flags.json) {
        print.json(result);
      } else if (result.success && result.reputation) {
        const rep = result.reputation;
        const windowKey = flags.window === '90d' ? 'last_90_days'
          : flags.window === 'all' ? 'all_time'
          : 'last_30_days';
        const label = flags.window || '30d';
        const w = rep.windows[windowKey];

        print.info(`Reputation for ${rep.agent_did} (${label}):`);
        console.log(`  Tasks: ${w.task_count}`);
        console.log(`  Accepted: ${w.accepted_count} (${(w.accepted_rate * 100).toFixed(1)}%)`);
        console.log(`  Disputed: ${w.disputed_count} (${(w.dispute_rate * 100).toFixed(1)}%)`);
        console.log(`  Volume: ${w.total_volume.toFixed(2)}`);
        console.log(`  Avg Value: ${w.avg_task_value.toFixed(2)}`);
        console.log(`  Unique Buyers: ${w.unique_buyers}`);

        if (rep.anti_gaming.flagged) {
          print.warn(`Anti-gaming flags: ${rep.anti_gaming.flags.join(', ')}`);
        }
      } else {
        print.json(result);
      }
      break;
    }

    case 'credential': {
      const credentialId = args[0];
      if (!credentialId) {
        print.error('Credential ID required');
        print.info('Usage: coinpay reputation credential <credential-id>');
        return;
      }

      const client = createClient();
      const { getCredential } = await import('../src/reputation.js');
      const result = await getCredential(client, credentialId);

      if (result.success && result.credential) {
        print.success(`Credential ${result.credential.id}`);
        console.log(`  Agent: ${result.credential.agent_did}`);
        console.log(`  Type: ${result.credential.credential_type}`);
        console.log(`  Issued: ${result.credential.issued_at}`);
        console.log(`  Revoked: ${result.credential.revoked ? 'YES' : 'no'}`);
      }

      if (flags.json) print.json(result);
      break;
    }

    case 'verify': {
      const credentialId = args[0];
      if (!credentialId) {
        print.error('Credential ID required');
        print.info('Usage: coinpay reputation verify <credential-id>');
        return;
      }

      const client = createClient();
      const { verifyCredential } = await import('../src/reputation.js');
      const result = await verifyCredential(client, { credential_id: credentialId });

      if (result.valid) {
        print.success('Credential is valid');
      } else {
        print.error(`Credential invalid: ${result.reason}`);
      }

      if (flags.json) print.json(result);
      break;
    }

    case 'revocations': {
      const client = createClient();
      const { getRevocationList } = await import('../src/reputation.js');
      const result = await getRevocationList(client);

      if (flags.json) {
        print.json(result);
      } else {
        const revocations = result.revocations || [];
        print.info(`Revoked credentials: ${revocations.length}`);
        for (const r of revocations) {
          console.log(`  ${r.credential_id} — ${r.reason || 'no reason'} (${r.revoked_at})`);
        }
      }
      break;
    }

    case 'did': {
      const didSubcommand = args[0];
      const client = createClient();

      if (didSubcommand === 'claim') {
        const { claimDid } = await import('../src/reputation.js');
        const result = await claimDid(client);

        if (result.did) {
          print.success(`DID claimed: ${result.did}`);
          console.log(`  Public Key: ${result.public_key}`);
          console.log(`  Verified: ${result.verified}`);
        } else {
          print.error(result.error || 'Failed to claim DID');
        }

        if (flags.json) print.json(result);
      } else if (didSubcommand === 'link') {
        const didValue = flags.did;
        const publicKey = flags['public-key'];
        const signature = flags.signature;

        if (!didValue || !publicKey || !signature) {
          print.error('Required: --did <did> --public-key <key> --signature <sig>');
          print.info('Usage: coinpay reputation did link --did <did> --public-key <key> --signature <sig>');
          break;
        }

        const { linkDid } = await import('../src/reputation.js');
        const result = await linkDid(client, { did: didValue, publicKey, signature });

        if (result.did) {
          print.success(`DID linked: ${result.did}`);
          console.log(`  Verified: ${result.verified}`);
        } else {
          print.error(result.error || 'Failed to link DID');
        }

        if (flags.json) print.json(result);
      } else {
        // Default: show current DID
        const { getMyDid } = await import('../src/reputation.js');
        const result = await getMyDid(client);

        if (result.did) {
          print.success(`Your DID: ${result.did}`);
          console.log(`  Public Key: ${result.public_key}`);
          console.log(`  Verified: ${result.verified}`);
          console.log(`  Created: ${result.created_at}`);
        } else {
          print.info('No DID found. Run: coinpay reputation did claim');
        }

        if (flags.json) print.json(result);
      }
      break;
    }

    case 'credentials': {
      const did = args[0];
      if (!did) {
        // Try to get own DID
        const { getMyDid } = await import('../src/reputation.js');
        const myDid = await getMyDid(client);
        if (!myDid?.did) {
          print.error('Usage: coinpay reputation credentials <did>');
          print.info('Or claim a DID first: coinpay reputation did claim');
          process.exit(1);
        }
        const { getCredentials } = await import('../src/reputation.js');
        const result = await getCredentials(client, myDid.did);
        if (result.credentials && result.credentials.length > 0) {
          print.success(`${result.credentials.length} credential(s) for ${myDid.did}:`);
          for (const cred of result.credentials) {
            print.info(`  ${cred.id} | ${cred.credential_type} | ${cred.revoked ? '❌ Revoked' : '✅ Active'} | ${new Date(cred.issued_at).toLocaleDateString()}`);
          }
        } else {
          print.info('No credentials found. Complete escrow transactions to earn credentials.');
        }
        if (flags.json) print.json(result);
      } else {
        const { getCredentials } = await import('../src/reputation.js');
        const result = await getCredentials(client, did);
        if (result.credentials && result.credentials.length > 0) {
          print.success(`${result.credentials.length} credential(s) for ${did}:`);
          for (const cred of result.credentials) {
            print.info(`  ${cred.id} | ${cred.credential_type} | ${cred.revoked ? '❌ Revoked' : '✅ Active'} | ${new Date(cred.issued_at).toLocaleDateString()}`);
          }
        } else {
          print.info('No credentials found for this DID.');
        }
        if (flags.json) print.json(result);
      }
      break;
    }

    case 'receipts': {
      const did = args[0];
      if (!did) {
        const { getMyDid } = await import('../src/reputation.js');
        const myDid = await getMyDid(client);
        if (!myDid?.did) {
          print.error('Usage: coinpay reputation receipts <did>');
          print.info('Or claim a DID first: coinpay reputation did claim');
          process.exit(1);
        }
        const { getReceipts } = await import('../src/reputation.js');
        const result = await getReceipts(client, myDid.did);
        if (result.receipts && result.receipts.length > 0) {
          print.success(`${result.receipts.length} receipt(s) for ${myDid.did}:`);
          for (const r of result.receipts) {
            print.info(`  ${r.receipt_id} | ${r.outcome} | $${r.amount || 0} ${r.currency || ''} | ${new Date(r.created_at).toLocaleDateString()}`);
          }
        } else {
          print.info('No receipts found. Complete escrow transactions to generate receipts.');
        }
        if (flags.json) print.json(result);
      } else {
        const { getReceipts } = await import('../src/reputation.js');
        const result = await getReceipts(client, did);
        if (result.receipts && result.receipts.length > 0) {
          print.success(`${result.receipts.length} receipt(s) for ${did}:`);
          for (const r of result.receipts) {
            print.info(`  ${r.receipt_id} | ${r.outcome} | $${r.amount || 0} ${r.currency || ''} | ${new Date(r.created_at).toLocaleDateString()}`);
          }
        } else {
          print.info('No receipts found for this DID.');
        }
        if (flags.json) print.json(result);
      }
      break;
    }

    case 'issuer': {
      const issuerSubcommand = args[0];
      const client = createClient();

      switch (issuerSubcommand) {
        case 'register': {
          const name = flags.name;
          const domain = flags.domain;
          if (!name || !domain) {
            print.error('Required: --name <name> --domain <domain>');
            return;
          }
          const { registerPlatformIssuer } = await import('../src/reputation.js');
          const result = await registerPlatformIssuer(client, { name, domain, did: flags.did });

          if (result.success) {
            print.success(`Issuer registered: ${result.issuer.name}`);
            print.info(`  ID: ${result.issuer.id}`);
            print.info(`  DID: ${result.issuer.did}`);
            print.info(`  Domain: ${result.issuer.domain}`);
            console.log(`\n  ${colors.bright}${colors.yellow}⚠️  API Key (shown only once):${colors.reset}`);
            console.log(`  ${colors.yellow}${result.api_key}${colors.reset}\n`);
          } else {
            print.error(result.error || 'Registration failed');
          }
          if (flags.json) print.json(result);
          break;
        }

        case 'list': {
          const { listPlatformIssuers } = await import('../src/reputation.js');
          const result = await listPlatformIssuers(client);

          if (result.success) {
            print.info(`Platform issuers (${result.issuers.length}):`);
            for (const iss of result.issuers) {
              const status = iss.active ? `${colors.green}active${colors.reset}` : `${colors.red}inactive${colors.reset}`;
              console.log(`  ${iss.id} | ${iss.name} | ${iss.domain} | ${status} | key: ${iss.api_key || 'none'}`);
            }
          } else {
            print.error(result.error || 'Failed to list issuers');
          }
          if (flags.json) print.json(result);
          break;
        }

        case 'rotate': {
          const id = flags.id || args[1];
          if (!id) {
            print.error('Required: --id <issuer-id>');
            return;
          }
          const { rotatePlatformApiKey } = await import('../src/reputation.js');
          const result = await rotatePlatformApiKey(client, id);

          if (result.success) {
            print.success(`API key rotated for: ${result.issuer.name}`);
            console.log(`\n  ${colors.bright}${colors.yellow}⚠️  New API Key (shown only once):${colors.reset}`);
            console.log(`  ${colors.yellow}${result.api_key}${colors.reset}\n`);
          } else {
            print.error(result.error || 'Rotation failed');
          }
          if (flags.json) print.json(result);
          break;
        }

        case 'deactivate': {
          const id = flags.id || args[1];
          if (!id) {
            print.error('Required: --id <issuer-id>');
            return;
          }
          const { deactivatePlatformIssuer } = await import('../src/reputation.js');
          const result = await deactivatePlatformIssuer(client, id);

          if (result.success) {
            print.success(`Issuer deactivated: ${result.issuer.name}`);
          } else {
            print.error(result.error || 'Deactivation failed');
          }
          if (flags.json) print.json(result);
          break;
        }

        default:
          print.error(`Unknown issuer command: ${issuerSubcommand}`);
          print.info('Available: register, list, rotate, deactivate');
          process.exit(1);
      }
      break;
    }

    case 'badge': {
      const did = args[0];
      if (!did) {
        const { getMyDid } = await import('../src/reputation.js');
        const myDid = await getMyDid(client);
        if (!myDid?.did) {
          print.error('Usage: coinpay reputation badge <did>');
          process.exit(1);
        }
        const { getBadgeUrl } = await import('../src/reputation.js');
        const url = getBadgeUrl(client.baseUrl || 'https://coinpayportal.com', myDid.did);
        print.success('Badge URL:');
        print.info(`  ${url}`);
        print.info('');
        print.info('Markdown embed:');
        print.info(`  ![Reputation](${url})`);
      } else {
        const { getBadgeUrl } = await import('../src/reputation.js');
        const url = getBadgeUrl(client.baseUrl || 'https://coinpayportal.com', did);
        print.success('Badge URL:');
        print.info(`  ${url}`);
        print.info('');
        print.info('Markdown embed:');
        print.info(`  ![Reputation](${url})`);
      }
      break;
    }

    default:
      print.error(`Unknown reputation command: ${subcommand}`);
      print.info('Available: submit, query, credential, credentials, receipts, badge, verify, revocations, did');
      process.exit(1);
  }
}

/**
 * Payout commands
 */
async function handlePayout(subcommand, args, flags) {
  const client = createClient();

  switch (subcommand) {
    case 'create': {
      const amount = parseInt(flags.amount);
      if (!amount || amount <= 0) {
        print.error('--amount is required (in cents, e.g., 5000 for $50.00)');
        print.info('Example: coinpay payout create --amount 5000 --description "Weekly payout"');
        process.exit(1);
      }

      const result = await client.createPayout({
        amount,
        currency: flags.currency || 'usd',
        description: flags.description,
        metadata: flags.metadata ? JSON.parse(flags.metadata) : undefined,
      });

      print.success('Payout created');
      print.json(result);
      break;
    }

    case 'list': {
      const result = await client.listPayouts({
        status: flags.status,
        dateFrom: flags['date-from'] || flags.dateFrom,
        dateTo: flags['date-to'] || flags.dateTo,
        limit: flags.limit ? parseInt(flags.limit) : undefined,
        offset: flags.offset ? parseInt(flags.offset) : undefined,
      });

      if (result.payouts && result.payouts.length > 0) {
        console.log(`\n${colors.bright}Payouts${colors.reset} (${result.pagination?.total || result.payouts.length} total)\n`);
        for (const p of result.payouts) {
          const statusColor = p.status === 'paid' ? colors.green : p.status === 'failed' ? colors.red : colors.yellow;
          console.log(`  ${p.id}  ${statusColor}${p.status}${colors.reset}  $${p.amount_usd || ((p.amount_cents || 0) / 100).toFixed(2)}  ${new Date(p.created_at).toLocaleDateString()}`);
        }
        console.log();
      } else {
        print.info('No payouts found');
      }
      break;
    }

    case 'get': {
      const id = args[0];
      if (!id) {
        print.error('Usage: coinpay payout get <id>');
        process.exit(1);
      }

      const result = await client.getPayout(id);
      print.json(result);
      break;
    }

    default:
      print.error(`Unknown payout command: ${subcommand}`);
      print.info('Available: create, list, get');
      process.exit(1);
  }
}

/**
 * Card (Stripe) commands
 */
async function handleCard(subcommand, args, flags) {
  const client = createClient();

  switch (subcommand) {
    case 'create': {
      const { 'business-id': businessId, amount, currency = 'usd', description } = flags;
      const escrowMode = flags['escrow'] === true || flags['escrow-mode'] === true;

      if (!businessId || !amount) {
        print.error('Required: --business-id, --amount (in cents)');
        print.info('Example: coinpay card create --business-id biz_123 --amount 5000 --description "Order #123"');
        return;
      }

      const payment = await client.createCardPayment({
        businessId,
        amount: parseInt(amount, 10),
        currency,
        description,
        metadata: flags.metadata ? JSON.parse(flags.metadata) : undefined,
        successUrl: flags['success-url'],
        cancelUrl: flags['cancel-url'],
        escrowMode,
      });

      print.success('Card payment created');
      if (payment.checkout_url) {
        print.info(`Checkout URL: ${payment.checkout_url}`);
      }
      if (payment.checkout_session_id) {
        print.info(`Session ID: ${payment.checkout_session_id}`);
      }
      if (flags.json) print.json(payment);
      break;
    }

    case 'get': {
      const id = args[0];
      if (!id) {
        print.error('Payment ID required');
        print.info('Usage: coinpay card get <id>');
        return;
      }

      // Card payments use Stripe account status endpoint for now
      // or we can query the stripe_transactions table via the API
      const result = await client.request(`/stripe/payments/${id}`);
      print.json(result);
      break;
    }

    case 'list': {
      const { 'business-id': businessId, status, limit } = flags;

      if (!businessId) {
        print.error('Required: --business-id');
        return;
      }

      const params = new URLSearchParams({ businessId });
      if (status) params.append('status', status);
      if (limit) params.append('limit', limit);

      const result = await client.request(`/stripe/payments?${params.toString()}`);
      print.json(result);
      break;
    }

    case 'connect': {
      const connectSubcommand = args[0];
      const merchantId = args[1];

      if (!connectSubcommand) {
        print.error('Usage: coinpay card connect <onboard|status> <merchantId>');
        return;
      }

      switch (connectSubcommand) {
        case 'onboard': {
          if (!merchantId) {
            print.error('Merchant ID required');
            print.info('Usage: coinpay card connect onboard <merchantId>');
            return;
          }

          const result = await client.createStripeOnboardingLink(merchantId, {
            email: flags.email,
            country: flags.country,
          });

          print.success('Onboarding link created');
          if (result.onboarding_url) {
            print.info(`Onboarding URL: ${result.onboarding_url}`);
          }
          if (result.stripe_account_id) {
            print.info(`Stripe Account: ${result.stripe_account_id}`);
          }
          if (flags.json) print.json(result);
          break;
        }

        case 'status': {
          if (!merchantId) {
            print.error('Merchant ID required');
            print.info('Usage: coinpay card connect status <merchantId>');
            return;
          }

          const result = await client.getStripeAccountStatus(merchantId);

          print.info(`Stripe Account Status for ${merchantId}:`);
          if (result.onboarding_complete) {
            print.success('Onboarding complete — can accept card payments');
          } else {
            print.warn('Onboarding incomplete');
          }
          print.info(`  Charges enabled: ${result.charges_enabled}`);
          print.info(`  Payouts enabled: ${result.payouts_enabled}`);
          print.info(`  Details submitted: ${result.details_submitted}`);
          if (result.requirements_due?.length > 0) {
            print.info(`  Requirements due: ${result.requirements_due.join(', ')}`);
          }
          if (flags.json) print.json(result);
          break;
        }

        default:
          print.error(`Unknown connect command: ${connectSubcommand}`);
          print.info('Available: onboard, status');
          process.exit(1);
      }
      break;
    }

    case 'escrow': {
      const escrowSubcommand = args[0];
      const escrowId = args[1];

      if (!escrowSubcommand) {
        print.error('Usage: coinpay card escrow <release|refund> <id>');
        return;
      }

      switch (escrowSubcommand) {
        case 'release': {
          if (!escrowId) {
            print.error('Escrow ID required');
            print.info('Usage: coinpay card escrow release <id> [--reason "..."]');
            return;
          }

          const result = await client.releaseCardEscrow(escrowId, flags.reason);

          print.success(`Card escrow ${escrowId} released`);
          if (result.transfer_id) {
            print.info(`Transfer ID: ${result.transfer_id}`);
          }
          if (result.amount_transferred) {
            print.info(`Amount: $${(result.amount_transferred / 100).toFixed(2)}`);
          }
          if (flags.json) print.json(result);
          break;
        }

        case 'refund': {
          if (!escrowId) {
            print.error('Escrow ID required');
            print.info('Usage: coinpay card escrow refund <id> [--reason "..."] [--amount <cents>]');
            return;
          }

          const result = await client.refundCardPayment(escrowId, {
            amount: flags.amount ? parseInt(flags.amount, 10) : undefined,
            reason: flags.reason,
          });

          print.success(`Card escrow ${escrowId} refunded`);
          if (result.refund_id) {
            print.info(`Refund ID: ${result.refund_id}`);
          }
          if (result.amount_refunded) {
            print.info(`Amount refunded: $${(result.amount_refunded / 100).toFixed(2)}`);
          }
          if (flags.json) print.json(result);
          break;
        }

        default:
          print.error(`Unknown card escrow command: ${escrowSubcommand}`);
          print.info('Available: release, refund');
          process.exit(1);
      }
      break;
    }

    default:
      print.error(`Unknown card command: ${subcommand}`);
      print.info('Available: create, get, list, connect, escrow');
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

      case 'payout':
        await handlePayout(subcommand, args, flags);
        break;

      case 'card':
        await handleCard(subcommand, args, flags);
        break;

      case 'reputation':
        await handleReputation(subcommand, args, flags);
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

main().then(() => process.exit(0));
