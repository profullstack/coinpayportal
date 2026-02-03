#!/usr/bin/env node

/**
 * CoinPay CLI
 * Command-line interface for CoinPay cryptocurrency payments
 */

import { CoinPayClient } from '../src/client.js';
import { PaymentStatus, Blockchain, FiatCurrency } from '../src/payments.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const VERSION = '0.3.2';
const CONFIG_FILE = join(homedir(), '.coinpay.json');

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
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
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
      const [key, value] = arg.slice(2).split('=');
      result.flags[key] = value ?? true;
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

  ${colors.bright}webhook${colors.reset}
    logs <business-id>    Get webhook logs
    test <business-id>    Send test webhook

${colors.cyan}Options:${colors.reset}
  --help, -h              Show help
  --version, -v           Show version
  --json                  Output as JSON
  --business-id <id>      Business ID for operations
  --amount <amount>       Payment amount in fiat currency
  --currency <code>       Fiat currency (USD, EUR, etc.) - default: USD
  --blockchain <code>     Blockchain (BTC, ETH, SOL, POL, BCH, USDC_ETH, USDC_POL, USDC_SOL)
  --description <text>    Payment description

${colors.cyan}Examples:${colors.reset}
  # Configure your API key (get it from your CoinPay dashboard)
  coinpay config set-key cp_live_xxxxx

  # Create a $100 Bitcoin payment
  coinpay payment create --business-id biz_123 --amount 100 --blockchain BTC

  # Create a $50 Ethereum payment with description
  coinpay payment create --business-id biz_123 --amount 50 --blockchain ETH --description "Order #12345"

  # Create a USDC payment on Polygon
  coinpay payment create --business-id biz_123 --amount 25 --blockchain USDC_POL

  # Get payment status
  coinpay payment get pay_abc123

  # Get exchange rates
  coinpay rates get BTC

  # List your businesses
  coinpay business list

${colors.cyan}Environment Variables:${colors.reset}
  COINPAY_API_KEY         API key (overrides config)
  COINPAY_BASE_URL        Custom API URL
`);
}

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
      if (!flags.json) {
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
      const { format } = flags;
      
      if (!paymentId) {
        print.error('Payment ID required');
        return;
      }
      
      const qr = await client.getPaymentQR(paymentId, format);
      print.json(qr);
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
 * Main entry point
 */
async function main() {
  const { command, subcommand, args, flags } = parseArgs(process.argv.slice(2));
  
  // Handle global flags
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