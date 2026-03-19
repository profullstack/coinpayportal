# OAuth 2.0 / OpenID Connect Provider

CoinPay implements an OAuth 2.0 Authorization Code flow with PKCE support and OpenID Connect (OIDC) compatibility. Third-party applications can authenticate CoinPay merchants and access their profile, email, wallet, and DID data with consent.

## Overview

| Feature | Details |
|---|---|
| Grant type | `authorization_code` (with optional PKCE) |
| Token format | JWT (HS256) |
| ID token | OIDC-compliant, issued when `openid` scope is requested |
| Refresh tokens | 30-day expiry, single-use rotation |
| Client secrets | Bcrypt-hashed at rest; shown once on creation |
| Consent | Per-client, per-user; remembered across sessions |

## Base URL

```
https://coinpayportal.com
```

## Endpoints

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/api/oauth/authorize` | GET | Cookie/Bearer | Authorization endpoint — redirects to login → consent → callback |
| `/api/oauth/authorize` | POST | Cookie/Bearer | Consent approval/denial |
| `/api/oauth/token` | POST | Client credentials | Exchange auth code or refresh token for access/ID tokens |
| `/api/oauth/userinfo` | GET | Bearer (access token) | OIDC UserInfo — returns user claims |
| `/api/oauth/jwks` | GET | Public | JWKS endpoint (HS256 key metadata) |
| `/api/oauth/clients` | GET | Bearer | List your OAuth clients |
| `/api/oauth/clients` | POST | Bearer | Register a new OAuth client |
| `/api/oauth/clients/[id]` | GET/PATCH/DELETE | Bearer | Manage a specific client |
| `/api/oauth/clients/lookup` | GET | Public | Look up client name/scopes by `client_id` |

## Scopes

| Scope | Description |
|---|---|
| `openid` | Verify identity (always included if any valid scope is present) |
| `profile` | Access name and profile picture |
| `email` | Access email address |
| `did` | Access decentralized identifier |
| `wallet:read` | View wallet addresses |

## Authorization Code Flow

### 1. Redirect user to authorize

```
GET /api/oauth/authorize
  ?response_type=code
  &client_id=cp_xxxxxxxxxxxx
  &redirect_uri=https://yourapp.com/callback
  &scope=openid+profile+email
  &state=<random-csrf-token>
  &code_challenge=<S256-challenge>        # optional (PKCE)
  &code_challenge_method=S256              # optional (PKCE)
  &nonce=<random-nonce>                    # optional (OIDC)
```

**What happens:**
1. If the user is not logged in → redirected to `/login?redirect=...`
2. If the user has already consented to the requested scopes → auth code issued immediately
3. Otherwise → redirected to `/oauth/consent` to approve/deny

### 2. User approves consent

The consent page shows the requesting app name, description, and requested scopes. On approval, CoinPay redirects back to `redirect_uri`:

```
https://yourapp.com/callback?code=<auth-code>&state=<state>
```

On denial:

```
https://yourapp.com/callback?error=access_denied&error_description=User+denied+the+request&state=<state>
```

Auth codes expire after **10 minutes** and are single-use.

### 3. Exchange code for tokens

```http
POST /api/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=<auth-code>
&redirect_uri=https://yourapp.com/callback
&client_id=cp_xxxxxxxxxxxx
&client_secret=cps_xxxxxxxxxxxx          # required for confidential clients
&code_verifier=<pkce-verifier>            # required if code_challenge was sent
```

Client credentials can also be sent via `Authorization: Basic <base64(client_id:client_secret)>` header.

**Response:**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "a1b2c3d4...",
  "scope": "openid profile email",
  "id_token": "eyJhbGciOiJIUzI1NiIs..."
}
```

### 4. Fetch user info

```http
GET /api/oauth/userinfo
Authorization: Bearer <access_token>
```

**Response:**

```json
{
  "sub": "merchant-uuid",
  "name": "Alice",
  "email": "alice@example.com",
  "email_verified": true,
  "wallets": [
    { "address": "bc1q...", "chain": "bitcoin", "label": "Main" }
  ],
  "did": "did:web:example.com"
}
```

Fields returned depend on granted scopes.

### 5. Refresh tokens

```http
POST /api/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token=<refresh-token>
&client_id=cp_xxxxxxxxxxxx
&client_secret=cps_xxxxxxxxxxxx
```

Refresh tokens are **single-use with rotation** — each exchange returns a new refresh token and revokes the old one. Refresh tokens expire after **30 days**.

## PKCE (Proof Key for Code Exchange)

Public clients (e.g., SPAs, mobile apps) should use PKCE instead of a client secret:

1. Generate a random `code_verifier` (43–128 chars, URL-safe)
2. Compute `code_challenge = BASE64URL(SHA256(code_verifier))`
3. Send `code_challenge` + `code_challenge_method=S256` in the authorize request
4. Send `code_verifier` in the token exchange request

Supported methods: `S256` (recommended), `plain`.

## Client Registration

### Dashboard

Navigate to **Dashboard → OAuth** to create and manage clients via the UI.

### API

```http
POST /api/oauth/clients
Authorization: Bearer <session-token>
Content-Type: application/json

{
  "name": "My App",
  "description": "Optional description",
  "redirect_uris": ["https://myapp.com/callback"],
  "scopes": ["openid", "profile", "email"]
}
```

**Response (201):**

```json
{
  "success": true,
  "client": {
    "id": "uuid",
    "client_id": "cp_xxxxxxxxxxxx",
    "name": "My App",
    "redirect_uris": ["https://myapp.com/callback"],
    "scopes": ["openid", "profile", "email"],
    "client_secret": "cps_xxxxxxxxxxxx",
    "is_active": true
  },
  "warning": "Store the client_secret securely. It will not be shown again."
}
```

⚠️ The `client_secret` is shown **only once** at creation time. Store it securely.

### Client Management

```http
# List clients
GET /api/oauth/clients

# Get single client
GET /api/oauth/clients/{id}

# Update client
PATCH /api/oauth/clients/{id}
{ "name": "Updated Name", "redirect_uris": [...], "is_active": false }

# Delete client
DELETE /api/oauth/clients/{id}
```

### Public Client Lookup

```http
GET /api/oauth/clients/lookup?client_id=cp_xxxxxxxxxxxx
```

Returns public info (name, description, scopes) — no secrets. Used by the consent page.

## JWKS

```http
GET /api/oauth/jwks
```

Returns key metadata. Since tokens use HS256 (symmetric signing), clients need the shared secret (`OIDC_SIGNING_SECRET` or `JWT_SECRET`) to verify tokens locally.

## ID Token Claims

| Claim | Scope | Description |
|---|---|---|
| `iss` | always | Issuer URL (`APP_URL`) |
| `sub` | always | Merchant UUID |
| `aud` | always | Client ID |
| `iat` / `exp` | always | Issued-at / expiry (1 hour) |
| `nonce` | always | Echoed if provided in authorize request |
| `email` | `email` | Merchant email |
| `email_verified` | `email` | Always `true` for existing merchants |
| `name` | `profile` | Merchant display name |

## Error Responses

All error responses follow RFC 6749:

```json
{
  "error": "invalid_grant",
  "error_description": "Authorization code has expired"
}
```

Common errors: `invalid_request`, `invalid_client`, `invalid_grant`, `unsupported_grant_type`, `invalid_scope`, `access_denied`, `login_required`.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | Yes | Signing secret for JWTs (shared with regular auth) |
| `OIDC_SIGNING_SECRET` | No | Override signing secret for OIDC tokens (falls back to `JWT_SECRET`) |
| `NEXT_PUBLIC_APP_URL` | Yes | Public-facing URL (e.g., `https://coinpayportal.com`) |
| `APP_URL` | No | Server-side override for public URL |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |

## Database Tables

- `oauth_clients` — registered OAuth applications
- `oauth_authorization_codes` — pending/used auth codes
- `oauth_refresh_tokens` — refresh tokens with revocation tracking
- `oauth_consents` — user consent records (per client × user)

## Integration Example

Here's a complete example integrating CoinPay OAuth into a Next.js app:

```typescript
// 1. Initiate OAuth flow
// GET /api/auth/coinpay
import { randomBytes, createHash } from 'crypto';

const state = randomBytes(32).toString('base64url');
const codeVerifier = randomBytes(32).toString('base64url');
const codeChallenge = createHash('sha256')
  .update(codeVerifier)
  .digest('base64url');

// Store state + codeVerifier in a secure cookie
const authorizeUrl = new URL('https://coinpayportal.com/api/oauth/authorize');
authorizeUrl.searchParams.set('response_type', 'code');
authorizeUrl.searchParams.set('client_id', process.env.COINPAY_CLIENT_ID!);
authorizeUrl.searchParams.set('redirect_uri', 'https://yourapp.com/api/callback/oauth');
authorizeUrl.searchParams.set('scope', 'openid profile email');
authorizeUrl.searchParams.set('state', state);
authorizeUrl.searchParams.set('code_challenge', codeChallenge);
authorizeUrl.searchParams.set('code_challenge_method', 'S256');

// Redirect user to authorizeUrl

// 2. Handle callback
// GET /api/callback/oauth?code=xxx&state=xxx
const tokenRes = await fetch('https://coinpayportal.com/api/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code: searchParams.get('code')!,
    redirect_uri: 'https://yourapp.com/api/callback/oauth',
    client_id: process.env.COINPAY_CLIENT_ID!,
    code_verifier: storedCodeVerifier,
  }),
});

const tokens = await tokenRes.json();

// 3. Fetch user profile
const userRes = await fetch('https://coinpayportal.com/api/oauth/userinfo', {
  headers: { Authorization: `Bearer ${tokens.access_token}` },
});
const user = await userRes.json();
// { sub: "uuid", name: "Alice", email: "alice@example.com", email_verified: true }
```
