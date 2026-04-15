# HD Wallet Private Key Security

## Overview

This document describes the security measures implemented for HD wallet private key management in the CoinPay payment system.

## Architecture

### Key Generation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    SYSTEM MNEMONIC                               │
│         (Stored in environment variable, never in DB)            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    HD KEY DERIVATION                             │
│         (BIP-32/BIP-44 derivation in memory only)               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PRIVATE KEY                                   │
│         (Derived per payment, encrypted immediately)             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AES-256-GCM ENCRYPTION                        │
│         (Using ENCRYPTION_KEY from environment)                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DATABASE STORAGE                              │
│         (Only encrypted keys stored in payment_addresses)        │
└─────────────────────────────────────────────────────────────────┘
```

## Security Measures

### 1. Private Keys Never Exposed via API

**Before (INSECURE):**
```typescript
// ❌ NEVER DO THIS - Private key sent via HTTP
POST /api/payments/{id}/forward
{
  "privateKey": "0x1234..."  // DANGEROUS!
}
```

**After (SECURE):**
```typescript
// ✅ CORRECT - No private key in request
POST /api/payments/{id}/forward
{
  "retry": false  // Only control flags, no sensitive data
}
// Private key retrieved from encrypted storage server-side
```

### 2. Encryption at Rest

All private keys stored in the database are encrypted using:
- **Algorithm**: AES-256-GCM
- **Key Length**: 256 bits (32 bytes)
- **IV**: Random 128 bits per encryption
- **Authentication**: GCM provides authenticated encryption

```typescript
// Encryption format: iv:authTag:ciphertext (all base64)
const encrypted = encrypt(privateKey, process.env.ENCRYPTION_KEY);
```

### 3. Key Derivation

Master mnemonics are stored in environment variables:
- `SYSTEM_MNEMONIC_BTC` - Bitcoin HD wallet seed
- `SYSTEM_MNEMONIC_ETH` - Ethereum HD wallet seed
- `SYSTEM_MNEMONIC_POL` - Polygon HD wallet seed
- `SYSTEM_MNEMONIC_SOL` - Solana HD wallet seed

### 4. Mnemonic Generation

Use the included zero-dependency helper script to generate a valid BIP39 phrase locally:

```bash
node scripts/gen-mnemonic.mjs
```

Run this **once per `SYSTEM_MNEMONIC_*` variable** — do NOT reuse the same phrase across chains. The script uses only Node.js built-in `crypto` (no npm packages required) and fetches the official BIP39 English wordlist from the `bitcoinjs/bip39` repository.

> **Security**: Never use an online mnemonic generator for production wallets. Always generate locally and store in a secrets manager (e.g., Doppler, HashiCorp Vault, AWS Secrets Manager).

### 4. Memory Handling

After transaction signing, sensitive data is cleared:
```typescript
function clearSensitiveData(data: { privateKey?: string }): void {
  if (data.privateKey) {
    data.privateKey = '0'.repeat(data.privateKey.length);
    data.privateKey = '';
  }
}
```

## Database Schema

### payment_addresses Table

| Column | Type | Description |
|--------|------|-------------|
| `encrypted_private_key` | TEXT | AES-256-GCM encrypted private key |
| `address` | VARCHAR(255) | Public payment address |
| `derivation_index` | INTEGER | HD derivation index |
| `derivation_path` | VARCHAR(100) | Full derivation path |

**Note**: The `encrypted_private_key` column stores ONLY encrypted data. Raw private keys are NEVER stored.

## Environment Variables

### Required for Production

```bash
# 32-byte hex encryption key (64 characters)
# Generate with: openssl rand -hex 32
ENCRYPTION_KEY=your-64-character-hex-key

# System HD wallet mnemonics — generate each one with:
#   node scripts/gen-mnemonic.mjs
# Use a separate, unique phrase per chain. NEVER reuse.
SYSTEM_MNEMONIC_BTC="word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12"
SYSTEM_MNEMONIC_ETH="word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12"
SYSTEM_MNEMONIC_POL="word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12"
SYSTEM_MNEMONIC_SOL="word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12"

# Commission wallets (public addresses)
COMMISSION_WALLET_BTC=bc1q...
COMMISSION_WALLET_ETH=0x...
COMMISSION_WALLET_POL=0x...
COMMISSION_WALLET_SOL=...
```

## Security Checklist

### ✅ Implemented

- [x] Private keys encrypted with AES-256-GCM before storage
- [x] API endpoints reject any request containing private keys
- [x] Private keys decrypted only at moment of transaction signing
- [x] Sensitive data cleared from memory after use
- [x] Admin-only access for manual forwarding operations
- [x] Audit logging for key operations (without exposing key material)

### 🔄 Recommended for Production

- [ ] Use Hardware Security Module (HSM) for master key storage
- [ ] Implement HashiCorp Vault for secrets management
- [ ] Enable database encryption at rest (Supabase feature)
- [ ] Set up key rotation procedures
- [ ] Implement multi-signature for high-value transactions
- [ ] Add rate limiting on forwarding operations
- [ ] Enable audit logging to external SIEM

## Secure Forwarding Flow

```
1. Payment confirmed by blockchain monitor
                    │
                    ▼
2. Admin triggers forwarding (no private key in request)
                    │
                    ▼
3. Server retrieves encrypted_private_key from DB
                    │
                    ▼
4. Server decrypts key using ENCRYPTION_KEY
                    │
                    ▼
5. Server signs transaction with decrypted key
                    │
                    ▼
6. Server clears key from memory
                    │
                    ▼
7. Transaction broadcast to blockchain
```

## API Security

### Forwarding Endpoint

```typescript
// POST /api/payments/{id}/forward
// Requires: Bearer token with admin privileges
// Body: { retry?: boolean } - NO private keys accepted

// Security checks:
// 1. JWT authentication required
// 2. Admin role verification
// 3. Rejects any request containing privateKey/private_key/key
// 4. Retrieves encrypted key from database
// 5. Decrypts server-side only
```

## Incident Response

If you suspect key compromise:

1. **Immediately** rotate the `ENCRYPTION_KEY`
2. Re-encrypt all stored private keys with new key
3. Generate new system mnemonics
4. Migrate funds from old addresses
5. Review audit logs for unauthorized access
6. Notify affected merchants

## Files Modified for Security

- `src/app/api/payments/[id]/forward/route.ts` - Removed private key from API
- `src/lib/wallets/secure-forwarding.ts` - New secure forwarding module
- `src/lib/payments/business-collection.ts` - Fixed decryption bug
- `src/lib/wallets/system-wallet.ts` - Secure key derivation
- `src/lib/crypto/encryption.ts` - AES-256-GCM implementation

## Contact

For security concerns, contact the security team immediately.