# CoinPay Security Documentation

## Overview

Security is paramount in CoinPay as we handle cryptocurrency transactions and private keys. This document outlines our security architecture, best practices, and threat mitigation strategies.

## Security Principles

1. **Defense in Depth**: Multiple layers of security controls
2. **Least Privilege**: Minimal access rights for users and services
3. **Zero Trust**: Verify every request, never assume trust
4. **Encryption Everywhere**: Data encrypted at rest and in transit
5. **Audit Everything**: Comprehensive logging and monitoring

## Threat Model

### Assets to Protect
1. Private keys for forwarding addresses
2. Merchant credentials and API keys
3. Customer payment information
4. Platform fee wallet private keys
5. Database access credentials

### Potential Threats
1. Private key theft or exposure
2. Unauthorized access to merchant accounts
3. Man-in-the-middle attacks
4. SQL injection and XSS attacks
5. Replay attacks on blockchain transactions
6. Webhook spoofing
7. DDoS attacks

## Cryptographic Security

### Private Key Management

#### Key Generation
```typescript
// HD Wallet generation using BIP39/BIP44
import * as bip39 from 'bip39';
import { HDKey } from '@scure/bip32';

// Generate mnemonic (store securely, never in database)
const mnemonic = bip39.generateMnemonic(256); // 24 words

// Derive keys for each blockchain
const seed = await bip39.mnemonicToSeed(mnemonic);
const hdkey = HDKey.fromMasterSeed(seed);

// Bitcoin: m/44'/0'/0'/0/index
// Ethereum: m/44'/60'/0'/0/index
// Solana: m/44'/501'/0'/0/index
```

#### Key Storage
- **Encryption**: AES-256-GCM with authenticated encryption
- **Key Derivation**: PBKDF2 with 100,000 iterations
- **Salt**: Unique per key, stored with ciphertext
- **Master Key**: Stored in environment variable, never in database

```typescript
import crypto from 'crypto';

function encryptPrivateKey(privateKey: string, masterKey: string): string {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  
  // Derive encryption key from master key
  const key = crypto.pbkdf2Sync(masterKey, salt, 100000, 32, 'sha256');
  
  // Encrypt with AES-256-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(privateKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Return: salt:iv:authTag:ciphertext
  return `${salt.toString('hex')}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decryptPrivateKey(encryptedKey: string, masterKey: string): string {
  const [saltHex, ivHex, authTagHex, encrypted] = encryptedKey.split(':');
  
  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  
  // Derive decryption key
  const key = crypto.pbkdf2Sync(masterKey, salt, 100000, 32, 'sha256');
  
  // Decrypt
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}
```

#### Key Rotation
- Rotate master encryption key every 90 days
- Re-encrypt all private keys with new master key
- Keep old key for 30 days for recovery

### Password Security

#### Hashing
```typescript
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
```

#### Password Requirements
- Minimum 12 characters
- Must include: uppercase, lowercase, number, special character
- Cannot contain email or username
- Check against common password lists
- Enforce password history (last 5 passwords)

### JWT Token Security

```typescript
import jwt from 'jsonwebtoken';

interface TokenPayload {
  merchantId: string;
  email: string;
  iat: number;
  exp: number;
}

function generateToken(merchantId: string, email: string): string {
  return jwt.sign(
    { merchantId, email },
    process.env.JWT_SECRET!,
    {
      expiresIn: '24h',
      issuer: 'coinpayportal.com',
      audience: 'coinpayportal-api'
    }
  );
}

function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, process.env.JWT_SECRET!, {
    issuer: 'coinpayportal.com',
    audience: 'coinpayportal-api'
  }) as TokenPayload;
}
```

## API Security

### Authentication & Authorization

#### Rate Limiting
```typescript
// Per IP address
const ipRateLimit = {
  windowMs: 60 * 1000, // 1 minute
  max: 100 // 100 requests per minute
};

// Per authenticated user
const userRateLimit = {
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 1000 // 1000 requests per hour
};

// Sensitive endpoints (login, register)
const authRateLimit = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5 // 5 attempts per 15 minutes
};
```

#### CORS Configuration
```typescript
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
};
```

#### Input Validation
```typescript
import { z } from 'zod';

const createPaymentSchema = z.object({
  businessId: z.string().uuid(),
  amount: z.number().positive().max(1000000),
  currency: z.enum(['USD', 'EUR', 'GBP']),
  blockchain: z.enum(['btc', 'bch', 'eth', 'matic', 'sol', 'usdc_eth', 'usdc_matic', 'usdc_sol']),
  merchantWalletAddress: z.string().regex(/^(0x[a-fA-F0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|[a-zA-Z0-9]{32,44})$/),
  metadata: z.record(z.any()).optional()
});

// Validate request
const validatedData = createPaymentSchema.parse(requestBody);
```

### SQL Injection Prevention

Using Supabase with parameterized queries:

```typescript
// GOOD: Parameterized query
const { data, error } = await supabase
  .from('payments')
  .select('*')
  .eq('business_id', businessId)
  .eq('status', status);

// BAD: String concatenation (NEVER DO THIS)
// const query = `SELECT * FROM payments WHERE business_id = '${businessId}'`;
```

### XSS Prevention

```typescript
import DOMPurify from 'isomorphic-dompurify';

function sanitizeInput(input: string): string {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [], // No HTML tags allowed
    ALLOWED_ATTR: []
  });
}

// Sanitize all user inputs
const sanitizedName = sanitizeInput(req.body.name);
```

## Blockchain Security

### Transaction Security

#### Nonce Management
```typescript
// Prevent replay attacks by tracking nonces
class NonceManager {
  private nonces: Map<string, number> = new Map();
  
  async getNextNonce(address: string): Promise<number> {
    const currentNonce = await provider.getTransactionCount(address, 'pending');
    const cachedNonce = this.nonces.get(address) || 0;
    const nonce = Math.max(currentNonce, cachedNonce);
    this.nonces.set(address, nonce + 1);
    return nonce;
  }
}
```

#### Gas Price Limits
```typescript
const MAX_GAS_PRICE = ethers.parseUnits('500', 'gwei'); // 500 gwei max

async function sendTransaction(tx: Transaction) {
  const gasPrice = await provider.getFeeData();
  
  if (gasPrice.gasPrice && gasPrice.gasPrice > MAX_GAS_PRICE) {
    throw new Error('Gas price too high, transaction aborted');
  }
  
  return wallet.sendTransaction(tx);
}
```

#### Confirmation Requirements
```typescript
const CONFIRMATION_REQUIREMENTS = {
  btc: 3,
  bch: 6,
  eth: 12,
  pol: 128,
  sol: 32
};

async function waitForConfirmations(
  txHash: string,
  blockchain: string
): Promise<boolean> {
  const required = CONFIRMATION_REQUIREMENTS[blockchain];
  let confirmations = 0;
  
  while (confirmations < required) {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      await sleep(5000);
      continue;
    }
    
    const currentBlock = await provider.getBlockNumber();
    confirmations = currentBlock - receipt.blockNumber + 1;
    
    if (confirmations < required) {
      await sleep(10000);
    }
  }
  
  return true;
}
```

### Address Validation

```typescript
import { isAddress } from 'ethers';
import * as bitcoin from 'bitcoinjs-lib';
import bs58check from 'bs58check';

function validateAddress(address: string, blockchain: string): boolean {
  switch (blockchain) {
    case 'eth':
    case 'matic':
    case 'usdc_eth':
    case 'usdc_matic':
      return isAddress(address);
      
    case 'btc':
    case 'bch':
      try {
        bitcoin.address.toOutputScript(address);
        return true;
      } catch {
        return false;
      }
      
    case 'sol':
    case 'usdc_sol':
      try {
        const decoded = bs58check.decode(address);
        return decoded.length === 32;
      } catch {
        return false;
      }
      
    default:
      return false;
  }
}
```

## Webhook Security

### Signature Verification

```typescript
import crypto from 'crypto';

function generateWebhookSignature(
  payload: object,
  secret: string
): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  return hmac.digest('hex');
}

function verifyWebhookSignature(
  payload: object,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = generateWebhookSignature(payload, secret);
  
  // Timing-safe comparison
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

### Webhook Delivery

```typescript
async function deliverWebhook(
  url: string,
  payload: object,
  secret: string
): Promise<void> {
  const signature = generateWebhookSignature(payload, secret);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CoinPay-Signature': signature,
      'X-CoinPay-Timestamp': Date.now().toString(),
      'User-Agent': 'CoinPay-Webhook/1.0'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000) // 10 second timeout
  });
  
  if (!response.ok) {
    throw new Error(`Webhook delivery failed: ${response.status}`);
  }
}
```

## Database Security

### Row Level Security (RLS)

```sql
-- Enable RLS on all tables
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Merchants can only see their own data
CREATE POLICY "Merchants view own data"
  ON merchants FOR SELECT
  USING (auth.uid() = id);

-- Merchants can only access their own businesses
CREATE POLICY "Merchants view own businesses"
  ON businesses FOR SELECT
  USING (merchant_id = auth.uid());

-- Merchants can only see payments for their businesses
CREATE POLICY "Merchants view own payments"
  ON payments FOR SELECT
  USING (
    business_id IN (
      SELECT id FROM businesses WHERE merchant_id = auth.uid()
    )
  );
```

### Connection Security

```typescript
// Use connection pooling
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: {
      schema: 'public'
    },
    auth: {
      autoRefreshToken: true,
      persistSession: false
    },
    global: {
      headers: {
        'x-application-name': 'coinpayportal'
      }
    }
  }
);
```

## Environment Security

### Environment Variables

```bash
# .env.example (NEVER commit actual .env)
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Encryption (Generate with: openssl rand -hex 32)
ENCRYPTION_KEY=your-32-byte-hex-key

# JWT (Generate with: openssl rand -base64 64)
JWT_SECRET=your-jwt-secret

# RPC Providers
BITCOIN_RPC_URL=https://your-bitcoin-rpc
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
POLYGON_RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Platform Fee Wallets (NEVER commit these)
PLATFORM_FEE_WALLET_BTC=your-btc-address
PLATFORM_FEE_WALLET_ETH=your-eth-address
PLATFORM_FEE_WALLET_POL=your-pol-address
PLATFORM_FEE_WALLET_SOL=your-sol-address

# Tatum API
TATUM_API_KEY=your-tatum-api-key

# Webhook
WEBHOOK_SIGNING_SECRET=your-webhook-secret

# CORS
ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
```

### Secret Management

For production, use a secret management service:

```typescript
// AWS Secrets Manager example
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

async function getSecret(secretName: string): Promise<string> {
  const client = new SecretsManagerClient({ region: 'us-east-1' });
  
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretName })
  );
  
  return response.SecretString!;
}

// Use in production
const encryptionKey = process.env.NODE_ENV === 'production'
  ? await getSecret('coinpayportal/encryption-key')
  : process.env.ENCRYPTION_KEY!;
```

## Monitoring & Incident Response

### Security Monitoring

```typescript
// Log security events
interface SecurityEvent {
  type: 'auth_failure' | 'rate_limit' | 'suspicious_activity' | 'key_access';
  severity: 'low' | 'medium' | 'high' | 'critical';
  merchantId?: string;
  ip: string;
  details: object;
  timestamp: Date;
}

async function logSecurityEvent(event: SecurityEvent): Promise<void> {
  await supabase.from('security_logs').insert(event);
  
  if (event.severity === 'critical') {
    // Alert security team
    await sendAlert(event);
  }
}
```

### Incident Response Plan

1. **Detection**: Automated monitoring alerts
2. **Containment**: Disable affected accounts/keys
3. **Investigation**: Review logs and determine scope
4. **Eradication**: Remove threat and patch vulnerabilities
5. **Recovery**: Restore services and rotate credentials
6. **Post-Incident**: Document and improve processes

## Security Checklist

### Development
- [ ] All secrets in environment variables
- [ ] Input validation on all endpoints
- [ ] Parameterized database queries
- [ ] HTTPS only in production
- [ ] CORS properly configured
- [ ] Rate limiting implemented
- [ ] Error messages don't leak sensitive info

### Deployment
- [ ] Environment variables secured
- [ ] Database backups enabled
- [ ] SSL/TLS certificates valid
- [ ] Firewall rules configured
- [ ] Monitoring and alerting active
- [ ] Incident response plan documented

### Operations
- [ ] Regular security audits
- [ ] Dependency updates automated
- [ ] Key rotation schedule followed
- [ ] Access logs reviewed
- [ ] Penetration testing performed
- [ ] Security training completed

## Compliance

### Data Protection
- GDPR compliance for EU customers
- PCI DSS not required (non-custodial)
- SOC 2 Type II certification (future)

### Audit Trail
- All payment state changes logged
- API access logged with timestamps
- Failed authentication attempts tracked
- Key access logged and monitored

## Security Contacts

- Security Issues: security@coinpayportal.com
- Bug Bounty: https://coinpayportal.com/security/bounty
- PGP Key: Available at https://coinpayportal.com/security/pgp

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CWE Top 25](https://cwe.mitre.org/top25/)
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)
- [Blockchain Security Best Practices](https://consensys.github.io/smart-contract-best-practices/)