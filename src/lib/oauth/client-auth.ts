/**
 * Client authentication at the token, revocation and device endpoints.
 *
 * - Public clients (token_endpoint_auth_method "none") send only client_id and
 *   must not send a secret.
 * - Confidential clients authenticate with client_secret_basic or
 *   client_secret_post (either is accepted, as before).
 * - A confidential client registered before OAuth 2.1 (legacy_oauth2) may
 *   still exchange a PKCE-bound code without its secret, which some existing
 *   apps rely on; `allowLegacySecretless` turns that on for that one case.
 */
import type { NextRequest } from 'next/server';
import { authenticateClient, getOAuthClient, isPublicClient, type OAuthClient } from './client';

export function parseBasicAuth(request: NextRequest | Request): { client_id: string; client_secret: string } | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(authHeader.substring(6), 'base64').toString('utf-8');
    const colon = decoded.indexOf(':');
    if (colon === -1) return null;
    return {
      client_id: decodeURIComponent(decoded.substring(0, colon)),
      client_secret: decodeURIComponent(decoded.substring(colon + 1)),
    };
  } catch {
    return null;
  }
}

export async function parseFormOrJson(request: NextRequest | Request): Promise<Record<string, string>> {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(await request.text());
    const out: Record<string, string> = {};
    params.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  try {
    const json = await request.json();
    if (!json || typeof json !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(json)) if (typeof v === 'string') out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export type ClientAuthResult =
  | { ok: true; client: OAuthClient; authenticated: boolean; legacySecretless?: boolean }
  | { ok: false; error: string; description: string; status: number };

export async function authenticateTokenClient(
  body: Record<string, string>,
  opts: { allowLegacySecretless?: boolean } = {}
): Promise<ClientAuthResult> {
  const clientId = body.client_id;
  if (!clientId) return { ok: false, error: 'invalid_request', description: 'client_id is required', status: 400 };

  const client = await getOAuthClient(clientId);
  if (!client) return { ok: false, error: 'invalid_client', description: 'Unknown client', status: 401 };

  if (isPublicClient(client)) {
    if (body.client_secret) {
      return { ok: false, error: 'invalid_client', description: 'This is a public client; it has no client_secret', status: 401 };
    }
    return { ok: true, client, authenticated: false };
  }

  if (body.client_secret) {
    const auth = await authenticateClient(clientId, body.client_secret);
    if (!auth.valid || !auth.client) {
      return { ok: false, error: 'invalid_client', description: auth.error || 'Invalid client credentials', status: 401 };
    }
    return { ok: true, client: auth.client, authenticated: true };
  }

  if (opts.allowLegacySecretless && client.legacy_oauth2 === true) {
    // Reported, not broken: these clients should start sending their secret.
    console.warn(`[OAuth] legacy confidential client ${clientId} exchanged a PKCE code without its secret`);
    return { ok: true, client, authenticated: false, legacySecretless: true };
  }

  return { ok: false, error: 'invalid_client', description: 'client_secret is required for this client', status: 401 };
}

/** Merge Basic credentials over the body (Basic wins, as before). */
export function applyBasicAuth(request: NextRequest | Request, body: Record<string, string>): Record<string, string> {
  const basic = parseBasicAuth(request);
  if (basic) {
    body.client_id = basic.client_id;
    body.client_secret = basic.client_secret;
  }
  return body;
}
