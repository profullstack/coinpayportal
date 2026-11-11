/**
 * RFC 7591 Dynamic Client Registration, open (no initial access token).
 *
 * It exists for MCP connectors: Claude (claude.ai / claude.com, Claude Code,
 * Claude Desktop) and ChatGPT register themselves before the authorization
 * code + PKCE flow against /api/mcp. Because anyone may call it, what it can
 * create is narrow:
 *   - PUBLIC clients only (token_endpoint_auth_method "none", PKCE S256
 *     mandatory). A confidential method in the request is replaced by "none",
 *     as RFC 7591 3.2.1 lets the server do; no secret is ever issued.
 *   - redirect URIs from an allowlist: the hosted connector callbacks below,
 *     or an http loopback (localhost, 127.0.0.1, [::1]) on any port and path.
 *   - scopes no wider than `openid profile email invoices`. Never `merchant`,
 *     `wallet:read` or `did`: a client nobody vetted gets the MCP's own scope.
 *
 * Signed-in merchants still register their own apps at /api/oauth/clients.
 */
import { GRANT_AUTHORIZATION_CODE, GRANT_REFRESH } from './client';

/** Hosted connector callbacks accepted verbatim. */
export const DCR_HOSTED_REDIRECTS: ReadonlySet<string> = new Set([
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
  'https://chatgpt.com/connector_platform_oauth_redirect',
]);

const DCR_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The most a dynamically registered client may ever be granted. */
export const DCR_SCOPES = ['openid', 'profile', 'email', 'invoices'] as const;

export const DCR_GRANT_TYPES = [GRANT_AUTHORIZATION_CODE, GRANT_REFRESH] as const;

export type DcrError = { error: 'invalid_redirect_uri' | 'invalid_client_metadata'; error_description: string };

export type DcrClient = {
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  scopes: string[];
  client_uri: string | null;
};

/** Is this redirect URI one an open registration may name? */
export function dcrRedirectAllowed(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw.length > 2000 || raw.includes('#')) return false;
  if (DCR_HOSTED_REDIRECTS.has(raw)) return true;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' || u.username || u.password) return false;
  return DCR_LOOPBACK_HOSTS.has(u.hostname);
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  // Control characters and angle brackets have no place in a client name that
  // the consent screen shows; React escapes them anyway, logs do not.
  const text = value.replace(/[\u0000-\u001f\u007f<>]/g, '').trim();
  return text ? text.slice(0, max) : null;
}

/** Validate an RFC 7591 registration request into what will be stored. */
export function parseRegistration(body: unknown): { ok: true; client: DcrClient } | { ok: false; error: DcrError } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: { error: 'invalid_client_metadata', error_description: 'Expected a JSON object' } };
  }
  const b = body as Record<string, unknown>;

  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10) {
    return { ok: false, error: { error: 'invalid_redirect_uri', error_description: 'redirect_uris must be an array of 1 to 10 URIs' } };
  }
  const bad = uris.find((u) => !dcrRedirectAllowed(u));
  if (bad !== undefined) {
    return {
      ok: false,
      error: {
        error: 'invalid_redirect_uri',
        error_description:
          `redirect_uri not allowed for open registration: ${String(bad).slice(0, 200)}. Allowed: ` +
          `${[...DCR_HOSTED_REDIRECTS].join(', ')}, or http://localhost, http://127.0.0.1 or http://[::1] on any port. ` +
          'Register other apps from the CoinPay dashboard (Settings > OAuth apps).',
      },
    };
  }

  const responseTypes = b.response_types;
  if (responseTypes !== undefined && (!Array.isArray(responseTypes) || responseTypes.some((r) => r !== 'code'))) {
    return { ok: false, error: { error: 'invalid_client_metadata', error_description: 'response_types must be ["code"]' } };
  }

  let grantTypes: string[] = [...DCR_GRANT_TYPES];
  if (b.grant_types !== undefined) {
    if (!Array.isArray(b.grant_types) || b.grant_types.some((g) => !(DCR_GRANT_TYPES as readonly unknown[]).includes(g))) {
      return {
        ok: false,
        error: { error: 'invalid_client_metadata', error_description: 'grant_types may only contain authorization_code and refresh_token' },
      };
    }
    grantTypes = Array.from(new Set(b.grant_types as string[]));
    if (!grantTypes.includes(GRANT_AUTHORIZATION_CODE)) {
      return { ok: false, error: { error: 'invalid_client_metadata', error_description: 'grant_types must include authorization_code' } };
    }
  }

  let scopes: string[] = [...DCR_SCOPES];
  if (b.scope !== undefined && b.scope !== null && b.scope !== '') {
    if (typeof b.scope !== 'string') {
      return { ok: false, error: { error: 'invalid_client_metadata', error_description: 'scope must be a space-separated string' } };
    }
    const asked = b.scope.split(/\s+/).filter(Boolean);
    // Unknown or wider scopes are dropped rather than refused: the client gets
    // what open registration offers and the response says which.
    scopes = Array.from(new Set(['openid', ...asked.filter((s) => (DCR_SCOPES as readonly string[]).includes(s))]));
  }

  const clientUri = cleanText(b.client_uri, 300);
  return {
    ok: true,
    client: {
      client_name: cleanText(b.client_name, 100) ?? 'MCP client',
      redirect_uris: Array.from(new Set(uris as string[])),
      grant_types: grantTypes,
      scopes,
      client_uri: clientUri && /^https:\/\//.test(clientUri) ? clientUri : null,
    },
  };
}
