# Lightning Network API Reference

The CoinPay Lightning API enables BOLT12 offer-based payments via Greenlight (CLN-as-a-service). Nodes are provisioned from the same BIP39 seed used for on-chain wallets.

**Base URL:** `https://coinpayportal.com/api/lightning`

---

## Overview

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/nodes` | POST | Provision a Greenlight CLN node |
| `/nodes/:id` | GET | Get node status |
| `/offers` | POST | Create a BOLT12 offer |
| `/offers/:id` | GET | Get offer details + QR URI |
| `/offers` | GET | List offers |
| `/payments` | GET | List Lightning payments |
| `/payments/:hash` | GET | Get payment by hash |

---

## Endpoints

### POST /api/lightning/nodes

Provision a Greenlight CLN node for a wallet. Derives the Lightning node identity from the wallet's BIP39 seed using derivation path `m/535'/0'`.

**Request:**
```json
{
  "wallet_id": "uuid",
  "business_id": "uuid (optional)",
  "mnemonic": "twelve word mnemonic phrase ..."
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "node": {
      "id": "uuid",
      "wallet_id": "uuid",
      "business_id": "uuid",
      "greenlight_node_id": "gl-abc123ef",
      "node_pubkey": "02abcdef...",
      "status": "active",
      "created_at": "2026-02-14T12:00:00.000Z",
      "updated_at": "2026-02-14T12:00:00.000Z"
    }
  },
  "timestamp": "2026-02-14T12:00:00.000Z"
}
```

**Errors:**
| Status | Code | Description |
|--------|------|-------------|
| 400 | VALIDATION_ERROR | `wallet_id` missing or invalid mnemonic |
| 500 | SERVER_ERROR | Node provisioning failed |

---

### GET /api/lightning/nodes/:id

Get Lightning node status.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "node": {
      "id": "uuid",
      "wallet_id": "uuid",
      "business_id": "uuid",
      "greenlight_node_id": "gl-abc123ef",
      "node_pubkey": "02abcdef...",
      "status": "active",
      "created_at": "2026-02-14T12:00:00.000Z",
      "updated_at": "2026-02-14T12:00:00.000Z"
    }
  },
  "timestamp": "2026-02-14T12:00:00.000Z"
}
```

**Errors:**
| Status | Code | Description |
|--------|------|-------------|
| 404 | NODE_NOT_FOUND | Node does not exist |

---

### POST /api/lightning/offers

Create a BOLT12 offer on a Greenlight node.

**Request:**
```json
{
  "node_id": "uuid",
  "business_id": "uuid (optional)",
  "description": "Coffee payment",
  "amount_msat": 100000,
  "currency": "BTC"
}
```

- `amount_msat` — Optional. Omit for "any amount" offers.
- `currency` — Defaults to `"BTC"`.

**Response (201):**
```json
{
  "success": true,
  "data": {
    "offer": {
      "id": "uuid",
      "node_id": "uuid",
      "business_id": "uuid",
      "bolt12_offer": "lno1...",
      "description": "Coffee payment",
      "amount_msat": 100000,
      "currency": "BTC",
      "status": "active",
      "total_received_msat": 0,
      "payment_count": 0,
      "last_payment_at": null,
      "metadata": {},
      "created_at": "2026-02-14T12:00:00.000Z"
    }
  },
  "timestamp": "2026-02-14T12:00:00.000Z"
}
```

**Errors:**
| Status | Code | Description |
|--------|------|-------------|
| 400 | VALIDATION_ERROR | `node_id` or `description` missing |
| 500 | SERVER_ERROR | Node not found, node inactive, or creation failed |

---

### GET /api/lightning/offers/:id

Get offer details including QR-ready URI.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "offer": { "..." },
    "qr_uri": "lightning:lno1..."
  },
  "timestamp": "2026-02-14T12:00:00.000Z"
}
```

**Errors:**
| Status | Code | Description |
|--------|------|-------------|
| 404 | OFFER_NOT_FOUND | Offer does not exist |

---

### GET /api/lightning/offers

List offers with optional filters.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `business_id` | string | Filter by business |
| `node_id` | string | Filter by node |
| `status` | string | Filter by status (`active`, `disabled`, `archived`) |
| `limit` | number | Max results (default 20) |
| `offset` | number | Pagination offset (default 0) |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "offers": [ "..." ],
    "total": 42,
    "limit": 20,
    "offset": 0
  },
  "timestamp": "2026-02-14T12:00:00.000Z"
}
```

---

### GET /api/lightning/payments

List Lightning payments.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `business_id` | string | Filter by business |
| `node_id` | string | Filter by node |
| `offer_id` | string | Filter by offer |
| `status` | string | Filter by status (`pending`, `settled`, `failed`) |
| `limit` | number | Max results (default 50) |
| `offset` | number | Pagination offset (default 0) |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "payments": [
      {
        "id": "uuid",
        "offer_id": "uuid",
        "node_id": "uuid",
        "business_id": "uuid",
        "payment_hash": "abc123...",
        "preimage": null,
        "amount_msat": 100000,
        "status": "settled",
        "payer_note": "Thanks!",
        "settled_at": "2026-02-14T12:05:00.000Z",
        "created_at": "2026-02-14T12:04:00.000Z"
      }
    ],
    "total": 1,
    "limit": 50,
    "offset": 0
  },
  "timestamp": "2026-02-14T12:00:00.000Z"
}
```

---

### GET /api/lightning/payments/:hash

Get a single payment by its payment hash.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "payment": {
      "id": "uuid",
      "payment_hash": "abc123...",
      "status": "settled",
      "amount_msat": 100000,
      "settled_at": "2026-02-14T12:05:00.000Z"
    }
  },
  "timestamp": "2026-02-14T12:00:00.000Z"
}
```

**Errors:**
| Status | Code | Description |
|--------|------|-------------|
| 404 | PAYMENT_NOT_FOUND | Payment hash not found |

---

## Error Response Format

All errors follow the standard wallet API format:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable description"
  },
  "timestamp": "2026-02-14T12:00:00.000Z"
}
```

## Node Status Values

| Status | Description |
|--------|-------------|
| `provisioning` | Node is being set up |
| `active` | Node is online and ready |
| `inactive` | Node has been deactivated |
| `error` | Provisioning or runtime error |

## Payment Status Values

| Status | Description |
|--------|-------------|
| `pending` | Invoice created, awaiting payment |
| `settled` | Payment received and confirmed |
| `failed` | Payment failed or expired |
