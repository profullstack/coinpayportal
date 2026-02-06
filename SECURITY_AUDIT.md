# CoinPayPortal Security Audit

**Audit Date:** 2025-02-02  
**Auditor:** Automated Security Review (Phase 5)  
**Scope:** Non-custodial multi-chain crypto wallet — key management, authentication, transaction signing, web security, API security  
**Overall Risk Rating:** MEDIUM (see findings below)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Key Management](#1-key-management)
3. [Authentication & Authorization](#2-authentication--authorization)
4. [Transaction Signing](#3-transaction-signing)
5. [XSS Vulnerabilities](#4-xss-vulnerabilities)
6. [CSRF Vulnerabilities](#5-csrf-vulnerabilities)
7. [Content Security Policy (CSP)](#6-content-security-policy-csp)
8. [HTTPS Enforcement](#7-https-enforcement)
9. [Rate Limiting](#8-rate-limiting)
10. [Additional Findings](#9-additional-findings)
11. [Recommendations Summary](#10-recommendations-summary)

---

## Executive Summary

CoinPayPortal is a non-custodial multi-chain wallet. The architecture is fundamentally sound: **private keys and seed phrases never leave the client**. The server stores only public keys and addresses. Key areas of strength include:

- ✅ Non-custodial design — server never sees private keys
- ✅ AES-256-GCM encryption of seed phrases at rest (in localStorage)
- ✅ PBKDF2 with 600,000 iterations for key derivation from password
- ✅ Memory clearing after signing operations
- ✅ Per-request signature authentication with replay prevention
- ✅ Rate limiting on all critical endpoints
- ✅ Input validation on API routes
- ✅ No use of `dangerouslySetInnerHTML`, `eval()`, or `innerHTML`

Key areas requiring attention:

- ⚠️ No Content Security Policy (CSP) headers configured
- ⚠️ No HTTPS enforcement at the application level
- ⚠️ No security response headers (HSTS, X-Frame-Options, etc.)
- ⚠️ In-memory rate limiting (not suitable for multi-server deployments)
- ⚠️ JavaScript string immutability limits memory clearing effectiveness
- ⚠️ localStorage is vulnerable to XSS (if XSS occurs)

---

## 1. Key Management

### 1.1 Seed Phrase Generation

**File:** `src/lib/web-wallet/keys.ts`

| Item | Status | Notes |
|------|--------|-------|
| BIP39 mnemonic generation | ✅ PASS | Uses `@scure/bip39` with proper entropy (128/256 bits) |
| Cryptographic randomness | ✅ PASS | Uses `crypto.getRandomValues()` via `@scure/bip39` |
| 12 and 24 word support | ✅ PASS | Configurable word count |
| Mnemonic validation | ✅ PASS | `isValidMnemonic()` checks BIP39 wordlist and checksum |

**Rating: LOW RISK**

### 1.2 HD Key Derivation

**File:** `src/lib/web-wallet/keys.ts`

| Item | Status | Notes |
|------|--------|-------|
| BIP32/BIP44 paths | ✅ PASS | Correct derivation paths for each chain |
| secp256k1 derivation (BTC/ETH/POL) | ✅ PASS | Uses `@scure/bip32` + `@noble/curves` |
| Ed25519 derivation (SOL) | ✅ PASS | SLIP-0010 hardened derivation |
| EIP-55 address checksumming | ✅ PASS | Proper keccak256-based checksum |
| CashAddr encoding (BCH) | ✅ PASS | Correct polymod checksum |

**Rating: LOW RISK**

### 1.3 Seed Phrase Encryption at Rest

**File:** `src/lib/web-wallet/client-crypto.ts`

| Item | Status | Notes |
|------|--------|-------|
| Encryption algorithm | ✅ PASS | AES-256-GCM — authenticated encryption |
| Key derivation | ✅ PASS | PBKDF2 with **600,000 iterations** (OWASP recommendation: ≥600k) |
| Salt generation | ✅ PASS | 16-byte random salt per encryption |
| IV generation | ✅ PASS | 12-byte random IV per encryption (correct for GCM) |
| Web Crypto API | ✅ PASS | Uses browser-native `crypto.subtle` |

**Finding MEDIUM:** Encrypted seed stored in `localStorage` under key `coinpay_wallet`. While the encryption is strong, localStorage is accessible to any JavaScript running on the same origin. If an XSS vulnerability is introduced, the encrypted blob can be exfiltrated. An offline brute-force attack on the password would then be possible (mitigated by 600k PBKDF2 iterations).

**Recommendation:** Consider adding a warning to users about keeping their password strong. Consider IndexedDB with origin-bound encryption as a future enhancement. The current approach is standard for web-based wallets (MetaMask uses similar patterns).

### 1.4 Memory Clearing

**File:** `src/lib/web-wallet/signing.ts`

| Item | Status | Notes |
|------|--------|-------|
| Key buffer zeroing | ✅ PASS | `clearMemory()` and `clearBuffer()` zero Uint8Array/Buffer after use |
| Post-sign cleanup | ✅ PASS | `finally` block ensures key is cleared even on errors |
| SOL keypair cleanup | ✅ PASS | `clearMemory(keyPair.secretKey)` called after signing |
| Wallet.destroy() | ✅ PASS | Clears mnemonic, private keys map, and auth state |

**Finding LOW:** `clearSensitiveString()` in `client-crypto.ts` is acknowledged as "best-effort" because JavaScript strings are immutable. The function is essentially a no-op. This is a known limitation of JavaScript and is not fixable without using only `Uint8Array` for all secret data.

**Recommendation:** For critical paths, prefer `Uint8Array` over strings for private key material. Current implementation already does this for the signing flow — the private key hex string is immediately converted to `Buffer` and zeroed after use. This is acceptable.

**Rating: LOW RISK**

---

## 2. Authentication & Authorization

### 2.1 Per-Request Signature Auth

**File:** `src/lib/web-wallet/auth.ts`

| Item | Status | Notes |
|------|--------|-------|
| Signature format | ✅ PASS | `Wallet <wallet_id>:<signature>:<timestamp>` |
| Timestamp window | ✅ PASS | 5-minute window (300 seconds) — reasonable |
| Replay prevention | ✅ PASS | Exact signature hash checked against in-memory store |
| Signature verification | ✅ PASS | secp256k1 verify with `@noble/curves` |
| Public key lookup | ✅ PASS | Fetches wallet from DB, verifies active status |

**Rating: LOW RISK**

### 2.2 JWT Token Auth

**File:** `src/lib/web-wallet/auth.ts`

| Item | Status | Notes |
|------|--------|-------|
| Token generation | ✅ PASS | 1-hour expiry, proper claims (sub, type, iss, aud) |
| Token verification | ✅ PASS | Validates type === 'wallet' and sub claim |
| JWT_SECRET dependency | ✅ PASS | Returns error if not configured |
| Wallet status check | ✅ PASS | Verifies wallet is active after token validation |

**Finding LOW:** JWT tokens are issued with a 1-hour expiry. There's no token revocation mechanism. If a token is compromised, it will be valid until expiry. This is acceptable for 1-hour tokens and is standard practice.

**Rating: LOW RISK**

### 2.3 Challenge-Response Auth

**File:** `src/lib/web-wallet/auth.ts`

| Item | Status | Notes |
|------|--------|-------|
| Challenge generation | ✅ PASS | `coinpayportal:auth:<timestamp>:<random_hex>` with 16-byte random |
| Challenge storage | ⚠️ NOTE | Challenges stored in DB with expiration |
| Signature verification | ✅ PASS | `verifyChallengeSignature()` uses secp256k1 verify |

**Rating: LOW RISK**

---

## 3. Transaction Signing

### 3.1 EVM Signing (ETH/POL)

**File:** `src/lib/web-wallet/signing.ts`

| Item | Status | Notes |
|------|--------|-------|
| EIP-1559 (Type 2) encoding | ✅ PASS | Correct RLP encoding with `0x02` type prefix |
| keccak256 hash | ✅ PASS | Uses `@noble/hashes/sha3` |
| secp256k1 signature | ✅ PASS | Uses `@noble/curves/secp256k1` with `recovered` format |
| Recovery bit encoding | ✅ PASS | v = 0 for even, 1 for odd — correct for EIP-1559 |
| RLP minimal encoding | ✅ PASS | Leading zeros stripped correctly |

**Rating: LOW RISK**

### 3.2 BTC/BCH Signing

| Item | Status | Notes |
|------|--------|-------|
| P2PKH script construction | ✅ PASS | Correct OP_DUP OP_HASH160 ... OP_EQUALVERIFY OP_CHECKSIG |
| Legacy sighash (BTC) | ✅ PASS | SIGHASH_ALL with correct preimage |
| BIP143 sighash (BCH) | ✅ PASS | Correct BIP143 digest for BCH fork |
| DER signature encoding | ✅ PASS | Uses noble-curves DER format |
| Sighash type byte | ✅ PASS | 0x01 for BTC, 0x41 for BCH (SIGHASH_FORKID) |
| Double SHA-256 | ✅ PASS | Correct for Bitcoin sighash computation |

**Rating: LOW RISK**

### 3.3 SOL Signing

| Item | Status | Notes |
|------|--------|-------|
| Ed25519 signing | ✅ PASS | Uses `tweetnacl` with seed-derived keypair |
| Message serialization | ✅ PASS | Correct Solana transaction format (header, keys, blockhash, instructions) |
| Account sorting | ✅ PASS | Signers+writable first, fee payer always first |
| compact-u16 encoding | ✅ PASS | Correct Solana varint encoding |

**Rating: LOW RISK**

### 3.4 Transaction Broadcast

**File:** `src/lib/web-wallet/broadcast.ts`

| Item | Status | Notes |
|------|--------|-------|
| Transaction expiration check | ✅ PASS | 5-minute TTL enforced before broadcast |
| Status validation | ✅ PASS | Only broadcasts 'pending' transactions |
| Wallet ownership check | ✅ PASS | Verifies tx belongs to wallet |
| Retry logic | ✅ PASS | Exponential backoff, no retry on permanent errors |
| DB status update | ✅ PASS | Updates to 'confirming' on success, 'failed' on error |

**Rating: LOW RISK**

---

## 4. XSS Vulnerabilities

### 4.1 React Default Protection

| Item | Status | Notes |
|------|--------|-------|
| React JSX escaping | ✅ PASS | React auto-escapes all content in JSX expressions |
| `dangerouslySetInnerHTML` | ✅ PASS | **Not used anywhere** in the codebase |
| `eval()` usage | ✅ PASS | **Not used anywhere** in the codebase |
| `innerHTML` usage | ✅ PASS | **Not used** in application code |

### 4.2 User Input Handling

| Item | Status | Notes |
|------|--------|-------|
| Address input | ✅ PASS | Validated against chain-specific regex patterns |
| Amount input | ✅ PASS | Parsed as number, not interpolated into HTML |
| Seed phrase input | ✅ PASS | Validated against BIP39 wordlist |
| API response rendering | ✅ PASS | React auto-escapes all rendered data |

**Finding:** No XSS vectors identified. The application uses React's built-in escaping consistently and never injects raw HTML. Server-side API responses are JSON and are rendered through React's safe JSX syntax.

**Rating: LOW RISK**

---

## 5. CSRF Vulnerabilities

### 5.1 API Design

| Item | Status | Notes |
|------|--------|-------|
| State-changing operations | ✅ PASS | All use POST/PATCH/DELETE with JSON body |
| Authentication required | ✅ PASS | All state-changing endpoints require `Wallet` or `Bearer` auth header |
| Cookie-based auth | ✅ PASS | **Not used** — authentication is header-based |
| JSON Content-Type | ✅ PASS | All APIs expect `application/json` |

**Analysis:** CSRF is not a significant risk because:
1. Authentication uses custom `Authorization` headers (not cookies)
2. Browsers cannot forge custom headers via form submissions or link clicks
3. All state-changing APIs expect JSON request bodies

**Rating: LOW RISK**

---

## 6. Content Security Policy (CSP)

### Finding: HIGH — No CSP Headers Configured

**Files checked:** `next.config.mjs`, `vercel.json`, `src/middleware.ts` (does not exist)

No Content Security Policy headers are configured anywhere in the application. This means:
- No protection against injected scripts (if XSS is found)
- No restriction on resource loading origins
- No frame-ancestors protection (clickjacking possible)

**Recommendation — IMPLEMENT:**

Add security headers via Next.js middleware or `next.config.mjs`:

```javascript
// next.config.mjs - add headers
async headers() {
  return [
    {
      source: '/(.*)',
      headers: [
        {
          key: 'Content-Security-Policy',
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Required by Next.js
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https:",
            "font-src 'self'",
            "connect-src 'self' https://blockstream.info https://eth.llamarpc.com https://polygon-rpc.com https://api.mainnet-beta.solana.com https://api.tatum.io",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
          ].join('; '),
        },
        {
          key: 'X-Frame-Options',
          value: 'DENY',
        },
        {
          key: 'X-Content-Type-Options',
          value: 'nosniff',
        },
        {
          key: 'Referrer-Policy',
          value: 'strict-origin-when-cross-origin',
        },
        {
          key: 'Permissions-Policy',
          value: 'camera=(), microphone=(), geolocation=()',
        },
      ],
    },
  ];
}
```

**Risk: HIGH** — A wallet application handling crypto assets should have CSP as a defense-in-depth measure.

---

## 7. HTTPS Enforcement

### Finding: MEDIUM — No HSTS Header or HTTPS Redirect

**Analysis:**
- No `Strict-Transport-Security` header is set
- No middleware redirecting HTTP to HTTPS
- `vercel.json` does not configure HTTPS enforcement
- Vercel/Railway platforms enforce HTTPS at the CDN layer, but HSTS is not configured

**Recommendation:**

Add HSTS header to the security headers configuration above:

```javascript
{
  key: 'Strict-Transport-Security',
  value: 'max-age=63072000; includeSubDomains; preload',
}
```

If not on Vercel/Railway, add an HTTPS redirect in Next.js middleware:

```typescript
// src/middleware.ts
export function middleware(request: NextRequest) {
  if (request.headers.get('x-forwarded-proto') === 'http') {
    return NextResponse.redirect(
      new URL(request.url.replace('http://', 'https://'))
    );
  }
}
```

**Risk: MEDIUM** — HTTP downgrade attacks could expose wallet auth tokens.

---

## 8. Rate Limiting

### 8.1 Configuration Review

**File:** `src/lib/web-wallet/rate-limit.ts`

| Endpoint | Limit | Window | Assessment |
|----------|-------|--------|------------|
| Wallet creation | 5/hour | 3600s | ✅ Appropriate |
| Auth challenge | 10/min | 60s | ✅ Appropriate |
| Auth verify | 10/min | 60s | ✅ Appropriate |
| Balance query | 60/min | 60s | ✅ Appropriate |
| TX history | 30/min | 60s | ✅ Appropriate |
| Prepare TX | 20/min | 60s | ✅ Appropriate |
| Broadcast TX | 10/min | 60s | ✅ Appropriate |
| Fee estimate | 60/min | 60s | ✅ Appropriate |
| Settings | 30/min | 60s | ✅ Appropriate |

### 8.2 Implementation

| Item | Status | Notes |
|------|--------|-------|
| Rate limit enforcement | ✅ PASS | All critical endpoints apply rate limiting |
| IP-based limiting | ✅ PASS | Uses `x-forwarded-for` header |
| Window sliding | ✅ PASS | Fixed-window with proper reset |
| Cleanup of stale entries | ✅ PASS | 60-second cleanup interval with `unref()` |

### Finding: MEDIUM — In-Memory Rate Limiting

The rate limiter uses an in-memory `Map` store. This means:
- Rate limits reset on server restart
- Rate limits are per-process (not shared across instances)
- In a multi-server deployment, an attacker can hit different servers to bypass limits

**Recommendation:** For production multi-server deployments, replace with Redis-backed rate limiting (e.g., `@upstash/ratelimit` or Redis `INCR` with TTL). The code already has a comment acknowledging this.

**Risk: MEDIUM** for multi-server, LOW for single-server.

### 8.3 Replay Prevention

| Item | Status | Notes |
|------|--------|-------|
| Signature dedup | ✅ PASS | In-memory set with 5-minute TTL |
| Cleanup | ✅ PASS | 30-second cleanup interval |
| Reset for testing | ✅ PASS | `resetSeenSignatures()` provided |

Same caveat as rate limiting: in-memory, per-process.

---

## 9. Additional Findings

### 9.1 Input Validation

| Item | Status | Notes |
|------|--------|-------|
| Public key validation | ✅ PASS | Hex format and length checks in `service.ts` |
| Chain validation | ✅ PASS | `isValidChain()` checks against allowed list |
| Address validation | ✅ PASS | Chain-specific regex patterns |
| Amount validation | ✅ PASS | Numeric parsing with bounds checking |
| Derivation path validation | ✅ PASS | Regex match for BIP44 paths |

### 9.2 Error Handling

| Item | Status | Notes |
|------|--------|-------|
| Error response format | ✅ PASS | Consistent `{ success, data, error, timestamp }` format |
| Stack trace exposure | ✅ PASS | `console.error` server-side only, generic error to client |
| Error codes | ✅ PASS | Specific error codes for different failure modes |

### 9.3 Dependency Security

| Item | Status | Notes |
|------|--------|-------|
| `@noble/curves` | ✅ PASS | Audited, no known vulnerabilities |
| `@scure/bip39` / `@scure/bip32` | ✅ PASS | Audited by Cure53, widely used |
| `bitcoinjs-lib` | ✅ PASS | Well-maintained, widely used |
| `tweetnacl` | ✅ PASS | Audited, well-maintained |
| `ethers` | ⚠️ NOTE | v6 used only for some utility functions, not for key management |
| `jsonwebtoken` | ✅ PASS | Widely used, keep updated |

**Recommendation:** Run `pnpm audit` regularly and update dependencies. Consider using `npm-audit-resolver` in CI.

### 9.4 Supabase Service Role Key Usage

**Finding LOW:** The server uses `SUPABASE_SERVICE_ROLE_KEY` to access the database, bypassing Row Level Security. This is standard for server-side API routes but requires:
- The service role key must NEVER be exposed to the client
- All authorization checks must be done in application code (which they are)

### 9.5 Environment Variables

| Variable | Exposure Risk | Notes |
|----------|---------------|-------|
| `JWT_SECRET` | Server-only | ✅ Never sent to client |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only | ✅ Never sent to client |
| `TATUM_API_KEY` | Server-only | ✅ Only used in server routes |
| `NEXT_PUBLIC_SUPABASE_URL` | Client-visible | ✅ OK — Supabase URL is public |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Client-visible | ✅ OK — RPC URLs are public |

### 9.6 Non-Custodial Architecture Verification

**CRITICAL CHECK:** Does the server ever receive or store private keys or seed phrases?

| Component | Private Keys? | Seed Phrases? |
|-----------|---------------|---------------|
| API routes | ❌ No | ❌ No |
| Database (Supabase) | ❌ No | ❌ No |
| Server logs | ❌ No | ❌ No |
| `service.ts` (wallet creation) | ❌ No — only receives public keys | ❌ No |
| `broadcast.ts` | ❌ No — receives already-signed transactions | ❌ No |

**CONFIRMED: The non-custodial design is correctly implemented.** The server only ever receives:
- Public keys (secp256k1, ed25519)
- Addresses
- Signed transactions (for broadcast)
- Proof of ownership signatures (for import)

Private keys and seed phrases are handled exclusively in:
- Browser (client-side JavaScript)
- SDK (Node.js client code)

---

## 10. Recommendations Summary

### Critical (Implement Before Launch)

| # | Finding | Risk | Effort |
|---|---------|------|--------|
| 1 | **Add CSP headers** | HIGH | Low — add to `next.config.mjs` |
| 2 | **Add security headers** (X-Frame-Options, X-Content-Type-Options, Referrer-Policy) | HIGH | Low |
| 3 | **Add HSTS header** | MEDIUM | Low |

### Recommended (Before Production Scale)

| # | Finding | Risk | Effort |
|---|---------|------|--------|
| 4 | Replace in-memory rate limiting with Redis | MEDIUM | Medium |
| 5 | Add `pnpm audit` to CI pipeline | LOW | Low |
| 6 | Add CORS configuration for API routes | LOW | Low |
| 7 | Consider Subresource Integrity (SRI) for external scripts | LOW | Low |

### Nice to Have

| # | Finding | Risk | Effort |
|---|---------|------|--------|
| 8 | Add password strength minimum enforcement on backend | LOW | Low |
| 9 | Consider token revocation mechanism | LOW | Medium |
| 10 | Add request logging/audit trail for security events | LOW | Medium |
| 11 | Consider IndexedDB with origin-bound keys as localStorage alternative | LOW | High |

---

## Conclusion

The CoinPayPortal wallet has a **fundamentally sound security architecture**. The non-custodial design is correctly implemented — private keys never touch the server. The cryptographic implementations use well-audited libraries (`@noble/curves`, `@scure/bip39`, `tweetnacl`) and follow best practices.

The most significant gaps are in **web security headers** (CSP, HSTS, X-Frame-Options), which are straightforward to add. The in-memory rate limiting is adequate for single-server deployments but should be replaced with Redis for production scale.

No critical vulnerabilities were identified. The application is ready for launch with the addition of security headers as recommended above.
