/**
 * Web Bot Auth — key directory handling
 *
 * A signer names its key directory in the `Signature-Agent` header. The
 * directory is a JWKS served at a well-known path, and the `keyid` parameter
 * is the RFC 7638 thumbprint of the key that signed the request.
 *
 * Fetching a URL supplied by the caller is a request-forgery primitive if left
 * unguarded, so the fetch here is deliberately narrow: HTTPS only, no
 * redirects, size-capped, timed out, and refused for private address literals.
 */

import {
  createHash,
  createPublicKey,
  type KeyObject,
  // Node's JWK type, not the DOM one — they are structurally different and
  // createPublicKey only accepts Node's.
  type JsonWebKey as NodeJsonWebKey,
} from 'crypto';

/** RFC 8037 Ed25519 public JWK. */
export interface Ed25519Jwk {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
  kid?: string;
  nbf?: number;
  exp?: number;
}

export const DIRECTORY_PATH = '/.well-known/http-message-signatures-directory';
export const DIRECTORY_CONTENT_TYPE =
  'application/http-message-signatures-directory+json';

/** Cap on directory response size — a JWKS is small; anything large is abuse. */
const MAX_DIRECTORY_BYTES = 128 * 1024;
const FETCH_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  keys: Ed25519Jwk[];
  expiresAt: number;
}

const directoryCache = new Map<string, CacheEntry>();

/** Drop cached directories. Exposed for tests and key-rotation handling. */
export function clearDirectoryCache(): void {
  directoryCache.clear();
}

/**
 * RFC 7638 JWK thumbprint for an Ed25519 key.
 *
 * The canonical form contains exactly the required members, lexicographically
 * ordered, with no whitespace. Any deviation yields a different thumbprint and
 * the key silently stops matching its keyid.
 */
export function jwkThumbprint(jwk: Ed25519Jwk): string {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
  return createHash('sha256').update(canonical).digest('base64url');
}

/** Narrow an unknown JWKS member to a usable Ed25519 signing key. */
export function isEd25519Jwk(value: unknown): value is Ed25519Jwk {
  if (!value || typeof value !== 'object') return false;
  const jwk = value as Record<string, unknown>;
  return (
    jwk.kty === 'OKP' &&
    jwk.crv === 'Ed25519' &&
    typeof jwk.x === 'string' &&
    jwk.x.length > 0
  );
}

/** Import an Ed25519 JWK as a verifying key. */
export function toPublicKey(jwk: Ed25519Jwk): KeyObject {
  return createPublicKey({ key: jwk as unknown as NodeJsonWebKey, format: 'jwk' });
}

/**
 * Reject directory URLs that point somewhere a server-side fetch should not go.
 *
 * Hostnames still resolve at connect time, so this blocks the obvious literals
 * rather than pretending to be complete DNS-rebinding protection.
 */
function assertSafeDirectoryUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Signature-Agent is not a valid URL: ${raw}`);
  }

  if (url.protocol !== 'https:') {
    throw new Error('Signature-Agent must be https');
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isPrivate =
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^f[cd][0-9a-f]{2}:/i.test(host);

  if (isPrivate) {
    throw new Error(`Refusing to fetch a key directory from ${url.hostname}`);
  }

  return url;
}

/**
 * Resolve the directory URL for a `Signature-Agent` value.
 *
 * The header carries a structured-field String, so the quotes are part of the
 * wire format and are stripped here. A bare origin gets the well-known path
 * appended; an explicit path is honoured as given.
 */
export function directoryUrlFor(signatureAgent: string): URL {
  const unquoted = signatureAgent.trim().replace(/^"|"$/g, '');
  const url = assertSafeDirectoryUrl(unquoted);

  if (url.pathname === '/' || url.pathname === '') {
    url.pathname = DIRECTORY_PATH;
  }
  return url;
}

/**
 * Fetch and cache the JWKS a signer publishes.
 *
 * @param signatureAgent - raw `Signature-Agent` header value
 */
export async function fetchDirectory(signatureAgent: string): Promise<Ed25519Jwk[]> {
  const url = directoryUrlFor(signatureAgent);
  const key = url.toString();

  const cached = directoryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.keys;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let body: string;
  try {
    const response = await fetch(key, {
      // A redirect could bounce the fetch to an internal address that the
      // checks above already rejected for the original URL.
      redirect: 'error',
      signal: controller.signal,
      headers: { accept: `${DIRECTORY_CONTENT_TYPE}, application/json` },
    });

    if (!response.ok) {
      throw new Error(`Key directory returned HTTP ${response.status}`);
    }

    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > MAX_DIRECTORY_BYTES) {
      throw new Error('Key directory is too large');
    }

    body = await response.text();
    if (body.length > MAX_DIRECTORY_BYTES) {
      throw new Error('Key directory is too large');
    }
  } finally {
    clearTimeout(timer);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('Key directory is not valid JSON');
  }

  const rawKeys = (parsed as { keys?: unknown })?.keys;
  if (!Array.isArray(rawKeys)) {
    throw new Error('Key directory has no keys array');
  }

  const now = Math.floor(Date.now() / 1000);
  const keys = rawKeys.filter(isEd25519Jwk).filter((jwk) => {
    // Honour the directory's own validity window, when it states one.
    if (typeof jwk.nbf === 'number' && now < jwk.nbf) return false;
    if (typeof jwk.exp === 'number' && now >= jwk.exp) return false;
    return true;
  });

  directoryCache.set(key, { keys, expiresAt: Date.now() + CACHE_TTL_MS });
  return keys;
}

/** Find the key in a directory whose thumbprint matches `keyid`. */
export function findKeyByThumbprint(
  keys: Ed25519Jwk[],
  keyid: string
): Ed25519Jwk | undefined {
  return keys.find((jwk) => jwkThumbprint(jwk) === keyid);
}
