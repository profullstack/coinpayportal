# Web Wallet API Reference

The CoinPay Web Wallet is a **non-custodial** multi-chain wallet. Private keys never leave the client. The server stores only public keys and coordinates transactions.

**Base URL:** `https://coinpayportal.com/api/web-wallet`

---

## Authentication Flow

The Web Wallet uses **signature-based authentication** — no passwords:

```
1. Client → GET /auth/challenge?wallet_id=<uuid>
2. Server → Returns { challenge, challenge_id, expires_at }
3. Client signs the challenge with their private key
4. Client → POST /auth/verify { wallet_id, challenge_id, signature }
5. Server → Returns { token } (JWT valid for 24h)
```

All subsequent requests include: `Authorization: Bearer <wallet_jwt>`

---

## Rate Limits

| Endpoint Category | Limit |
|-------------------|-------|
| Wallet creation | 5/hour per IP |
| Auth challenge/verify | 10/minute per IP |
| Balance queries | 60/minute per IP |
| Transaction preparation | 20/minute per IP |
| Broadcast | 10/minute per IP |
| Fee estimation | 60/minute per IP |
| Transaction history | 30/minute per IP |
| Settings | 30/minute per IP |

When rate limited, responses include:
```json
{
  "ok": false,
  "code": "RATE_LIMITED",
  "error": "Rate limited",
  "retry_after": 45
}
```

---

## Supported Chains

| Chain Code | Network | Address Format |
|------------|---------|----------------|
| `BTC` | Bitcoin mainnet | bc1q... / 1... / 3... |
| `BCH` | Bitcoin Cash mainnet | bitcoincash:q... |
| `ETH` | Ethereum mainnet | 0x... |
| `POL` | Polygon mainnet | 0x... |
| `SOL` | Solana mainnet | Base58 |
| `USDC_ETH` | USDC on Ethereum | 0x... |
| `USDC_POL` | USDC on Polygon | 0x... |
| `USDC_SOL` | USDC on Solana | Base58 |

---

## Endpoints

### POST /api/web-wallet/create

Register a new wallet. The client generates the seed phrase and HD keys locally, then sends only public keys.

> **💡 Auto-derive all chains:** Include `initial_addresses` for all 8 supported chains. Addresses are ready immediately — no separate `/derive` calls needed. The SDK does this automatically.

**Auth required:** No  
**Rate limit:** 5/hour per IP

**Request:**
```json
{
  "public_key_secp256k1": "04a1b2c3d4...",
  "public_key_ed25519": "abc123...",
  "initial_addresses": [
    { "chain": "BTC", "address": "bc1q...", "derivation_path": "m/44'/0'/0'/0/0" },
    { "chain": "BCH", "address": "bitcoincash:q...", "derivation_path": "m/44'/145'/0'/0/0" },
    { "chain": "ETH", "address": "0x...", "derivation_path": "m/44'/60'/0'/0/0" },
    { "chain": "POL", "address": "0x...", "derivation_path": "m/44'/60'/0'/0/0" },
    { "chain": "SOL", "address": "ABC...", "derivation_path": "m/44'/501'/0'/0'" },
    { "chain": "USDC_ETH", "address": "0x...", "derivation_path": "m/44'/60'/0'/0/0" },
    { "chain": "USDC_POL", "address": "0x...", "derivation_path": "m/44'/60'/0'/0/0" },
    { "chain": "USDC_SOL", "address": "ABC...", "derivation_path": "m/44'/501'/0'/0'" }
  ]
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `identity_public_key` | string | ✅ | Master public key for wallet identity |
| `label` | string | ❌ | Human-friendly wallet name |
| `addresses` | array | ✅ | Initial addresses (at least one) |
| `addresses[].chain` | string | ✅ | Chain code (see supported chains) |
| `addresses[].address` | string | ✅ | Derived address |
| `addresses[].public_key` | string | ✅ | Public key for this address |
| `addresses[].derivation_path` | string | ✅ | BIP44 derivation path |

**Response (201):**
```json
{
  "ok": true,
  "data": {
    "wallet_id": "550e8400-e29b-41d4-a716-446655440000",
    "label": "My Wallet",
    "status": "active",
    "created_at": "2025-01-15T10:30:00.000Z",
    "addresses": [
      {
        "id": "addr_123",
        "chain": "BTC",
        "address": "bc1qxy2kgdygjrs...",
        "is_active": true
      }
    ]
  }
}
```

**Errors:**
| Code | When |
|------|------|
| `VALIDATION_ERROR` | Missing or invalid fields |
| `INVALID_KEY` | Invalid public key format |
| `INVALID_ADDRESS` | Address doesn't match public key |
| `INVALID_DERIVATION_PATH` | Bad derivation path |
| `DUPLICATE_KEY` | Public key already registered |

---

### POST /api/web-wallet/import

Import an existing wallet with proof of ownership.

**Auth required:** No  
**Rate limit:** 5/hour per IP

**Request:**
```json
{
  "identity_public_key": "04a1b2c3d4...",
  "proof_signature": "3045022100...",
  "proof_message": "CoinPay wallet import: 2025-01-15T10:30:00Z",
  "label": "Imported Wallet",
  "addresses": [
    {
      "chain": "ETH",
      "address": "0x...",
      "public_key": "04...",
      "derivation_path": "m/44'/60'/0'/0/0"
    }
  ]
}
```

**Response (201):** Same shape as `/create`.

---

### GET /api/web-wallet/auth/challenge

Request an authentication challenge.

**Auth required:** No  
**Rate limit:** 10/minute per IP

**Query Parameters:**
| Param | Type | Required |
|-------|------|----------|
| `wallet_id` | string (UUID) | ✅ |

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "challenge_id": "ch_123",
    "challenge": "coinpay:auth:550e8400...:1705312500:a1b2c3d4e5f6",
    "expires_at": "2025-01-15T10:35:00.000Z"
  }
}
```

---

### POST /api/web-wallet/auth/verify

Verify a signed challenge and receive a JWT.

**Auth required:** No  
**Rate limit:** 10/minute per IP

**Request:**
```json
{
  "wallet_id": "550e8400-e29b-41d4-a716-446655440000",
  "challenge_id": "ch_123",
  "signature": "3045022100..."
}
```

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "expires_at": "2025-01-16T10:30:00.000Z",
    "wallet_id": "550e8400..."
  }
}
```

**Errors:**
| Code | When |
|------|------|
| `CHALLENGE_NOT_FOUND` | Invalid challenge_id |
| `AUTH_EXPIRED` | Challenge expired |
| `INVALID_SIGNATURE` | Signature verification failed |
| `CHALLENGE_USED` | Challenge already consumed |
| `WALLET_INACTIVE` | Wallet is deactivated |

---

### GET /api/web-wallet/:id

Get wallet info.

**Auth required:** Yes (Wallet JWT)

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "wallet_id": "550e8400...",
    "label": "My Wallet",
    "status": "active",
    "created_at": "2025-01-15T10:30:00.000Z",
    "address_count": 3,
    "chains": ["BTC", "ETH", "SOL"]
  }
}
```

---

### POST /api/web-wallet/:id/derive

Derive an **additional** address for a chain. Not needed after wallet creation — initial addresses are auto-generated for all chains. Use this to create fresh receive addresses (e.g. for BTC privacy).

**Auth required:** Yes (Wallet JWT)

**Request:**
```json
{
  "chain": "ETH",
  "address": "0xnewaddress...",
  "public_key": "04...",
  "derivation_path": "m/44'/60'/0'/0/1"
}
```

**Response (201):**
```json
{
  "ok": true,
  "data": {
    "address_id": "addr_456",
    "chain": "ETH",
    "address": "0xnewaddress...",
    "is_active": true
  }
}
```

---

### GET /api/web-wallet/:id/addresses

List all addresses for the wallet.

**Auth required:** Yes (Wallet JWT)

**Query Parameters:**
| Param | Type | Notes |
|-------|------|-------|
| `chain` | string | Filter by chain |
| `active_only` | boolean | Only active addresses |

**Response (200):**
```json
{
  "ok": true,
  "data": [
    {
      "id": "addr_123",
      "chain": "BTC",
      "address": "bc1q...",
      "is_active": true,
      "created_at": "2025-01-15T10:30:00.000Z"
    },
    {
      "id": "addr_456",
      "chain": "ETH",
      "address": "0x...",
      "is_active": true,
      "created_at": "2025-01-15T10:35:00.000Z"
    }
  ]
}
```

---

### GET /api/web-wallet/:id/balances

Get balances for all active addresses.

**Auth required:** Yes (Wallet JWT)  
**Rate limit:** 60/minute per IP

**Query Parameters:**
| Param | Type | Notes |
|-------|------|-------|
| `chain` | string | Filter by chain |
| `refresh` | boolean | Force blockchain refresh |

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "balances": [
      {
        "chain": "BTC",
        "address": "bc1q...",
        "balance": "0.05423",
        "last_updated": "2025-01-15T10:30:00.000Z"
      },
      {
        "chain": "ETH",
        "address": "0x...",
        "balance": "1.234",
        "last_updated": "2025-01-15T10:30:00.000Z"
      }
    ]
  }
}
```

---

### GET /api/web-wallet/:id/balances/total-usd

Get total wallet balance converted to USD.

**Auth required:** Yes (Wallet JWT)  
**Rate limit:** 30/minute per IP

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "total_usd": 4523.67,
    "breakdown": [
      { "chain": "BTC", "balance": "0.054", "usd": 3510.00 },
      { "chain": "ETH", "balance": "1.234", "usd": 1013.67 }
    ],
    "rates_timestamp": "2025-01-15T10:30:00.000Z"
  }
}
```

---

### POST /api/web-wallet/:id/prepare-tx

Prepare an unsigned transaction for client-side signing.

**Auth required:** Yes (Wallet JWT)  
**Rate limit:** 20/minute per IP

**Request:**
```json
{
  "from_address": "0xSenderAddress...",
  "to_address": "0xRecipientAddress...",
  "chain": "ETH",
  "amount": "0.5",
  "priority": "medium"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `from_address` | string | ✅ | Must belong to this wallet |
| `to_address` | string | ✅ | Recipient address |
| `chain` | string | ✅ | Target chain |
| `amount` | string | ✅ | Amount in native units |
| `priority` | string | ❌ | `low`, `medium` (default), `high` |

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "tx_id": "tx_789",
    "unsigned_tx": "0x02f8...",
    "chain": "ETH",
    "estimated_fee": "0.002",
    "expires_at": "2025-01-15T10:45:00.000Z"
  }
}
```

> 📝 The `unsigned_tx` must be signed client-side and submitted via `/broadcast`.

**Errors:**
| Code | When |
|------|------|
| `SPEND_LIMIT_EXCEEDED` | Daily spend limit reached |
| `ADDRESS_NOT_WHITELISTED` | Whitelist enabled but address not on it |
| `INSUFFICIENT_BALANCE` | Not enough funds |

---

### POST /api/web-wallet/:id/broadcast

Broadcast a signed transaction.

**Auth required:** Yes (Wallet JWT)  
**Rate limit:** 10/minute per IP

**Request:**
```json
{
  "tx_id": "tx_789",
  "signed_tx": "0x02f8...",
  "chain": "ETH"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `tx_id` | string | ✅ | From prepare-tx response |
| `signed_tx` | string | ✅ | Hex (EVM/BTC) or base64 (SOL) |
| `chain` | string | ✅ | Must match prepare-tx chain |

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "tx_hash": "0xabc123...",
    "chain": "ETH",
    "status": "pending",
    "explorer_url": "https://etherscan.io/tx/0xabc123..."
  }
}
```

**Errors:**
| Code | When |
|------|------|
| `TX_NOT_FOUND` | Invalid tx_id |
| `TX_EXPIRED` | Prepared transaction expired |
| `TX_ALREADY_PROCESSED` | Transaction already broadcast |
| `BROADCAST_FAILED` | Network rejected transaction |

---

### POST /api/web-wallet/:id/estimate-fee

Get fee estimates for a chain.

**Auth required:** Yes (Wallet JWT)  
**Rate limit:** 60/minute per IP

**Request:**
```json
{
  "chain": "ETH"
}
```

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "chain": "ETH",
    "estimates": {
      "low": { "fee": "0.0005", "time_minutes": 15 },
      "medium": { "fee": "0.001", "time_minutes": 5 },
      "high": { "fee": "0.003", "time_minutes": 1 }
    }
  }
}
```

---

### GET /api/web-wallet/:id/transactions

Get transaction history.

**Auth required:** Yes (Wallet JWT)  
**Rate limit:** 30/minute per IP

**Query Parameters:**
| Param | Type | Notes |
|-------|------|-------|
| `chain` | string | Filter by chain |
| `direction` | string | `incoming` or `outgoing` |
| `status` | string | `pending`, `confirming`, `confirmed`, `failed` |
| `from_date` | string | ISO date |
| `to_date` | string | ISO date |
| `limit` | number | Default 50, max 100 |
| `offset` | number | Pagination offset |

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "transactions": [
      {
        "tx_hash": "0xabc...",
        "chain": "ETH",
        "direction": "outgoing",
        "from_address": "0xSender...",
        "to_address": "0xRecipient...",
        "amount": "0.5",
        "fee": "0.001",
        "status": "confirmed",
        "confirmations": 12,
        "created_at": "2025-01-15T10:30:00.000Z"
      }
    ],
    "total": 42,
    "limit": 50,
    "offset": 0
  }
}
```

---

### GET /api/web-wallet/:id/settings

Get wallet security settings.

**Auth required:** Yes (Wallet JWT)

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "daily_spend_limit": 1000.00,
    "whitelist_enabled": false,
    "whitelist_addresses": [],
    "require_confirmation": true,
    "confirmation_delay_seconds": 30
  }
}
```

---

### PATCH /api/web-wallet/:id/settings

Update wallet security settings.

**Auth required:** Yes (Wallet JWT)

**Request (all fields optional):**
```json
{
  "daily_spend_limit": 500.00,
  "whitelist_addresses": ["0xTrustedAddress1...", "0xTrustedAddress2..."],
  "whitelist_enabled": true,
  "require_confirmation": true,
  "confirmation_delay_seconds": 60
}
```

---

### POST /api/web-wallet/:id/webhooks

Register a webhook for wallet events.

**Auth required:** Yes (Wallet JWT)

**Request:**
```json
{
  "url": "https://myapp.com/webhooks/wallet",
  "events": ["transaction.incoming", "transaction.confirmed"]
}
```

**Available Events:**
| Event | Description |
|-------|-------------|
| `transaction.incoming` | New incoming transaction detected |
| `transaction.confirmed` | Transaction reached confirmation threshold |
| `transaction.outgoing` | Outgoing transaction broadcast |
| `balance.changed` | Balance updated |

**Response (201):**
```json
{
  "ok": true,
  "data": {
    "webhook_id": "wh_123",
    "url": "https://myapp.com/webhooks/wallet",
    "events": ["transaction.incoming", "transaction.confirmed"],
    "secret": "whsec_abc123...",
    "is_active": true
  }
}
```

> ⚠️ The `secret` is only shown once. Store it securely for signature verification.

---

### GET /api/web-wallet/:id/webhooks

List registered webhooks.

**Auth required:** Yes (Wallet JWT)

---

### DELETE /api/web-wallet/:id/webhooks/:webhook_id

Remove a webhook registration.

**Auth required:** Yes (Wallet JWT)
