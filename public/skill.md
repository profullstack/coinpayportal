---
name: coinpayportal
version: 3.0.0
description: Payments, escrow, and a non-custodial browser wallet for AI agents. Send, receive, and hold funds in escrow across BTC, ETH, SOL, POL, BCH, and USDC.
homepage: https://coinpayportal.com
---

```bash
curl -s https://coinpayportal.com/skill.md
```

# CoinPayPortal — Payments, Escrow & Wallets

Crypto infrastructure for AI agents and humans. Create wallets, send payments, hold funds in escrow, and receive payments across BTC, ETH, SOL, POL, BCH, and USDC — no KYC required.

**Custody differs by product — do not assume non-custodial across the board:**

| Product | Who can move funds |
|---------|--------------------|
| Web wallet (this API) | You only — keys are generated client-side and never sent to us |
| On-chain payments | CoinPay holds the receiving key until the balance is forwarded to the merchant |
| Escrow, `custodial` (default) | CoinPay, for the whole escrow window |
| Escrow, `multisig_2of3` | Any 2 of depositor / beneficiary / CoinPay — CoinPay cannot act alone. **Gated behind a server feature flag and may be disabled** |
| Lightning | CoinPay, until withdrawn on-chain |

**Check before relying on multisig.** `POST /api/escrow/multisig` returns `503
{"error":"Multisig escrow is not enabled"}` when the flag is off, and it is off by
default. Query `GET /api/escrow/model-availability` first — it returns
`multisig_enabled`, `multisig_default`, and the supported `multisig_chains`.
Multisig covers native coins only (BTC, LTC, DOGE, ETH, POL, BASE, ARB, OP, BNB,
AVAX, SOL) — **no USDC/USDT** — and cannot be used for recurring escrow series.

If an agent is holding value it cannot afford to lose to counterparty risk and
multisig is unavailable, do not use escrow for it — withdraw to a self-held
wallet instead. An escrow created without `multisig_2of3` is custodial, full stop.
Full disclosure, including shutdown and dispute handling:
https://coinpayportal.com/custody

**Base URL:** `https://coinpayportal.com/api/web-wallet`
**npm:** `@profullstack/coinpay`

## SDK Installation

```bash
npm install @profullstack/coinpay
# or
pnpm add @profullstack/coinpay
```

```typescript
import { CoinPaySDK } from '@profullstack/coinpay';

const sdk = new CoinPaySDK({
  baseUrl: 'https://coinpayportal.com',
  apiKey: 'your-api-key' // for merchant API
});

// Create a payment
const payment = await sdk.createPayment({
  cryptocurrency: 'ETH',
  amount_usd: 100,
  metadata: { orderId: '123' }
});
```

The SDK provides typed interfaces for the merchant payment API. For the web-wallet API (non-custodial), use the REST endpoints below.

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
Authorization: Wallet <wallet_id>:<signature>:<timestamp>:<nonce>
```

**Message to sign:** `{METHOD}:{PATH}:{UNIX_TIMESTAMP}:{NONCE}:{BODY}`

Every field must match the request exactly: the HTTP method, the URL path (with query string if present), the UNIX timestamp in seconds from the header, the nonce from the header, and the raw request body bytes (empty string for GET/DELETE). The body is included as-is — do not format or re-serialize it.

Example with nonce: `GET:/api/web-wallet/abc123/balances:1706432100:kX9fQ2mZ:`

The nonce is optional for backwards compatibility. If you omit it, sign the 4-field message `{METHOD}:{PATH}:{UNIX_TIMESTAMP}:{BODY}` and send `Wallet <wallet_id>:<signature>:<timestamp>` (3 fields). Note that a request tuple (`wallet_id`, `signature`, `timestamp`, `nonce`) is single-use — the server rejects replays, so concurrent requests within the same second MUST use distinct nonces (a random string works).

**Hashing (mandatory):** SHA-256 the message bytes first, then sign the 32-byte digest with secp256k1. The server verifies against the raw message with SHA-256 prehashing (the same behavior as `@noble/curves` v2 defaults: `secp256k1.verify` hashes internally unless `prehash: false` is passed). Signing the raw message without hashing will produce `401 {"code":"UNAUTHORIZED","message":"Invalid signature"}`.

**Low-S signatures (mandatory):** the signature must be low-S, i.e. `s <= n/2` where `n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141`. If your library produces high-S values, normalize with `s' = n - s` before hex-encoding. `@noble/curves`, ethers v6 and viem normalize automatically; raw libraries (e.g. Python `ecdsa`) do not. High-S signatures are rejected with the same `401 Invalid signature`.

Hex-encode the 64-byte compact signature (`r || s`) in the header.

**Timestamp window:** the server accepts timestamps within 300 seconds of its own clock (±5 min window) — keep your clock in sync.

**Body must match the wire:** for POST/PUT/PATCH the signed message body must be byte-identical to the body you send. Build the message from the same string you pass to your HTTP client.

### 3. Check Balances

```bash
curl https://coinpayportal.com/api/web-wallet/<wallet_id>/balances \
  -H "Authorization: Wallet <wallet_id>:<signature>:<timestamp>:<nonce>"
```

Response:
```json
{
  "success": true,
  "data": {
    "balances": [
      { "chain": "BTC", "address": "1...", "balance": "0.01", "updatedAt": "..." },
      { "chain": "ETH", "address": "0x...", "balance": "1.5", "updatedAt": "..." }
    ]
  }
}
```

### 4. Send a Transaction

Three-step flow: **prepare** (server) → **sign** (local) → **broadcast** (server).

**Step 1 — Prepare:**
```bash
curl -X POST https://coinpayportal.com/api/web-wallet/<wallet_id>/prepare-tx \
  -H "Authorization: Wallet <wallet_id>:<sig>:<ts>:<nonce>" \
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
  -H "Authorization: Wallet <wallet_id>:<sig>:<ts>:<nonce>" \
  -H "Content-Type: application/json" \
  -d '{
    "tx_id": "<from-prepare>",
    "signed_tx": "0x<signed-hex>",
    "chain": "ETH"
  }'
```

Returns `tx_hash`, `explorer_url`, and initial `status` ("confirming").

### 5. Sync On-Chain History

Pull external deposits and update transaction confirmations from the blockchain:

```bash
curl -X POST https://coinpayportal.com/api/web-wallet/<wallet_id>/sync-history \
  -H "Authorization: Wallet <wallet_id>:<sig>:<ts>:<nonce>" \
  -H "Content-Type: application/json" \
  -d '{ "chain": "BTC" }'
```

Omit `chain` to sync all chains. Indexed transactions are marked with `metadata.source: "indexer"`.

A background daemon also runs server-side, automatically finalizing pending/confirming transactions every 15 seconds — so transactions will update even if the client disconnects.

### 6. Webhooks

Register a webhook URL to get notified of transaction status changes:

```bash
curl -X PATCH https://coinpayportal.com/api/web-wallet/<wallet_id>/settings \
  -H "Authorization: Wallet <wallet_id>:<sig>:<ts>:<nonce>" \
  -H "Content-Type: application/json" \
  -d '{ "webhook_url": "https://your-server.com/webhook" }'
```

## Supported Chains

| Chain | Symbol | Address Format |
|-------|--------|----------------|
| Bitcoin | BTC | P2PKH, P2SH, Bech32 |
| Bitcoin Cash | BCH | CashAddr, Legacy |
| Ethereum | ETH | 0x + 40 hex |
| Polygon | POL | 0x + 40 hex |
| Solana | SOL | Base58 |
| USDC (Ethereum) | USDC_ETH | 0x + 40 hex |
| USDC (Polygon) | USDC_POL | 0x + 40 hex |
| USDC (Solana) | USDC_SOL | Base58 |

## All Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/web-wallet/create` | POST | No | Create wallet |
| `/api/web-wallet/import` | POST | No | Import wallet with proof |
| `/api/web-wallet/auth/challenge` | GET | No | Get auth challenge |
| `/api/web-wallet/auth/verify` | POST | No | Verify → JWT token |
| `/api/web-wallet/:id` | GET | Yes | Get wallet info |
| `/api/web-wallet/:id/addresses` | GET | Yes | List addresses (filter by `?chain=`) |
| `/api/web-wallet/:id/derive` | POST | Yes | Derive new address |
| `/api/web-wallet/:id/balances` | GET | Yes | Get all balances (`?chain=&refresh=true`) |
| `/api/web-wallet/:id/transactions` | GET | Yes | Transaction history (`?chain=&direction=&status=&limit=&offset=`) |
| `/api/web-wallet/:id/transactions/:txid` | GET | Yes | Transaction detail (by UUID or tx_hash) |
| `/api/web-wallet/:id/prepare-tx` | POST | Yes | Prepare unsigned tx |
| `/api/web-wallet/:id/estimate-fee` | POST | Yes | Fee estimates (low/medium/high) |
| `/api/web-wallet/:id/broadcast` | POST | Yes | Broadcast signed tx |
| `/api/web-wallet/:id/sync-history` | POST | Yes | Sync on-chain tx history |
| `/api/web-wallet/:id/settings` | GET/PATCH | Yes | Wallet settings (webhook_url, etc.) |
| `/api/web-wallet/:id/webhooks` | GET | Yes | List webhook deliveries |

## Transaction Lifecycle

1. **Prepare** → creates a `pending` record with `unsigned_tx`
2. **Sign** → done client-side with your private key
3. **Broadcast** → sends to blockchain, status becomes `confirming`
4. **Finalization** → background daemon checks on-chain confirmations every 15s, updates to `confirmed` or `failed`

Transactions are also synced from the blockchain via the indexer — external deposits you receive will appear in your history automatically.

### Transaction Statuses

| Status | Meaning |
|--------|---------|
| `pending` | Prepared but not yet broadcast |
| `confirming` | Broadcast, waiting for confirmations |
| `confirmed` | Enough confirmations (varies by chain) |
| `failed` | Reverted on-chain or broadcast error |

### Required Confirmations

| Chain | Confirmations |
|-------|--------------|
| BTC | 3 |
| BCH | 6 |
| ETH / USDC_ETH | 12 |
| POL / USDC_POL | 128 |
| SOL / USDC_SOL | 32 |

## CLI

The wallet CLI provides command-line access to all wallet operations:

```bash
# Install / setup
cd coinpayportal
echo '{ "apiUrl": "https://coinpayportal.com" }' > ~/.coinpayrc.json

# Create a new wallet (outputs wallet_id + mnemonic)
pnpm coinpay-wallet create --words 12 --chains BTC,ETH,SOL

# Import from mnemonic
pnpm coinpay-wallet import "word1 word2 ... word12" --chains BTC,ETH,SOL,POL,BCH

# Check balances
pnpm coinpay-wallet balance <wallet-id>

# List addresses
pnpm coinpay-wallet address <wallet-id> --chain ETH

# Send transaction
pnpm coinpay-wallet send <wallet-id> \
  --from 0xYourAddr --to 0xRecipient --chain ETH --amount 0.1 --priority medium

# Transaction history
pnpm coinpay-wallet history <wallet-id> --chain BTC --limit 10

# Sync on-chain deposits
pnpm coinpay-wallet sync <wallet-id> --chain SOL
```

**Environment variables:**
- `COINPAY_API_URL` — API base URL (default: `http://localhost:8080`)
- `COINPAY_AUTH_TOKEN` — JWT token for read-only operations
- `COINPAY_MNEMONIC` — Mnemonic phrase (required for `send`)

## Escrow Service

Create trustless escrows to hold funds until both parties are satisfied. No accounts required — authentication uses unique tokens.

### Create Escrow

```bash
curl -X POST https://coinpayportal.com/api/escrow \
  -H "Content-Type: application/json" \
  -d '{
    "chain": "ETH",
    "amount": 0.5,
    "depositor_address": "0xAlice...",
    "beneficiary_address": "0xBob...",
    "expires_in_hours": 48
  }'
```

Response:
```json
{
  "id": "uuid",
  "escrow_address": "0xDeposit...",
  "status": "created",
  "release_token": "esc_abc123...",
  "beneficiary_token": "esc_def456...",
  "amount": 0.5,
  "fee_amount": 0.005,
  "expires_at": "2024-01-03T12:00:00Z"
}
```

Save both tokens — they are only returned once. Depositor gets `release_token`, beneficiary gets `beneficiary_token`.

### Escrow Flow

1. **Create** → get deposit address + tokens
2. **Fund** → depositor sends crypto to `escrow_address` (auto-detected)
3. **Release** → depositor calls release, funds forwarded to beneficiary minus fee
4. **OR Refund** → depositor calls refund, full amount returned (no fee)
5. **OR Dispute** → either party opens dispute

### Escrow Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/escrow` | POST | Optional | Create escrow |
| `/api/escrow` | GET | Optional | List escrows (requires filter) |
| `/api/escrow/:id` | GET | No | Get escrow details |
| `/api/escrow/:id/release` | POST | Token | Release funds to beneficiary |
| `/api/escrow/:id/refund` | POST | Token | Refund to depositor (no fee) |
| `/api/escrow/:id/dispute` | POST | Token | Open dispute |
| `/api/escrow/:id/events` | GET | No | Audit log |

### Release Funds

```bash
curl -X POST https://coinpayportal.com/api/escrow/<id>/release \
  -H "Content-Type: application/json" \
  -d '{ "release_token": "esc_abc123..." }'
```

### Refund

```bash
curl -X POST https://coinpayportal.com/api/escrow/<id>/refund \
  -H "Content-Type: application/json" \
  -d '{ "release_token": "esc_abc123..." }'
```

### Dispute

```bash
curl -X POST https://coinpayportal.com/api/escrow/<id>/dispute \
  -H "Content-Type: application/json" \
  -d '{
    "token": "esc_def456...",
    "reason": "Work not delivered as agreed"
  }'
```

### Escrow Statuses

| Status | Meaning |
|--------|---------|
| `created` | Awaiting deposit |
| `funded` | Deposit received on-chain |
| `released` | Depositor approved release |
| `settled` | Funds forwarded to beneficiary |
| `disputed` | Dispute opened |
| `refunded` | Funds returned to depositor |
| `expired` | Deposit window expired |

### Escrow SDK

```typescript
const escrow = await client.createEscrow({
  chain: 'SOL', amount: 10,
  depositor_address: 'Alice...',
  beneficiary_address: 'Bob...',
});

// Release
await client.releaseEscrow(escrow.id, escrow.release_token);

// Refund
await client.refundEscrow(escrow.id, escrow.release_token);

// Wait for settlement
const settled = await client.waitForEscrow(escrow.id, 'settled');
```

### Escrow CLI

```bash
coinpay escrow create --chain SOL --amount 10 \
  --depositor Alice... --beneficiary Bob...
coinpay escrow get <id>
coinpay escrow list --status funded
coinpay escrow release <id> --token esc_abc...
coinpay escrow refund <id> --token esc_abc...
coinpay escrow dispute <id> --token esc_def... --reason "..."
coinpay escrow events <id>
```

### Fees

- **Free tier:** 1% on release
- **Professional:** 0.5% on release
- **Refunds:** No fee

## Business Accounts (for AI Agents)

AI agents can create business accounts to get reduced escrow fees (0.5% vs 1%) and track payments/escrows in one place.

### Create Business

```bash
curl -X POST https://coinpayportal.com/api/businesses \
  -H "x-api-key: <your-api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "RiotCoder Services",
    "description": "AI coding agent — code review and bug fixes",
    "webhook_url": "https://your-server.com/webhook"
  }'
```

Returns business `id` and `api_key`. Use the `business_id` when creating escrows for the reduced fee rate.

### List Businesses

```bash
curl https://coinpayportal.com/api/businesses \
  -H "x-api-key: <your-api-key>"
```

### Create Escrow with Business

```bash
curl -X POST https://coinpayportal.com/api/escrow \
  -H "x-api-key: <your-api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "chain": "SOL",
    "amount": 10,
    "depositor_address": "Alice...",
    "beneficiary_address": "Bob...",
    "business_id": "<your-business-id>"
  }'
```

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| Create/Import | 5/hour |
| Auth | 10/min |
| Balances | 60/min |
| Prepare TX | 20/min |
| Broadcast | 10/min |
| Fee Estimate | 60/min |
| Sync History | 10/min |
| Settings | 30/min |

## Key Principles

- **Non-custodial (this web-wallet API)**: Your private keys never touch our servers. Note this applies to the web wallet documented here — escrow and Lightning are custodial, see the custody table above
- **Anonymous**: No email, no KYC — your seed phrase is your identity
- **Multi-chain**: 8 assets across 5 blockchains
- **Signature auth**: Every request is signed with your key (nonce prevents replay)
- **API-first**: Built for programmatic access by AI agents
- **Background finalization**: Daemon confirms transactions even if the client disconnects
- **On-chain indexing**: External deposits are automatically detected and indexed
