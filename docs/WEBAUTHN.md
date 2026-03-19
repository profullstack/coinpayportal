# WebAuthn / Passkeys

CoinPay supports passwordless authentication via WebAuthn (FIDO2) passkeys. Users can register hardware security keys, platform authenticators (Touch ID, Windows Hello), or software passkeys (e.g., Bitwarden) and use them to log in without a password.

## Overview

| Feature | Details |
|---|---|
| Library | `@simplewebauthn/server` + `@simplewebauthn/browser` |
| Attestation | `none` (no attestation verification) |
| User verification | `preferred` |
| Resident keys | `preferred` (discoverable credentials) |
| Challenge storage | In-memory with 5-minute TTL |
| Token format | Same JWT as password login (`token` cookie) |

## Endpoints

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/api/auth/webauthn/register-options` | GET | Bearer | Get registration options for `navigator.credentials.create()` |
| `/api/auth/webauthn/register-verify` | POST | Bearer | Verify and store a new credential |
| `/api/auth/webauthn/login-options` | POST | Public | Get authentication options for `navigator.credentials.get()` |
| `/api/auth/webauthn/login-verify` | POST | Public | Verify assertion and issue JWT |
| `/api/auth/webauthn/credentials` | GET | Bearer | List user's passkeys |
| `/api/auth/webauthn/credentials` | DELETE | Bearer | Remove a passkey (`?id=<uuid>`) |
| `/api/auth/webauthn/credentials` | PATCH | Bearer | Rename a passkey |

## Registration Flow

Registration requires an authenticated session (user must be logged in first).

### 1. Get registration options

```http
GET /api/auth/webauthn/register-options
Authorization: Bearer <session-token>
```

**Response:**

```json
{
  "success": true,
  "options": {
    "challenge": "base64url-encoded-challenge",
    "rp": { "name": "CoinPay", "id": "coinpayportal.com" },
    "user": {
      "id": "base64url-encoded-user-id",
      "name": "user@example.com",
      "displayName": "user@example.com"
    },
    "pubKeyCredParams": [...],
    "excludeCredentials": [...],
    "authenticatorSelection": {
      "residentKey": "preferred",
      "userVerification": "preferred"
    },
    "attestation": "none",
    "timeout": 60000
  }
}
```

### 2. Create credential in browser

```javascript
import { startRegistration } from '@simplewebauthn/browser';

const { options } = await fetch('/api/auth/webauthn/register-options', {
  headers: { Authorization: `Bearer ${token}` },
}).then(r => r.json());

const credential = await startRegistration(options);
```

### 3. Verify and store

```http
POST /api/auth/webauthn/register-verify
Authorization: Bearer <session-token>
Content-Type: application/json

{
  "credential": { ... },   // output from startRegistration()
  "name": "My Yubikey"     // optional, defaults to "My Passkey"
}
```

**Response:**

```json
{
  "success": true,
  "credential": {
    "id": "uuid",
    "name": "My Yubikey",
    "device_type": "cross-platform",
    "created_at": "2026-03-18T..."
  }
}
```

## Login Flow

Authentication is public — no existing session required.

### 1. Get authentication options

```http
POST /api/auth/webauthn/login-options
Content-Type: application/json

{
  "email": "user@example.com"    // optional — narrows allowed credentials
}
```

**Response:**

```json
{
  "success": true,
  "options": {
    "challenge": "base64url-encoded-challenge",
    "rpId": "coinpayportal.com",
    "allowCredentials": [...],
    "userVerification": "preferred",
    "timeout": 60000
  },
  "_challengeKey": "merchant-uuid-or-anon-key"
}
```

If `email` is omitted, all discoverable credentials for the RP are allowed (resident key flow).

### 2. Authenticate in browser

```javascript
import { startAuthentication } from '@simplewebauthn/browser';

const { options, _challengeKey } = await fetch('/api/auth/webauthn/login-options', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email }),
}).then(r => r.json());

const credential = await startAuthentication(options);
```

### 3. Verify assertion

```http
POST /api/auth/webauthn/login-verify
Content-Type: application/json

{
  "credential": { ... },         // output from startAuthentication()
  "challengeKey": "..."          // from login-options response
}
```

**Response:**

```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "merchant": {
    "id": "uuid",
    "email": "user@example.com",
    "is_admin": false
  }
}
```

A `token` cookie is also set automatically (httpOnly, secure, sameSite=lax, 7-day expiry).

## Credential Management

### List passkeys

```http
GET /api/auth/webauthn/credentials
Authorization: Bearer <session-token>
```

```json
{
  "success": true,
  "credentials": [
    {
      "id": "uuid",
      "name": "My Yubikey",
      "device_type": "cross-platform",
      "transports": ["usb"],
      "created_at": "2026-03-18T...",
      "last_used_at": "2026-03-19T..."
    }
  ]
}
```

### Rename a passkey

```http
PATCH /api/auth/webauthn/credentials
Authorization: Bearer <session-token>
Content-Type: application/json

{ "id": "uuid", "name": "Work Yubikey" }
```

### Delete a passkey

```http
DELETE /api/auth/webauthn/credentials?id=<uuid>
Authorization: Bearer <session-token>
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `WEBAUTHN_RP_ID` | No | Derived from `Host` header or `coinpayportal.com` | Relying Party ID (domain) |
| `WEBAUTHN_ORIGIN` | No | Derived from request headers | Expected origin for verification |

The RP ID must match the domain where WebAuthn is used. For local development, it will auto-detect from the request `Host` header.

### Database

**Table: `webauthn_credentials`**

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `user_id` | UUID | FK → `merchants(id)` |
| `credential_id` | TEXT | WebAuthn credential ID (base64url) |
| `public_key` | TEXT | Public key (base64url) |
| `counter` | INTEGER | Signature counter (replay protection) |
| `device_type` | TEXT | `platform` or `cross-platform` |
| `transports` | TEXT[] | Transport hints (`usb`, `ble`, `nfc`, `internal`) |
| `name` | TEXT | User-assigned name |
| `created_at` | TIMESTAMP | When registered |
| `last_used_at` | TIMESTAMP | Last successful login |

### Challenge Storage

Challenges are stored **in-memory** with a 5-minute TTL. This is suitable for single-instance deployments (Railway). If scaling to multiple instances, replace `src/lib/webauthn/challenges.ts` with a Redis or database-backed store.

## Security Notes

- **No attestation verification** — `attestation: 'none'` means any authenticator is accepted. This is standard for consumer apps where you don't need to restrict authenticator types.
- **Counter validation** — signature counters are tracked and updated to detect cloned authenticators.
- **Challenge expiry** — 5-minute window prevents replay attacks.
- **Origin/RP ID validation** — prevents phishing via `@simplewebauthn/server` built-in checks.
- **Credential binding** — credentials are bound to the merchant account via `user_id` FK.

## UI Integration

The Security page (`/dashboard/security` or `/settings/security`) provides a UI for:
- Registering new passkeys
- Viewing registered passkeys with device type and last-used timestamps
- Renaming passkeys
- Removing passkeys

The Login page supports passkey authentication alongside password login — users enter their email and choose "Sign in with Passkey" to trigger the WebAuthn flow.
