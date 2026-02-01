---
name: coinpayportal
version: 1.0.0
description: Non-custodial multi-chain wallet for AI agents. Send and receive BTC, ETH, SOL, POL, BCH, and USDC.
homepage: https://coinpayportal.com
---

# CoinPayPortal Wallet SDK

Non-custodial multi-chain wallet for AI agents. Create wallets, check balances, send transactions, and receive payments across BTC, ETH, SOL, POL, BCH, and USDC — no KYC required.

**Base URL:** `https://coinpayportal.com/api/web-wallet`

## Quick Start

### 1. Create a Wallet

```bash
curl -X POST https://coinpayportal.com/api/web-wallet/create \
  -H "Content-Type: application/json" \
  -d '{
    "public_key_secp256k1": "<your-compressed-secp256k1-pubkey-hex>",
    "public_key_ed25519": "<your-ed25519-pubkey-base58>",
    "initial_addresses": [
      { "chain": "ETH", "address": "0x...", "derivation_path": "m/44'\'''/60'\'''/0'\'''/0/0" },
      { "chain": "SOL", "address": "...", "derivation_path": "m/44'\'''/501'\'''/0'\'''/0'\'''" }
    ]
  }'
```

Response:
```json
{
  "success": true,
  "data": {
    "wallet_id": "uuid-here",
    "created_at": "2024-01-01T00:00:00Z",
    "addresses": [{ "chain": "ETH", "address": "0x...", "derivation_index": 0 }]
  }
}
```

Save your `wallet_id` — you need it for all authenticated requests.

### 2. Authenticate Requests

Sign each request with your secp256k1 private key:

```
Authorization: Wallet <wallet_id>:<signature>:<timestamp>
```

**Message to sign:** `{METHOD}:{PATH}:{UNIX_TIMESTAMP}:{BODY}`

Example: `GET:/api/web-wallet/abc123/balances:1706432100:`

Sign the message bytes with secp256k1, hex-encode the 64-byte compact signature.

### 3. Check Balances

```bash
curl https://coinpayportal.com/api/web-wallet/<wallet_id>/balances \
  -H "Authorization: Wallet <wallet_id>:<signature>:<timestamp>"
```

Response:
```json
{
  "success": true,
  "data": {
    "balances": [
      { "chain": "ETH", "address": "0x...", "balance": "1.5", "updatedAt": "..." },
      { "chain": "BTC", "address": "1...", "balance": "0.01", "updatedAt": "..." }
    ]
  }
}
```

### 4. Send a Transaction

Three-step flow: **prepare** (server) -> **sign** (local) -> **broadcast** (server).

**Step 1 — Prepare:**
```bash
curl -X POST https://coinpayportal.com/api/web-wallet/<wallet_id>/prepare-tx \
  -H "Authorization: Wallet <wallet_id>:<sig>:<ts>" \
  -H "Content-Type: application/json" \
  -d '{
    "from_address": "0xYourAddress",
    "to_address": "0xRecipient",
    "chain": "ETH",
    "amount": "1000000000000000000",
    "priority": "medium"
  }'
```

Returns `tx_id` and `unsigned_tx` data.

**Step 2 — Sign locally** using your private key. Never send your private key to the server.

**Step 3 — Broadcast:**
```bash
curl -X POST https://coinpayportal.com/api/web-wallet/<wallet_id>/broadcast \
  -H "Authorization: Wallet <wallet_id>:<sig>:<ts>" \
  -H "Content-Type: application/json" \
  -d '{
    "tx_id": "<from-prepare>",
    "signed_tx": "0x<signed-hex>",
    "chain": "ETH"
  }'
```

Returns `tx_hash` and `explorer_url`.

## Supported Chains

| Chain | Symbol | Address Format |
|-------|--------|----------------|
| Bitcoin | BTC | P2PKH, P2SH, Bech32 |
| Bitcoin Cash | BCH | CashAddr, Legacy |
| Ethereum | ETH | 0x + 40 hex |
| Polygon | POL | 0x + 40 hex |
| Solana | SOL | Base58 |
| USDC (ETH) | USDC_ETH | 0x + 40 hex |
| USDC (POL) | USDC_POL | 0x + 40 hex |
| USDC (SOL) | USDC_SOL | Base58 |

## All Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/web-wallet/create` | POST | No | Create wallet |
| `/api/web-wallet/import` | POST | No | Import wallet with proof |
| `/api/web-wallet/auth/challenge` | GET | No | Get auth challenge |
| `/api/web-wallet/auth/verify` | POST | No | Verify -> JWT token |
| `/api/web-wallet/:id` | GET | Yes | Get wallet info |
| `/api/web-wallet/:id/addresses` | GET | Yes | List addresses |
| `/api/web-wallet/:id/derive` | POST | Yes | Derive new address |
| `/api/web-wallet/:id/balances` | GET | Yes | Get all balances |
| `/api/web-wallet/:id/transactions` | GET | Yes | Transaction history |
| `/api/web-wallet/:id/transactions/:txid` | GET | Yes | Transaction detail |
| `/api/web-wallet/:id/prepare-tx` | POST | Yes | Prepare unsigned tx |
| `/api/web-wallet/:id/estimate-fee` | POST | Yes | Fee estimates |
| `/api/web-wallet/:id/broadcast` | POST | Yes | Broadcast signed tx |
| `/api/web-wallet/:id/settings` | GET/PATCH | Yes | Wallet settings |

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| Create/Import | 5/hour |
| Auth | 10/min |
| Balances | 60/min |
| Prepare TX | 20/min |
| Broadcast | 10/min |
| Fee Estimate | 60/min |
| Settings | 30/min |

## Key Principles

- **Non-custodial**: Your private keys never touch our servers
- **Anonymous**: No email, no KYC — your seed phrase is your identity
- **Multi-chain**: 8 assets across 5 blockchains
- **Signature auth**: Every request is signed with your key
- **API-first**: Built for programmatic access
