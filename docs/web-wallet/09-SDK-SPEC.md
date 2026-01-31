# CoinPayPortal Wallet Mode - SDK Specification

## 1. Overview

The Wallet SDK (`@coinpayportal/wallet-sdk`) provides a TypeScript/JavaScript library for bots and applications to interact with CoinPayPortal Wallet Mode.

### Design Goals

1. **Simple API**: Easy to use for common operations
2. **Type-Safe**: Full TypeScript support
3. **Secure**: Handles signing locally, never exposes keys
4. **Lightweight**: Minimal dependencies
5. **Cross-Platform**: Works in Node.js and browsers

---

## 2. Installation

```bash
# npm
npm install @coinpayportal/wallet-sdk

# yarn
yarn add @coinpayportal/wallet-sdk

# pnpm
pnpm add @coinpayportal/wallet-sdk
```

---

## 3. Quick Start

```typescript
import { Wallet } from '@coinpayportal/wallet-sdk';

// Create wallet from seed
const wallet = Wallet.fromSeed('your twelve word seed phrase here ...');

// Or create a new wallet
const newWallet = await Wallet.create();
console.log('Backup your seed:', newWallet.getSeed());

// Check balance
const balance = await wallet.getBalance('ETH');
console.log(`ETH Balance: ${balance.amount}`);

// Send transaction
const tx = await wallet.send({
  chain: 'ETH',
  to: '0xRecipient...',
  amount: '0.1'
});
console.log(`Transaction: ${tx.hash}`);
```

---

## 4. API Reference

### 4.1 Wallet Class

#### Constructor Methods

```typescript
class Wallet {
  /**
   * Create a new wallet with a fresh seed
   */
  static async create(options?: CreateOptions): Promise<Wallet>;
  
  /**
   * Import wallet from existing seed phrase
   */
  static fromSeed(seed: string, options?: ImportOptions): Wallet;
  
  /**
   * Import wallet from wallet_id (read-only, no signing)
   */
  static fromWalletId(walletId: string, options?: ReadOnlyOptions): Wallet;
}

interface CreateOptions {
  wordCount?: 12 | 24;  // Default: 12
  apiUrl?: string;      // Default: production URL
}

interface ImportOptions {
  apiUrl?: string;
}

interface ReadOnlyOptions {
  apiUrl?: string;
  authToken?: string;
}
```

#### Wallet Properties

```typescript
class Wallet {
  /**
   * Get wallet ID (assigned by server)
   */
  get walletId(): string;
  
  /**
   * Check if wallet can sign transactions
   */
  get canSign(): boolean;
  
  /**
   * Get seed phrase (only if created/imported with seed)
   */
  getSeed(): string | null;
  
  /**
   * Get public keys
   */
  getPublicKeys(): {
    secp256k1: string;
    ed25519: string;
  };
}
```

#### Address Methods

```typescript
class Wallet {
  /**
   * Get address for a specific chain
   */
  getAddress(chain: Chain, index?: number): Promise<string>;
  
  /**
   * Get all addresses
   */
  getAddresses(): Promise<Address[]>;
  
  /**
   * Derive a new address
   */
  deriveAddress(chain: Chain): Promise<Address>;
}

interface Address {
  chain: Chain;
  address: string;
  derivationIndex: number;
  derivationPath: string;
}

type Chain = 'BTC' | 'BCH' | 'ETH' | 'POL' | 'SOL' | 'USDC_ETH' | 'USDC_POL' | 'USDC_SOL';
```

#### Balance Methods

```typescript
class Wallet {
  /**
   * Get balance for a specific chain
   */
  getBalance(chain: Chain, options?: BalanceOptions): Promise<Balance>;
  
  /**
   * Get all balances
   */
  getBalances(): Promise<Balance[]>;
  
  /**
   * Get total balance in USD
   */
  getTotalBalanceUSD(): Promise<number>;
}

interface BalanceOptions {
  refresh?: boolean;  // Force refresh from blockchain
}

interface Balance {
  chain: Chain;
  address: string;
  amount: string;
  amountUSD: number;
  tokenBalances?: TokenBalance[];
  updatedAt: Date;
}

interface TokenBalance {
  symbol: string;
  address: string;
  amount: string;
  amountUSD: number;
}
```

#### Transaction Methods

```typescript
class Wallet {
  /**
   * Send a transaction
   */
  send(params: SendParams): Promise<TransactionResult>;
  
  /**
   * Estimate transaction fee
   */
  estimateFee(params: SendParams): Promise<FeeEstimate>;
  
  /**
   * Get transaction history
   */
  getTransactions(options?: TransactionOptions): Promise<Transaction[]>;
  
  /**
   * Get transaction by hash
   */
  getTransaction(txHash: string): Promise<Transaction>;
}

interface SendParams {
  chain: Chain;
  to: string;
  amount: string;
  token?: string;        // Token address for token transfers
  feePriority?: 'low' | 'medium' | 'high';
  metadata?: Record<string, any>;
}

interface TransactionResult {
  hash: string;
  chain: Chain;
  status: 'pending' | 'confirmed' | 'failed';
  amount: string;
  fee: string;
  from: string;
  to: string;
  timestamp: Date;
}

interface FeeEstimate {
  low: { fee: string; feeUSD: number; time: string };
  medium: { fee: string; feeUSD: number; time: string };
  high: { fee: string; feeUSD: number; time: string };
}

interface TransactionOptions {
  chain?: Chain;
  direction?: 'incoming' | 'outgoing';
  status?: 'pending' | 'confirmed' | 'failed';
  limit?: number;
  offset?: number;
}

interface Transaction {
  hash: string;
  chain: Chain;
  direction: 'incoming' | 'outgoing';
  status: 'pending' | 'confirming' | 'confirmed' | 'failed';
  amount: string;
  amountUSD: number;
  fee: string;
  from: string;
  to: string;
  confirmations: number;
  blockNumber?: number;
  timestamp: Date;
}
```

#### Event Methods

```typescript
class Wallet {
  /**
   * Subscribe to wallet events
   */
  on(event: WalletEvent, handler: EventHandler): () => void;
  
  /**
   * Unsubscribe from events
   */
  off(event: WalletEvent, handler: EventHandler): void;
}

type WalletEvent = 
  | 'transaction.incoming'
  | 'transaction.confirmed'
  | 'balance.changed';

type EventHandler = (data: any) => void;
```

---

## 5. Usage Examples

### 5.1 Basic Send

```typescript
import { Wallet } from '@coinpayportal/wallet-sdk';

const wallet = Wallet.fromSeed(process.env.WALLET_SEED!);

// Send ETH
const tx = await wallet.send({
  chain: 'ETH',
  to: '0x742d35Cc6634C0532925a3b844Bc9e7595f...',
  amount: '0.5'
});

console.log(`Sent! TX: ${tx.hash}`);
```

### 5.2 Send USDC

```typescript
// Send USDC on Polygon
const tx = await wallet.send({
  chain: 'USDC_POL',
  to: '0x742d35Cc6634C0532925a3b844Bc9e7595f...',
  amount: '100.00'  // 100 USDC
});
```

### 5.3 Check Balances

```typescript
// Get all balances
const balances = await wallet.getBalances();

for (const balance of balances) {
  console.log(`${balance.chain}: ${balance.amount} ($${balance.amountUSD})`);
}

// Get total in USD
const total = await wallet.getTotalBalanceUSD();
console.log(`Total: $${total}`);
```

### 5.4 Monitor Incoming Transactions

```typescript
// Subscribe to incoming transactions
const unsubscribe = wallet.on('transaction.incoming', (tx) => {
  console.log(`Received ${tx.amount} ${tx.chain} from ${tx.from}`);
  
  // Process payment...
});

// Later: unsubscribe
unsubscribe();
```

### 5.5 Wait for Confirmation

```typescript
const tx = await wallet.send({
  chain: 'BTC',
  to: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
  amount: '0.001'
});

// Wait for confirmation
while (tx.status !== 'confirmed') {
  await sleep(10000);
  const updated = await wallet.getTransaction(tx.hash);
  console.log(`Confirmations: ${updated.confirmations}`);
  
  if (updated.status === 'confirmed') {
    console.log('Transaction confirmed!');
    break;
  }
}
```

### 5.6 Fee Estimation

```typescript
// Estimate fees before sending
const estimate = await wallet.estimateFee({
  chain: 'ETH',
  to: '0x...',
  amount: '1.0'
});

console.log('Fee options:');
console.log(`  Low: ${estimate.low.fee} ETH (~${estimate.low.time})`);
console.log(`  Medium: ${estimate.medium.fee} ETH (~${estimate.medium.time})`);
console.log(`  High: ${estimate.high.fee} ETH (~${estimate.high.time})`);

// Send with specific fee priority
const tx = await wallet.send({
  chain: 'ETH',
  to: '0x...',
  amount: '1.0',
  feePriority: 'high'
});
```

---

## 6. Advanced Usage

### 6.1 Multiple Addresses

```typescript
// Derive multiple addresses for receiving
const addresses = [];
for (let i = 0; i < 5; i++) {
  const addr = await wallet.deriveAddress('ETH');
  addresses.push(addr);
}

// Use different addresses for different purposes
const customerAddress = addresses[0].address;
const refundAddress = addresses[1].address;
```

### 6.2 Custom API URL

```typescript
// Use custom API endpoint (for testing)
const wallet = Wallet.fromSeed(seed, {
  apiUrl: 'http://localhost:3000/api/web-wallet'
});
```

### 6.3 Read-Only Mode

```typescript
// Create read-only wallet (no signing capability)
const wallet = Wallet.fromWalletId('wallet-uuid', {
  authToken: 'jwt-token'
});

// Can read balances and history
const balances = await wallet.getBalances();

// Cannot send (will throw error)
// await wallet.send(...); // Error: Wallet is read-only
```

### 6.4 Batch Operations

```typescript
// Send to multiple recipients
const recipients = [
  { to: '0xAddr1...', amount: '0.1' },
  { to: '0xAddr2...', amount: '0.2' },
  { to: '0xAddr3...', amount: '0.3' }
];

const results = await Promise.all(
  recipients.map(r => wallet.send({
    chain: 'ETH',
    ...r
  }))
);
```

---

## 7. Error Handling

### 7.1 Error Types

```typescript
import { 
  WalletError,
  InsufficientFundsError,
  InvalidAddressError,
  NetworkError,
  AuthenticationError
} from '@coinpayportal/wallet-sdk';

try {
  await wallet.send({ chain: 'ETH', to: '0x...', amount: '100' });
} catch (error) {
  if (error instanceof InsufficientFundsError) {
    console.log(`Not enough funds. Have: ${error.balance}, Need: ${error.required}`);
  } else if (error instanceof InvalidAddressError) {
    console.log(`Invalid address: ${error.address}`);
  } else if (error instanceof NetworkError) {
    console.log(`Network error: ${error.message}. Retry in ${error.retryAfter}s`);
  } else if (error instanceof AuthenticationError) {
    console.log('Authentication failed. Check your seed phrase.');
  } else {
    throw error;
  }
}
```

### 7.2 Retry Logic

```typescript
import { retry } from '@coinpayportal/wallet-sdk';

// Automatic retry with exponential backoff
const tx = await retry(
  () => wallet.send({ chain: 'ETH', to: '0x...', amount: '0.1' }),
  {
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 10000
  }
);
```

---

## 8. TypeScript Support

### 8.1 Full Type Definitions

```typescript
// All types are exported
import type {
  Wallet,
  Chain,
  Address,
  Balance,
  Transaction,
  SendParams,
  TransactionResult,
  FeeEstimate,
  WalletEvent
} from '@coinpayportal/wallet-sdk';
```

### 8.2 Generic Event Handlers

```typescript
wallet.on('transaction.incoming', (tx: Transaction) => {
  // tx is fully typed
  console.log(tx.amount);
});

wallet.on('balance.changed', (data: { chain: Chain; oldBalance: string; newBalance: string }) => {
  // data is fully typed
});
```

---

## 9. Security Best Practices

### 9.1 Seed Storage

```typescript
// DON'T: Hardcode seed in source code
const wallet = Wallet.fromSeed('word1 word2 ...'); // BAD

// DO: Use environment variables
const wallet = Wallet.fromSeed(process.env.WALLET_SEED!);

// DO: Use secure secret management
import { getSecret } from './secrets';
const seed = await getSecret('wallet-seed');
const wallet = Wallet.fromSeed(seed);
```

### 9.2 Memory Cleanup

```typescript
// Destroy wallet when done to clear sensitive data
const wallet = Wallet.fromSeed(seed);
try {
  await wallet.send({ ... });
} finally {
  wallet.destroy();
}
```

### 9.3 Validate Addresses

```typescript
import { isValidAddress } from '@coinpayportal/wallet-sdk';

const userInput = '0x...';
if (!isValidAddress(userInput, 'ETH')) {
  throw new Error('Invalid Ethereum address');
}
```

---

## 10. CLI Tool

The SDK includes a CLI for quick operations.

### 10.1 Installation

```bash
npm install -g @coinpayportal/wallet-sdk
```

### 10.2 Commands

```bash
# Create new wallet
coinpay-wallet create

# Import wallet
coinpay-wallet import --seed "word1 word2 ..."

# Check balance
coinpay-wallet balance --chain ETH

# Send transaction
coinpay-wallet send --chain ETH --to 0x... --amount 0.1

# Get address
coinpay-wallet address --chain ETH

# Transaction history
coinpay-wallet history --limit 10
```

### 10.3 Configuration

```bash
# Set seed via environment
export COINPAY_WALLET_SEED="word1 word2 ..."

# Or use config file
echo "seed: word1 word2 ..." > ~/.coinpay-wallet.yaml
```

---

## 11. Package Structure

```
@coinpayportal/wallet-sdk/
├── dist/
│   ├── index.js          # CommonJS build
│   ├── index.mjs         # ESM build
│   └── index.d.ts        # TypeScript definitions
├── src/
│   ├── index.ts          # Main exports
│   ├── wallet.ts         # Wallet class
│   ├── signer.ts         # Transaction signing
│   ├── api.ts            # API client
│   ├── types.ts          # Type definitions
│   └── utils.ts          # Utilities
├── bin/
│   └── cli.js            # CLI entry point
├── package.json
└── README.md
```

---

## 12. Dependencies

```json
{
  "dependencies": {
    "@scure/bip39": "^1.2.0",
    "@scure/bip32": "^1.3.0",
    "@noble/curves": "^1.2.0",
    "ethers": "^6.9.0",
    "@solana/web3.js": "^1.87.0",
    "bitcoinjs-lib": "^6.1.0"
  },
  "peerDependencies": {
    "typescript": ">=4.7.0"
  }
}
```

Minimal dependencies, all audited cryptographic libraries.
