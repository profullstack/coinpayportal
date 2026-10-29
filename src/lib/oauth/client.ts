/**
 * OAuth2 client validation utilities
 */
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase configuration missing');
  }
  return createClient(url, key);
}

export interface OAuthClient {
  id: string;
  client_id: string;
  client_secret: string;
  name: string;
  description: string | null;
  redirect_uris: string[];
  scopes: string[];
  owner_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /** 'none' = public client (native app, CLI, PWA): no secret, PKCE S256 mandatory. */
  token_endpoint_auth_method?: TokenEndpointAuthMethod;
  grant_types?: string[];
  /** When false (some pre-2026-10-29 clients only), a code request may omit PKCE if it sends state. */
  require_pkce?: boolean;
  id_token_signed_response_alg?: 'RS256' | 'HS256';
  /**
   * Registered before OAuth 2.1 (2026-10-29). Keeps the old behaviour for that
   * client only: a PKCE code exchange without its secret, and any port on a
   * registered loopback redirect.
   */
  legacy_oauth2?: boolean;
}

export type TokenEndpointAuthMethod = 'client_secret_basic' | 'client_secret_post' | 'none';
export const TOKEN_ENDPOINT_AUTH_METHODS: TokenEndpointAuthMethod[] = ['client_secret_basic', 'client_secret_post', 'none'];

export const GRANT_AUTHORIZATION_CODE = 'authorization_code';
export const GRANT_REFRESH = 'refresh_token';
export const GRANT_DEVICE_CODE = 'urn:ietf:params:oauth:grant-type:device_code';
export const SUPPORTED_GRANT_TYPES = [GRANT_AUTHORIZATION_CODE, GRANT_REFRESH, GRANT_DEVICE_CODE];

/** A public client has no secret to keep (token_endpoint_auth_method "none"). */
export function isPublicClient(client: Pick<OAuthClient, 'client_secret' | 'token_endpoint_auth_method'>): boolean {
  if (client.token_endpoint_auth_method) return client.token_endpoint_auth_method === 'none';
  return !client.client_secret;
}

/** Grant types this client may use. Rows from before the column existed get the old pair. */
export function clientGrantTypes(client: Pick<OAuthClient, 'grant_types' | 'client_secret' | 'token_endpoint_auth_method'>): string[] {
  if (Array.isArray(client.grant_types) && client.grant_types.length) return client.grant_types;
  return isPublicClient(client)
    ? [GRANT_AUTHORIZATION_CODE, GRANT_REFRESH, GRANT_DEVICE_CODE]
    : [GRANT_AUTHORIZATION_CODE, GRANT_REFRESH];
}

/** PKCE is mandatory for public clients and for every client registered under OAuth 2.1. */
export function clientRequiresPkce(client: Pick<OAuthClient, 'require_pkce' | 'client_secret' | 'token_endpoint_auth_method'>): boolean {
  if (isPublicClient(client)) return true;
  return client.require_pkce !== false;
}

/**
 * Validate that a client exists, is active, and the redirect_uri matches
 */
export async function validateClient(
  clientId: string,
  redirectUri: string
): Promise<{ valid: boolean; client?: OAuthClient; error?: string }> {
  const supabase = getSupabase();

  const { data: client, error } = await supabase
    .from('oauth_clients')
    .select('*')
    .eq('client_id', clientId)
    .single();

  if (error || !client) {
    return { valid: false, error: 'Invalid client_id' };
  }

  if (!client.is_active) {
    return { valid: false, error: 'Client is inactive' };
  }

  // Exact match, except that native/CLI clients (public, or registered before
  // OAuth 2.1) may use any port on a registered loopback redirect (RFC 8252 7.3).
  const loopbackAnyPort = isPublicClient(client) || client.legacy_oauth2 === true;
  if (!client.redirect_uris.some((registered: string) => redirectUriMatches(registered, redirectUri, { loopbackAnyPort }))) {
    return { valid: false, error: 'Invalid redirect_uri' };
  }

  return { valid: true, client: client as OAuthClient };
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]']);

/**
 * Does a requested redirect_uri match a registered one?
 *
 * Exact match, except for loopback redirects: a native app (the CoinPay CLI)
 * listens on whatever port is free, so for a registered `http://127.0.0.1/...`
 * or `http://[::1]/...` any port is accepted, as OAuth 2.1 and RFC 8252
 * section 7.3 require. Scheme, host and path must still match exactly, and
 * `localhost` is deliberately not a loopback host here (it can be re-pointed).
 */
export function redirectUriMatches(
  registered: string,
  requested: string,
  { loopbackAnyPort = true }: { loopbackAnyPort?: boolean } = {}
): boolean {
  if (registered === requested) return true;
  if (!loopbackAnyPort) return false;
  let a: URL;
  let b: URL;
  try {
    a = new URL(registered);
    b = new URL(requested);
  } catch {
    return false;
  }
  if (a.protocol !== 'http:' || b.protocol !== 'http:') return false;
  if (!LOOPBACK_HOSTS.has(a.hostname) || a.hostname !== b.hostname) return false;
  if (a.username || a.password || b.username || b.password) return false;
  return a.pathname === b.pathname && a.search === b.search && !b.hash;
}

export function isLoopbackRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    return u.protocol === 'http:' && LOOPBACK_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Check redirect URIs at registration (and on update) under OAuth 2.1:
 * absolute, no fragment, no userinfo; https for everyone; http only on a
 * loopback IP and only for public clients (RFC 8252 7.3, any port at runtime);
 * a private-use scheme such as `com.example.app:/cb` only for public clients
 * (RFC 8252 7.1, reverse-domain with a dot). Returns an error string or null.
 */
export function checkRedirectUris(uris: unknown, isPublic: boolean): string | null {
  if (!Array.isArray(uris) || uris.length === 0) return 'redirect_uris must be a non-empty array';
  if (uris.length > 20) return 'at most 20 redirect_uris';
  for (const raw of uris) {
    if (typeof raw !== 'string' || raw.length > 2000) return 'each redirect_uri must be a string';
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return `redirect_uri is not an absolute URL: ${raw}`;
    }
    if (u.hash || raw.includes('#')) return `redirect_uri must not contain a fragment: ${raw}`;
    if (u.username || u.password) return `redirect_uri must not contain credentials: ${raw}`;
    if (u.protocol === 'https:') continue;
    if (u.protocol === 'http:') {
      if (LOOPBACK_HOSTS.has(u.hostname)) {
        if (!isPublic) return `loopback redirect URIs are only for public clients (token_endpoint_auth_method "none"): ${raw}`;
        continue;
      }
      return `redirect_uri must use https (or http://127.0.0.1 / http://[::1] for a public native client): ${raw}`;
    }
    const scheme = u.protocol.slice(0, -1);
    if (['javascript', 'data', 'file', 'vbscript', 'blob', 'about'].includes(scheme)) {
      return `redirect_uri scheme not allowed: ${raw}`;
    }
    if (!isPublic) return `custom-scheme redirect URIs are only for public clients: ${raw}`;
    if (!scheme.includes('.')) return `a private-use scheme must be reverse-domain (e.g. com.example.app:/cb): ${raw}`;
  }
  return null;
}

/**
 * Authenticate a client using client_id and client_secret (for token endpoint).
 * Client secret is stored as a bcrypt hash; comparison uses bcrypt.compare.
 */
export async function authenticateClient(
  clientId: string,
  clientSecret: string
): Promise<{ valid: boolean; client?: OAuthClient; error?: string }> {
  const supabase = getSupabase();

  const { data: client, error } = await supabase
    .from('oauth_clients')
    .select('*')
    .eq('client_id', clientId)
    .single();

  if (error || !client) {
    return { valid: false, error: 'Invalid client credentials' };
  }

  if (!client.is_active) {
    return { valid: false, error: 'Client is inactive' };
  }

  // A public client has no secret; '' must never compare equal to anything.
  if (!client.client_secret || isPublicClient(client)) {
    return { valid: false, error: 'Invalid client credentials' };
  }

  // Compare plaintext secret against stored bcrypt hash
  const match = await bcrypt.compare(clientSecret, client.client_secret);
  if (!match) {
    return { valid: false, error: 'Invalid client credentials' };
  }

  return { valid: true, client: client as OAuthClient };
}

/**
 * Hash a client secret for storage
 */
export async function hashClientSecret(secret: string): Promise<string> {
  return bcrypt.hash(secret, 10);
}

/**
 * Fetch a client record by client_id, without authenticating it.
 *
 * Callers use this to decide whether a client is confidential (registered with
 * a secret) before demanding one — the refresh grant needs that distinction, so
 * that omitting client_secret cannot skip authentication for a client that has
 * one.
 */
export async function getOAuthClient(clientId: string): Promise<OAuthClient | null> {
  const supabase = getSupabase();

  const { data: client, error } = await supabase
    .from('oauth_clients')
    .select('*')
    .eq('client_id', clientId)
    .single();

  if (error || !client || !client.is_active) return null;
  return client as OAuthClient;
}
