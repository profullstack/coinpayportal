# CoinPayPortal Wallet Mode - Key Management

## 1. Overview

This document describes the non-custodial key management system for Wallet Mode. The core principle is that **CoinPayPortal never has access to private keys**.

### Key Management Principles

1. **Client-Side Generation**: All keys generated on user's device
2. **Client-Side Storage**: Encrypted keys stored locally
3. **Client-Side Signing**: All transactions signed locally
4. **Server Stores Public Keys Only**: For address verification and monitoring

---

## 2. Key Hierarchy

### 2.1 BIP39/BIP32/BIP44 Standards

Wallet Mode uses industry-standard key derivation:

```
┌─────────────────────────────────────────────────────────────┐
│                    BIP39 Mnemonic                           │
│              (12 or 24 words, 128/256 bits)                 │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    BIP32 Master Seed                        │
│                      (512 bits)                             │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                  BIP32 Master Key                           │
│            (Private Key + Chain Code)                       │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
          ▼               ▼               ▼
    ┌───────────┐   ┌───────────┐   ┌───────────┐
    │  BIP44    │   │  BIP44    │   │  BIP44    │
    │  Bitcoin  │   │ Ethereum  │   │  Solana   │
    │ m/44'/0'  │   │ m/44'/60' │   │ m/44'/501'│
    └─────┬─────┘   └─────┬─────┘   └─────┬─────┘
          │               │               │
          ▼               ▼               ▼
    ┌───────────┐   ┌───────────┐   ┌───────────┐
    │ Addresses │   │ Addresses │   │ Addresses │
    │  0, 1, 2  │   │  0, 1, 2  │   │  0, 1, 2  │
    └───────────┘   └───────────┘   └───────────┘
```

### 2.2 Derivation Paths

| Chain | Coin Type | Path Pattern | Example |
|-------|-----------|--------------|---------|
| Bitcoin | 0 | m/44'/0'/0'/0/n | m/44'/0'/0'/0/0 |
| Bitcoin Cash | 145 | m/44'/145'/0'/0/n | m/44'/145'/0'/0/0 |
| Ethereum | 60 | m/44'/60'/0'/0/n | m/44'/60'/0'/0/0 |
| Polygon | 60 | m/44'/60'/0'/0/n | m/44'/60'/0'/0/0 |
| Solana | 501 | m/44'/501'/n'/0' | m/44'/501'/0'/0' |

**Notes:**
- Ethereum and Polygon share the same derivation path (same addresses)
- Solana uses hardened derivation at account level
- USDC tokens use the same addresses as their parent chain

---

## 3. Key Generation

### 3.1 Mnemonic Generation

```typescript
import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

// Generate 12-word mnemonic (128 bits entropy)
function generateWalletMnemonic(): string {
  return generateMnemonic(wordlist, 128);
}

// Generate 24-word mnemonic (256 bits entropy) - more secure
function generateSecureMnemonic(): string {
  return generateMnemonic(wordlist, 256);
}

// Validate mnemonic
function isValidMnemonic(mnemonic: string): boolean {
  return validateMnemonic(mnemonic, wordlist);
}
```

### 3.2 Seed Derivation

```typescript
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';

function deriveHDKey(mnemonic: string, passphrase: string = ''): HDKey {
  // BIP39 allows optional passphrase for additional security
  const seed = mnemonicToSeedSync(mnemonic, passphrase);
  return HDKey.fromMasterSeed(seed);
}
```

### 3.3 Chain-Specific Key Derivation

```typescript
import { secp256k1 } from '@noble/curves/secp256k1';
import { ed25519 } from '@noble/curves/ed25519';
import * as bitcoin from 'bitcoinjs-lib';
import { ethers } from 'ethers';
import { Keypair } from '@solana/web3.js';

interface DerivedKey {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  address: string;
  path: string;
}

// Bitcoin key derivation
function deriveBitcoinKey(hdKey: HDKey, index: number): DerivedKey {
  const path = `m/44'/0'/0'/0/${index}`;
  const child = hdKey.derive(path);
  
  if (!child.privateKey) throw new Error('Failed to derive key');
  
  const publicKey = secp256k1.getPublicKey(child.privateKey, true);
  const { address } = bitcoin.payments.p2pkh({
    pubkey: Buffer.from(publicKey),
    network: bitcoin.networks.bitcoin
  });
  
  return {
    privateKey: child.privateKey,
    publicKey,
    address: address!,
    path
  };
}

// Ethereum key derivation
function deriveEthereumKey(hdKey: HDKey, index: number): DerivedKey {
  const path = `m/44'/60'/0'/0/${index}`;
  const child = hdKey.derive(path);
  
  if (!child.privateKey) throw new Error('Failed to derive key');
  
  const privateKeyHex = '0x' + Buffer.from(child.privateKey).toString('hex');
  const wallet = new ethers.Wallet(privateKeyHex);
  
  return {
    privateKey: child.privateKey,
    publicKey: hexToBytes(wallet.signingKey.publicKey.slice(2)),
    address: wallet.address,
    path
  };
}

// Solana key derivation
function deriveSolanaKey(hdKey: HDKey, index: number): DerivedKey {
  const path = `m/44'/501'/${index}'/0'`;
  const child = hdKey.derive(path);
  
  if (!child.privateKey) throw new Error('Failed to derive key');
  
  // Solana uses ed25519, derive from first 32 bytes
  const keypair = Keypair.fromSeed(child.privateKey.slice(0, 32));
  
  return {
    privateKey: keypair.secretKey,
    publicKey: keypair.publicKey.toBytes(),
    address: keypair.publicKey.toBase58(),
    path
  };
}
```

---

## 4. Key Storage

### 4.1 Browser Storage (Web Wallet)

Keys are encrypted and stored in localStorage or IndexedDB.

**Storage Structure:**
```typescript
interface EncryptedWalletStore {
  version: number;
  wallet_id: string;
  encrypted_seed: {
    ciphertext: string;  // Hex encoded
    iv: string;          // Hex encoded
    salt: string;        // Hex encoded
    algorithm: 'AES-256-GCM';
    kdf: 'PBKDF2';
    iterations: number;
  };
  public_keys: {
    secp256k1: string;
    ed25519: string;
  };
  created_at: number;
  last_accessed: number;
}
```

**Encryption Implementation:**
```typescript
const PBKDF2_ITERATIONS = 100000;
const AES_KEY_LENGTH = 256;

async function encryptSeed(
  seed: string, 
  password: string
): Promise<EncryptedSeed> {
  // Generate random salt
  const salt = crypto.getRandomValues(new Uint8Array(16));
  
  // Derive encryption key from password
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  
  const encryptionKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
  
  // Generate random IV
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  // Encrypt seed
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    encryptionKey,
    new TextEncoder().encode(seed)
  );
  
  return {
    ciphertext: bufferToHex(ciphertext),
    iv: bufferToHex(iv),
    salt: bufferToHex(salt),
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2',
    iterations: PBKDF2_ITERATIONS
  };
}

async function decryptSeed(
  encrypted: EncryptedSeed, 
  password: string
): Promise<string> {
  const salt = hexToBuffer(encrypted.salt);
  const iv = hexToBuffer(encrypted.iv);
  const ciphertext = hexToBuffer(encrypted.ciphertext);
  
  // Derive decryption key
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  
  const decryptionKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: encrypted.iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false,
    ['decrypt']
  );
  
  // Decrypt
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    decryptionKey,
    ciphertext
  );
  
  return new TextDecoder().decode(plaintext);
}
```

### 4.2 Bot/CLI Storage

For bots and CLI tools, keys can be stored in:

**Option 1: Environment Variable**
```bash
export WALLET_SEED="word1 word2 word3 ... word12"
```

**Option 2: Encrypted File**
```typescript
// .wallet-seed.enc
{
  "encrypted": true,
  "ciphertext": "...",
  "iv": "...",
  "salt": "..."
}
```

**Option 3: System Keychain**
```typescript
import keytar from 'keytar';

// Store
await keytar.setPassword('coinpayportal', 'wallet-seed', mnemonic);

// Retrieve
const mnemonic = await keytar.getPassword('coinpayportal', 'wallet-seed');
```

---

## 5. Key Security

### 5.1 Memory Security

```typescript
// Secure memory handling class
class SecureBuffer {
  private buffer: Uint8Array;
  private cleared: boolean = false;
  
  constructor(data: Uint8Array) {
    this.buffer = new Uint8Array(data);
  }
  
  get(): Uint8Array {
    if (this.cleared) throw new Error('Buffer already cleared');
    return this.buffer;
  }
  
  clear(): void {
    // Overwrite with zeros
    this.buffer.fill(0);
    // Overwrite with random data
    crypto.getRandomValues(this.buffer);
    // Overwrite with zeros again
    this.buffer.fill(0);
    this.cleared = true;
  }
}

// Usage pattern
async function signTransaction(tx: Transaction): Promise<string> {
  const secureKey = new SecureBuffer(privateKey);
  try {
    return await sign(tx, secureKey.get());
  } finally {
    secureKey.clear();
  }
}
```

### 5.2 Password Requirements

```typescript
interface PasswordPolicy {
  minLength: 12;
  requireUppercase: true;
  requireLowercase: true;
  requireNumber: true;
  requireSpecial: true;
  maxLength: 128;
}

function validatePassword(password: string): ValidationResult {
  const errors: string[] = [];
  
  if (password.length < 12) {
    errors.push('Password must be at least 12 characters');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain number');
  }
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain special character');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}
```

### 5.3 Seed Backup Verification

```typescript
// Verify user has backed up seed
async function verifySeedBackup(
  originalSeed: string,
  userInput: string[]
): Promise<boolean> {
  const originalWords = originalSeed.split(' ');
  
  // Ask user to verify random words
  const indicesToVerify = [2, 5, 8, 11]; // 0-indexed
  
  for (let i = 0; i < indicesToVerify.length; i++) {
    const index = indicesToVerify[i];
    if (userInput[i] !== originalWords[index]) {
      return false;
    }
  }
  
  return true;
}
```

---

## 6. Hardware Wallet Compatibility

### 6.1 Future Hardware Wallet Support

The key derivation paths are compatible with major hardware wallets:

| Hardware Wallet | BTC | ETH | SOL |
|-----------------|-----|-----|-----|
| Ledger | ✅ | ✅ | ✅ |
| Trezor | ✅ | ✅ | ❌ |
| KeepKey | ✅ | ✅ | ❌ |

### 6.2 Hardware Wallet Integration (Future)

```typescript
// Future API for hardware wallet support
interface HardwareWalletProvider {
  connect(): Promise<void>;
  getPublicKey(path: string): Promise<string>;
  signTransaction(path: string, tx: UnsignedTransaction): Promise<string>;
  signMessage(path: string, message: string): Promise<string>;
}

// Ledger implementation example
class LedgerProvider implements HardwareWalletProvider {
  async connect(): Promise<void> {
    // Connect via WebUSB or WebHID
  }
  
  async getPublicKey(path: string): Promise<string> {
    // Get public key from device
  }
  
  async signTransaction(path: string, tx: UnsignedTransaction): Promise<string> {
    // Sign on device, return signature
  }
}
```

---

## 7. Key Export

### 7.1 Seed Export

```typescript
// Export seed phrase (requires password verification)
async function exportSeed(password: string): Promise<string> {
  // Verify password first
  const store = getWalletStore();
  
  try {
    const seed = await decryptSeed(store.encrypted_seed, password);
    return seed;
  } catch (error) {
    throw new Error('Invalid password');
  }
}
```

### 7.2 Private Key Export (Single Address)

```typescript
// Export private key for specific address
async function exportPrivateKey(
  password: string,
  chain: string,
  index: number
): Promise<ExportedKey> {
  const seed = await exportSeed(password);
  const hdKey = deriveHDKey(seed);
  
  let derivedKey: DerivedKey;
  switch (chain) {
    case 'BTC':
    case 'BCH':
      derivedKey = deriveBitcoinKey(hdKey, index);
      break;
    case 'ETH':
    case 'POL':
      derivedKey = deriveEthereumKey(hdKey, index);
      break;
    case 'SOL':
      derivedKey = deriveSolanaKey(hdKey, index);
      break;
    default:
      throw new Error('Unsupported chain');
  }
  
  return {
    chain,
    address: derivedKey.address,
    privateKey: bufferToHex(derivedKey.privateKey),
    path: derivedKey.path,
    format: chain === 'SOL' ? 'base58' : 'hex'
  };
}
```

---

## 8. Key Recovery

### 8.1 Recovery from Seed

```typescript
async function recoverWallet(mnemonic: string): Promise<RecoveredWallet> {
  // Validate mnemonic
  if (!isValidMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }
  
  // Derive HD key
  const hdKey = deriveHDKey(mnemonic);
  
  // Derive identity keys
  const ethKey = deriveEthereumKey(hdKey, 0);
  const solKey = deriveSolanaKey(hdKey, 0);
  
  // Check if wallet exists on server
  const existingWallet = await api.findWalletByPublicKey(
    bufferToHex(ethKey.publicKey)
  );
  
  if (existingWallet) {
    // Recover existing wallet
    return {
      wallet_id: existingWallet.id,
      recovered: true,
      addresses: existingWallet.addresses
    };
  } else {
    // Create new wallet
    const newWallet = await api.createWallet({
      public_key_secp256k1: bufferToHex(ethKey.publicKey),
      public_key_ed25519: solKey.address
    });
    
    return {
      wallet_id: newWallet.id,
      recovered: false,
      addresses: []
    };
  }
}
```

### 8.2 Address Discovery

```typescript
// Scan blockchain for used addresses
async function discoverAddresses(
  hdKey: HDKey,
  chain: string
): Promise<DiscoveredAddress[]> {
  const discovered: DiscoveredAddress[] = [];
  const GAP_LIMIT = 20;
  let consecutiveEmpty = 0;
  let index = 0;
  
  while (consecutiveEmpty < GAP_LIMIT) {
    const key = deriveKeyForChain(hdKey, chain, index);
    const hasActivity = await checkAddressActivity(key.address, chain);
    
    if (hasActivity) {
      discovered.push({
        address: key.address,
        index,
        path: key.path,
        hasBalance: await getBalance(key.address, chain) > 0
      });
      consecutiveEmpty = 0;
    } else {
      consecutiveEmpty++;
    }
    
    index++;
  }
  
  return discovered;
}
```

---

## 9. Cryptographic Libraries

### 9.1 Recommended Libraries

| Purpose | Library | Notes |
|---------|---------|-------|
| BIP39 Mnemonic | @scure/bip39 | Audited, no dependencies |
| BIP32 HD Keys | @scure/bip32 | Audited, no dependencies |
| secp256k1 | @noble/curves | Audited, no dependencies |
| ed25519 | @noble/curves | Audited, no dependencies |
| Bitcoin | bitcoinjs-lib | Well-maintained |
| Ethereum | ethers.js | Industry standard |
| Solana | @solana/web3.js | Official SDK |

### 9.2 Why These Libraries

- **@scure/*** and **@noble/***: Audited by Trail of Bits, no dependencies, pure JavaScript
- **ethers.js**: Most widely used, well-documented, actively maintained
- **bitcoinjs-lib**: Standard for Bitcoin development
- **@solana/web3.js**: Official Solana SDK

---

## 10. Security Checklist

### Key Generation
- [ ] Use cryptographically secure random number generator
- [ ] Generate sufficient entropy (128+ bits)
- [ ] Validate mnemonic before use

### Key Storage
- [ ] Encrypt with AES-256-GCM
- [ ] Use PBKDF2 with 100,000+ iterations
- [ ] Generate unique salt per encryption
- [ ] Never store unencrypted keys

### Key Usage
- [ ] Clear keys from memory after use
- [ ] Use secure memory handling
- [ ] Validate signatures before broadcast
- [ ] Implement timeout/auto-lock

### Key Export
- [ ] Require password verification
- [ ] Warn user about security implications
- [ ] Log export events (without key data)
