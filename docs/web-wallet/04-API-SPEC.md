# CoinPayPortal Wallet Mode - API Specification

## 1. Overview

This document defines the API endpoints for Wallet Mode. All wallet endpoints are prefixed with `/api/web-wallet/`.

### Base URL
```
Production: https://coinpayportal.com/api/web-wallet
Development: http://localhost:3000/api/web-wallet
```

### Authentication
Wallet API uses signature-based authentication. See [05-IDENTITY-AUTH.md](./05-IDENTITY-AUTH.md) for details.

```
Authorization: Wallet <wallet_id>:<signature>:<timestamp>
```

### Response Format
All responses follow this structure:

```json
{
  "success": true,
  "data": { ... },
  "error": null,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

Error responses:
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": { ... }
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

## 2. Wallet Management Endpoints

### 2.1 Create Wallet

Register a new wallet with the server. Client generates seed locally and only sends public keys.

**Endpoint:** `POST /api/web-wallet/create`

**Authentication:** None required (public endpoint)

**Request Body:**
```json
{
  "public_key_ed25519": "base58_encoded_ed25519_public_key",
  "public_key_secp256k1": "hex_encoded_secp256k1_public_key",
  "initial_addresses": [
    {
      "chain": "ETH",
      "address": "0x1234567890abcdef...",
      "derivation_path": "m/44'/60'/0'/0/0"
    },
    {
      "chain": "SOL",
      "address": "ABC123...",
      "derivation_path": "m/44'/501'/0'/0'"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "wallet_id": "uuid-wallet-id",
    "created_at": "2024-01-01T00:00:00.000Z",
    "addresses": [
      {
        "chain": "ETH",
        "address": "0x1234567890abcdef...",
        "derivation_index": 0
      },
      {
        "chain": "SOL",
        "address": "ABC123...",
        "derivation_index": 0
      }
    ]
  }
}
```

**Notes:**
- At least one public key must be provided
- Initial addresses are optional but recommended
- Server validates address format but cannot verify ownership without signature

---

### 2.2 Import Wallet

Register an existing wallet (from seed) with the server.

**Endpoint:** `POST /api/web-wallet/import`

**Authentication:** None required (public endpoint)

**Request Body:**
```json
{
  "public_key_ed25519": "base58_encoded_ed25519_public_key",
  "public_key_secp256k1": "hex_encoded_secp256k1_public_key",
  "addresses": [
    {
      "chain": "BTC",
      "address": "1ABC...",
      "derivation_path": "m/44'/0'/0'/0/0"
    },
    {
      "chain": "ETH",
      "address": "0x...",
      "derivation_path": "m/44'/60'/0'/0/0"
    }
  ],
  "proof_of_ownership": {
    "message": "CoinPayPortal wallet import: <timestamp>",
    "signature": "signed_message_hex"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "wallet_id": "uuid-wallet-id",
    "imported": true,
    "addresses_registered": 2,
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

**Notes:**
- Proof of ownership signature verifies the user controls the private key
- If wallet already exists (same public key), returns existing wallet_id

---

### 2.3 Get Wallet

Retrieve wallet information.

**Endpoint:** `GET /api/web-wallet/:wallet_id`

**Authentication:** Required

**Response:**
```json
{
  "success": true,
  "data": {
    "wallet_id": "uuid-wallet-id",
    "status": "active",
    "created_at": "2024-01-01T00:00:00.000Z",
    "last_active_at": "2024-01-15T12:00:00.000Z",
    "address_count": 5,
    "settings": {
      "daily_spend_limit": null,
      "whitelist_enabled": false,
      "require_confirmation": false
    }
  }
}
```

---

## 3. Address Management Endpoints

### 3.1 Derive New Address

Derive a new address for a specific chain.

**Endpoint:** `POST /api/web-wallet/:wallet_id/derive`

**Authentication:** Required

**Request Body:**
```json
{
  "chain": "ETH",
  "derivation_index": 1,
  "address": "0x...",
  "derivation_path": "m/44'/60'/0'/0/1"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "address_id": "uuid-address-id",
    "chain": "ETH",
    "address": "0x...",
    "derivation_index": 1,
    "derivation_path": "m/44'/60'/0'/0/1",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

**Notes:**
- Client derives address locally and sends to server
- Server validates address format
- Server cannot verify derivation without private key (trust model)

---

### 3.2 List Addresses

Get all addresses for a wallet.

**Endpoint:** `GET /api/web-wallet/:wallet_id/addresses`

**Authentication:** Required

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chain` | string | No | Filter by chain |
| `active_only` | boolean | No | Only return active addresses |

**Response:**
```json
{
  "success": true,
  "data": {
    "addresses": [
      {
        "address_id": "uuid",
        "chain": "ETH",
        "address": "0x...",
        "derivation_index": 0,
        "is_active": true,
        "cached_balance": "1.5",
        "balance_updated_at": "2024-01-15T12:00:00.000Z"
      },
      {
        "address_id": "uuid",
        "chain": "BTC",
        "address": "1ABC...",
        "derivation_index": 0,
        "is_active": true,
        "cached_balance": "0.05",
        "balance_updated_at": "2024-01-15T12:00:00.000Z"
      }
    ],
    "total": 2
  }
}
```

---

### 3.3 Deactivate Address

Stop monitoring an address.

**Endpoint:** `DELETE /api/web-wallet/:wallet_id/addresses/:address_id`

**Authentication:** Required

**Response:**
```json
{
  "success": true,
  "data": {
    "address_id": "uuid",
    "is_active": false,
    "deactivated_at": "2024-01-15T12:00:00.000Z"
  }
}
```

---

## 4. Balance Endpoints

### 4.1 Get Balances

Get balances for all wallet addresses.

**Endpoint:** `GET /api/web-wallet/:wallet_id/balances`

**Authentication:** Required

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chain` | string | No | Filter by chain |
| `refresh` | boolean | No | Force refresh from blockchain |

**Response:**
```json
{
  "success": true,
  "data": {
    "balances": [
      {
        "chain": "ETH",
        "address": "0x...",
        "balance": "1.5",
        "balance_usd": "3285.00",
        "token": null,
        "updated_at": "2024-01-15T12:00:00.000Z"
      },
      {
        "chain": "USDC_ETH",
        "address": "0x...",
        "balance": "1000.00",
        "balance_usd": "1000.00",
        "token": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        "updated_at": "2024-01-15T12:00:00.000Z"
      },
      {
        "chain": "BTC",
        "address": "1ABC...",
        "balance": "0.05",
        "balance_usd": "2162.50",
        "token": null,
        "updated_at": "2024-01-15T12:00:00.000Z"
      }
    ],
    "total_usd": "6447.50",
    "cached": true
  }
}
```

---

### 4.2 Get Single Address Balance

Get balance for a specific address.

**Endpoint:** `GET /api/web-wallet/:wallet_id/addresses/:address_id/balance`

**Authentication:** Required

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `refresh` | boolean | No | Force refresh from blockchain |

**Response:**
```json
{
  "success": true,
  "data": {
    "chain": "ETH",
    "address": "0x...",
    "balance": "1.5",
    "balance_usd": "3285.00",
    "pending_incoming": "0.1",
    "pending_outgoing": "0",
    "updated_at": "2024-01-15T12:00:00.000Z"
  }
}
```

---

## 5. Transaction Endpoints

### 5.1 Get Transaction History

Get transaction history for wallet.

**Endpoint:** `GET /api/web-wallet/:wallet_id/transactions`

**Authentication:** Required

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chain` | string | No | Filter by chain |
| `direction` | string | No | Filter: incoming, outgoing |
| `status` | string | No | Filter: pending, confirming, confirmed, failed |
| `limit` | number | No | Items per page, default 20, max 100 |
| `offset` | number | No | Pagination offset |
| `from_date` | string | No | ISO date string |
| `to_date` | string | No | ISO date string |

**Response:**
```json
{
  "success": true,
  "data": {
    "transactions": [
      {
        "tx_id": "uuid",
        "chain": "ETH",
        "tx_hash": "0xabc...",
        "direction": "incoming",
        "status": "confirmed",
        "amount": "0.5",
        "amount_usd": "1095.00",
        "from_address": "0xsender...",
        "to_address": "0xmywallet...",
        "fee_amount": "0.002",
        "fee_currency": "ETH",
        "confirmations": 35,
        "block_number": 18500000,
        "block_timestamp": "2024-01-15T11:30:00.000Z",
        "created_at": "2024-01-15T11:25:00.000Z"
      }
    ],
    "pagination": {
      "total": 150,
      "limit": 20,
      "offset": 0,
      "has_more": true
    }
  }
}
```

---

### 5.2 Get Transaction Details

Get details for a specific transaction.

**Endpoint:** `GET /api/web-wallet/:wallet_id/transactions/:tx_id`

**Authentication:** Required

**Response:**
```json
{
  "success": true,
  "data": {
    "tx_id": "uuid",
    "chain": "ETH",
    "tx_hash": "0xabc...",
    "direction": "outgoing",
    "status": "confirmed",
    "amount": "1.0",
    "amount_usd": "2190.00",
    "from_address": "0xmywallet...",
    "to_address": "0xrecipient...",
    "fee_amount": "0.003",
    "fee_currency": "ETH",
    "fee_usd": "6.57",
    "confirmations": 50,
    "block_number": 18500100,
    "block_timestamp": "2024-01-15T12:00:00.000Z",
    "metadata": {
      "note": "Payment for services"
    },
    "created_at": "2024-01-15T11:55:00.000Z",
    "updated_at": "2024-01-15T12:05:00.000Z"
  }
}
```

---

## 6. Send Transaction Endpoints

### 6.1 Prepare Transaction

Build an unsigned transaction for client signing.

**Endpoint:** `POST /api/web-wallet/:wallet_id/prepare-tx`

**Authentication:** Required

**Request Body:**
```json
{
  "chain": "ETH",
  "from_address": "0xmywallet...",
  "to_address": "0xrecipient...",
  "amount": "1.0",
  "token_address": null,
  "fee_priority": "medium",
  "metadata": {
    "note": "Payment for services"
  }
}
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `chain` | string | Yes | Blockchain identifier |
| `from_address` | string | Yes | Sender address (must belong to wallet) |
| `to_address` | string | Yes | Recipient address |
| `amount` | string | Yes | Amount to send |
| `token_address` | string | No | Token contract for token transfers |
| `fee_priority` | string | No | low, medium, high (default: medium) |
| `metadata` | object | No | Custom metadata |

**Response:**
```json
{
  "success": true,
  "data": {
    "unsigned_tx": {
      "chain": "ETH",
      "type": "eip1559",
      "to": "0xrecipient...",
      "value": "1000000000000000000",
      "data": "0x",
      "nonce": 42,
      "chainId": 1,
      "maxFeePerGas": "50000000000",
      "maxPriorityFeePerGas": "2000000000",
      "gasLimit": "21000"
    },
    "fee_estimate": {
      "gas_limit": "21000",
      "gas_price": "50 gwei",
      "fee_amount": "0.00105",
      "fee_currency": "ETH",
      "fee_usd": "2.30"
    },
    "expires_at": "2024-01-15T12:10:00.000Z",
    "prepare_id": "uuid-prepare-id"
  }
}
```

**Notes:**
- Transaction is not signed - client must sign locally
- `prepare_id` is used to track the prepared transaction
- Prepared transaction expires after 5 minutes

---

### 6.2 Broadcast Transaction

Submit a signed transaction for broadcasting.

**Endpoint:** `POST /api/web-wallet/:wallet_id/broadcast`

**Authentication:** Required

**Request Body:**
```json
{
  "prepare_id": "uuid-prepare-id",
  "signed_tx": "0xf86c...",
  "chain": "ETH"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "tx_id": "uuid-tx-id",
    "tx_hash": "0xabc123...",
    "chain": "ETH",
    "status": "pending",
    "broadcast_at": "2024-01-15T12:05:00.000Z"
  }
}
```

**Error Response (Invalid Signature):**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_SIGNATURE",
    "message": "Transaction signature is invalid",
    "details": {
      "expected_signer": "0xmywallet...",
      "actual_signer": "0xother..."
    }
  }
}
```

---

### 6.3 Estimate Fee

Get fee estimate without preparing full transaction.

**Endpoint:** `POST /api/web-wallet/:wallet_id/estimate-fee`

**Authentication:** Required

**Request Body:**
```json
{
  "chain": "ETH",
  "from_address": "0xmywallet...",
  "to_address": "0xrecipient...",
  "amount": "1.0",
  "token_address": null
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "estimates": {
      "low": {
        "gas_price": "30 gwei",
        "fee_amount": "0.00063",
        "fee_usd": "1.38",
        "estimated_time": "5-10 minutes"
      },
      "medium": {
        "gas_price": "50 gwei",
        "fee_amount": "0.00105",
        "fee_usd": "2.30",
        "estimated_time": "1-3 minutes"
      },
      "high": {
        "gas_price": "80 gwei",
        "fee_amount": "0.00168",
        "fee_usd": "3.68",
        "estimated_time": "< 1 minute"
      }
    },
    "gas_limit": "21000",
    "chain": "ETH"
  }
}
```

---

## 7. Authentication Endpoints

### 7.1 Request Challenge

Get a challenge for signature-based authentication.

**Endpoint:** `GET /api/web-wallet/auth/challenge`

**Authentication:** None required

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `wallet_id` | string | Yes | Wallet UUID |

**Response:**
```json
{
  "success": true,
  "data": {
    "challenge": "coinpayportal:auth:1705320000:abc123random",
    "expires_at": "2024-01-15T12:05:00.000Z",
    "challenge_id": "uuid-challenge-id"
  }
}
```

---

### 7.2 Verify Signature

Verify signature and get auth token.

**Endpoint:** `POST /api/web-wallet/auth/verify`

**Authentication:** None required

**Request Body:**
```json
{
  "wallet_id": "uuid-wallet-id",
  "challenge_id": "uuid-challenge-id",
  "signature": "hex_encoded_signature",
  "public_key_type": "secp256k1"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "auth_token": "jwt_token_here",
    "expires_at": "2024-01-15T13:00:00.000Z",
    "wallet_id": "uuid-wallet-id"
  }
}
```

**Notes:**
- Auth token is valid for 1 hour
- Can be used in Authorization header for subsequent requests
- Alternative to per-request signature authentication

---

## 8. Settings Endpoints

### 8.1 Get Settings

Get wallet security settings.

**Endpoint:** `GET /api/web-wallet/:wallet_id/settings`

**Authentication:** Required

**Response:**
```json
{
  "success": true,
  "data": {
    "daily_spend_limit": "10.0",
    "daily_spend_limit_usd": "21900.00",
    "daily_spent": "2.5",
    "daily_spent_usd": "5475.00",
    "whitelist_enabled": true,
    "whitelist_addresses": [
      "0xallowed1...",
      "0xallowed2..."
    ],
    "require_confirmation": false,
    "confirmation_delay_seconds": 0
  }
}
```

---

### 8.2 Update Settings

Update wallet security settings.

**Endpoint:** `PATCH /api/web-wallet/:wallet_id/settings`

**Authentication:** Required

**Request Body:**
```json
{
  "daily_spend_limit": "5.0",
  "whitelist_enabled": true,
  "whitelist_addresses": [
    "0xallowed1...",
    "0xallowed2...",
    "0xallowed3..."
  ],
  "require_confirmation": true,
  "confirmation_delay_seconds": 300
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "updated": true,
    "settings": {
      "daily_spend_limit": "5.0",
      "whitelist_enabled": true,
      "whitelist_addresses": ["0xallowed1...", "0xallowed2...", "0xallowed3..."],
      "require_confirmation": true,
      "confirmation_delay_seconds": 300
    }
  }
}
```

---

## 9. Rate Limiting

### Rate Limits by Endpoint

| Endpoint Category | Rate Limit | Window |
|-------------------|------------|--------|
| Wallet creation | 5 requests | 1 hour |
| Auth challenges | 10 requests | 1 minute |
| Balance queries | 60 requests | 1 minute |
| Transaction history | 30 requests | 1 minute |
| Prepare transaction | 20 requests | 1 minute |
| Broadcast transaction | 10 requests | 1 minute |

### Rate Limit Headers

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1705320060
```

### Rate Limit Error

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please try again later.",
    "details": {
      "limit": 60,
      "window": "1 minute",
      "retry_after": 45
    }
  }
}
```

---

## 10. Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `WALLET_NOT_FOUND` | 404 | Wallet does not exist |
| `ADDRESS_NOT_FOUND` | 404 | Address does not exist |
| `TRANSACTION_NOT_FOUND` | 404 | Transaction does not exist |
| `INVALID_SIGNATURE` | 401 | Signature verification failed |
| `AUTH_EXPIRED` | 401 | Auth token or challenge expired |
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `FORBIDDEN` | 403 | Action not allowed |
| `INVALID_ADDRESS` | 400 | Invalid blockchain address format |
| `INVALID_CHAIN` | 400 | Unsupported blockchain |
| `INSUFFICIENT_BALANCE` | 400 | Not enough funds |
| `SPEND_LIMIT_EXCEEDED` | 400 | Daily spend limit reached |
| `WHITELIST_VIOLATION` | 400 | Recipient not in whitelist |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `BLOCKCHAIN_ERROR` | 502 | Blockchain RPC error |
| `INTERNAL_ERROR` | 500 | Server error |

---

## 11. Webhook Events (Optional)

Wallets can optionally register for webhook notifications.

### 11.1 Register Webhook

**Endpoint:** `POST /api/web-wallet/:wallet_id/webhooks`

**Request Body:**
```json
{
  "url": "https://myserver.com/wallet-webhook",
  "events": ["transaction.incoming", "transaction.confirmed"],
  "secret": "my_webhook_secret"
}
```

### 11.2 Webhook Events

| Event | Description |
|-------|-------------|
| `transaction.incoming` | New incoming transaction detected |
| `transaction.confirmed` | Transaction reached confirmation threshold |
| `transaction.failed` | Transaction failed |
| `balance.changed` | Balance changed significantly |

### 11.3 Webhook Payload

```json
{
  "event": "transaction.incoming",
  "wallet_id": "uuid",
  "data": {
    "tx_hash": "0x...",
    "chain": "ETH",
    "amount": "1.0",
    "from_address": "0x...",
    "to_address": "0x...",
    "confirmations": 1
  },
  "timestamp": "2024-01-15T12:00:00.000Z"
}
```
