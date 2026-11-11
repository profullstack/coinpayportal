/**
 * The remote MCP server end to end against the in-memory database: RFC 9728
 * discovery, the 401 challenge, open DCR (RFC 7591), authorization code +
 * PKCE for the claude.ai callback, then initialize / tools/list / tools/call
 * with the real access token. The one API route a tool reaches is faked, to
 * prove the in-process call carries the OAuth user and nothing else.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash, randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { FakeDb } from '@/lib/oauth/test-utils/fake-db';

const db = new FakeDb();
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => db) }));

let sessionUser: { id: string; email?: string } | null = null;
vi.mock('@/lib/oauth/session-user', () => ({ getSessionUser: vi.fn(async () => sessionUser) }));

const seenByRoute: string[] = [];
vi.mock('@/app/api/invoices/route', () => ({
  GET: vi.fn(async (request: Request) => {
    const bearer = request.headers.get('authorization')!.slice(7);
    const claims: any = jwt.verify(bearer, process.env.JWT_SECRET!);
    seenByRoute.push(claims.userId);
    return Response.json({ success: true, invoices: [{ id: 'inv-1', invoice_number: 'INV-001', status: 'sent', amount: 100 }] });
  }),
  POST: vi.fn(),
}));

import { POST as mcp, GET as mcpGet } from './route';
import { POST as register } from '../oauth/register/route';
import { GET as authorize, POST as consent } from '../oauth/authorize/route';
import { POST as token } from '../oauth/token/route';
import { GET as prmRoot } from '../../.well-known/oauth-protected-resource/route';
import { GET as prmPath } from '../../.well-known/oauth-protected-resource/api/mcp/route';
import { GET as asMetadata } from '../../.well-known/oauth-authorization-server/route';
import { resetRateLimits } from '@/lib/web-wallet/rate-limit';
import { generateAccessToken } from '@/lib/oauth/tokens';

const ORIGIN = 'https://coinpay.dev';
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'reviewer@example.com' };
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

function req(url: string, init: RequestInit & { headers?: Record<string, string> } = {}): any {
  const r = new Request(url, init);
  (r as any).nextUrl = new URL(url);
  (r as any).cookies = { get: () => undefined };
  return r;
}
const rpc = (body: unknown, accessToken?: string) =>
  mcp(req(`${ORIGIN}/api/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify(body),
  }));

beforeEach(() => {
  db.tables = {};
  db.failNext = {};
  sessionUser = null;
  seenByRoute.length = 0;
  vi.stubEnv('OIDC_SIGNING_SECRET', 'test-oidc-signing-secret-for-unit-tests-min-32');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', ORIGIN);
  vi.stubEnv('JWT_SECRET', 'test-jwt-secret-that-is-at-least-32-characters');
  resetRateLimits();
  db.seed('merchants', [{ ...USER }]);
  db.seed('businesses', [{ id: '22222222-2222-4222-8222-222222222222', name: 'Acme', merchant_id: USER.id }]);
});

describe('discovery', () => {
  it('serves RFC 9728 metadata whose resource is exactly the server URL, at both paths', async () => {
    for (const handler of [prmRoot, prmPath]) {
      const body = await (await handler()).json();
      expect(body.resource).toBe(`${ORIGIN}/api/mcp`);
      expect(body.authorization_servers).toEqual([ORIGIN]);
      expect(body.scopes_supported).toEqual(['invoices']);
    }
  });

  it('advertises the open registration endpoint and the invoices scope', async () => {
    const body = await (await asMetadata()).json();
    expect(body.registration_endpoint).toBe(`${ORIGIN}/api/oauth/register`);
    expect(body.scopes_supported).toContain('invoices');
    expect(body.code_challenge_methods_supported).toEqual(['S256']);
  });

  it('answers an unauthenticated POST (and GET) with 401 + resource_metadata', async () => {
    for (const res of [await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }), await mcpGet(req(`${ORIGIN}/api/mcp`))]) {
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toContain(
        `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`
      );
    }
  });

  it('refuses a session JWT, a token without the scope, and a revoked token', async () => {
    const session = jwt.sign({ userId: USER.id }, process.env.JWT_SECRET!, { expiresIn: 60 });
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, session)).status).toBe(401);

    const merchantOnly = generateAccessToken(USER, { client_id: 'cp_x' }, ['openid', 'merchant']);
    const r = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, merchantOnly);
    expect(r.status).toBe(403);
    expect(r.headers.get('www-authenticate')).toContain('error="insufficient_scope"');

    const revoked = generateAccessToken(USER, { client_id: 'cp_x' }, ['openid', 'invoices'], { jti: 'j-1' });
    db.seed('oauth_revoked_tokens', [{ id: 'jti:j-1' }]);
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, revoked)).status).toBe(401);
  });
});

describe('DCR + authorization code + PKCE + MCP', () => {
  it('runs the whole claude.ai flow', async () => {
    // 1. Register, unauthenticated, asking for a confidential client: gets a public one.
    const regRes = await register(req(`${ORIGIN}/api/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'client_secret_post', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
    }));
    expect(regRes.status).toBe(201);
    const reg = await regRes.json();
    expect(reg.token_endpoint_auth_method).toBe('none');
    expect(reg).not.toHaveProperty('client_secret');
    expect(reg.redirect_uris).toEqual([CALLBACK]);
    const stored = db.rows('oauth_clients').find((c: any) => c.client_id === reg.client_id)!;
    expect(stored).toMatchObject({ owner_id: null, client_secret: '', require_pkce: true, legacy_oauth2: false });

    // 2. Authorize with PKCE and the RFC 8707 resource but no scope, signed in.
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    sessionUser = USER;
    const authUrl = new URL(`${ORIGIN}/api/oauth/authorize`);
    for (const [k, v] of Object.entries({
      response_type: 'code', client_id: reg.client_id, redirect_uri: CALLBACK, state: 'st-1',
      code_challenge: challenge, code_challenge_method: 'S256', resource: `${ORIGIN}/api/mcp`,
    })) authUrl.searchParams.set(k, v);
    const toConsent = await authorize(req(authUrl.toString()));
    expect(toConsent.status).toBe(302);
    const consentUrl = new URL(toConsent.headers.get('location')!);
    expect(consentUrl.pathname).toBe('/oauth/consent');
    expect(consentUrl.searchParams.get('scope')).toBe('openid invoices');

    // 3. The consent page POSTs JSON and navigates itself (no form-action trap).
    const approved = await consent(req(`${ORIGIN}/api/oauth/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: reg.client_id, redirect_uri: CALLBACK, scope: consentUrl.searchParams.get('scope'), state: 'st-1',
        code_challenge: challenge, code_challenge_method: 'S256', action: 'approve',
      }),
    }));
    const { redirect } = await approved.json();
    const back = new URL(redirect);
    expect(`${back.origin}${back.pathname}`).toBe(CALLBACK);
    expect(back.searchParams.get('state')).toBe('st-1');

    // 4. Exchange the code with the verifier, no secret.
    const tokRes = await token(req(`${ORIGIN}/api/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code: back.searchParams.get('code')!, redirect_uri: CALLBACK,
        client_id: reg.client_id, code_verifier: verifier, resource: `${ORIGIN}/api/mcp`,
      }).toString(),
    }));
    expect(tokRes.status).toBe(200);
    const tokens = await tokRes.json();
    expect(tokens.scope).toContain('invoices');

    // 5. MCP with the real access token.
    const init = await (await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } }, tokens.access_token)).json();
    expect(init.result.serverInfo.name).toBe('coinpay');

    const note = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, tokens.access_token);
    expect(note.status).toBe(202);

    const list = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, tokens.access_token)).json();
    expect(list.result).toMatchObject({ resultType: 'complete', cacheScope: 'private' });
    expect(typeof list.result.ttlMs).toBe('number');

    const call = await (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'invoice_list', arguments: {} } }, tokens.access_token)).json();
    expect(call.result.isError).toBe(false);
    expect(call.result.content[0].text).toContain('INV-001');
    expect(seenByRoute).toEqual([USER.id]);
  });

  it('refuses open registration for other redirect URIs', async () => {
    const res = await register(req(`${ORIGIN}/api/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'Evil', redirect_uris: ['https://evil.example/cb'] }),
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_redirect_uri');
    expect(db.rows('oauth_clients')).toHaveLength(0);
  });
});
