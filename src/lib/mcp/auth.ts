/**
 * Who a request to /api/mcp acts for.
 *
 * Only a CoinPay OAuth 2.1 access token carrying the `invoices` scope is
 * accepted, and the user is its `sub` (never an email: CoinPay emails are
 * unverified). Session JWTs, API keys and tokens without the scope are refused,
 * and the revocation list (RFC 7009 / refresh-reuse families) is checked, fail
 * closed.
 */
import { createClient } from '@supabase/supabase-js';
import { verifyAccessToken } from '@/lib/oauth/tokens';
import { isAccessTokenRevoked } from '@/lib/oauth/grants';
import { MCP_SCOPE } from './resource';

export type McpAuth =
  | { ok: true; userId: string; clientId: string | null; scopes: string[] }
  | { ok: false; status: 401 | 403; error?: 'invalid_token' | 'insufficient_scope'; description: string };

type Db = Parameters<typeof isAccessTokenRevoked>[0];

function db(): Db {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as unknown as Db;
}

export async function authenticateMcp(authorization: string | null, database: Db = db()): Promise<McpAuth> {
  if (!authorization || !/^Bearer\s+\S/i.test(authorization)) {
    return { ok: false, status: 401, description: 'Sign in with CoinPay to use this server' };
  }
  const token = authorization.replace(/^Bearer\s+/i, '').trim();

  let decoded: Record<string, unknown>;
  try {
    decoded = verifyAccessToken(token);
  } catch {
    return { ok: false, status: 401, error: 'invalid_token', description: 'The access token is invalid or expired' };
  }
  if (!decoded || typeof decoded !== 'object' || typeof decoded.sub !== 'string' || !decoded.sub) {
    return { ok: false, status: 401, error: 'invalid_token', description: 'The access token has no subject' };
  }

  try {
    if (await isAccessTokenRevoked(database, decoded)) {
      return { ok: false, status: 401, error: 'invalid_token', description: 'The access token was revoked' };
    }
  } catch {
    return { ok: false, status: 401, error: 'invalid_token', description: 'Could not check token revocation' };
  }

  const scopes = typeof decoded.scope === 'string' ? decoded.scope.split(/\s+/).filter(Boolean) : [];
  if (!scopes.includes(MCP_SCOPE)) {
    return {
      ok: false,
      status: 403,
      error: 'insufficient_scope',
      description: `This token is missing the '${MCP_SCOPE}' scope`,
    };
  }

  return {
    ok: true,
    userId: decoded.sub,
    clientId: typeof decoded.client_id === 'string' ? decoded.client_id : null,
    scopes,
  };
}
