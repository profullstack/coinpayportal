/**
 * OAuth 2.1 end to end against an in-memory database: public clients,
 * PKCE policy, code single-use, refresh rotation with reuse detection, the
 * device grant (RFC 8628), revocation (RFC 7009), discovery (RFC 8414),
 * RS256 ID tokens at the JWKS, aud on tokens, and client registration.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash, createPublicKey, generateKeyPairSync, randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { FakeDb } from '@/lib/oauth/test-utils/fake-db';

const db = new FakeDb();
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => db) }));

let sessionUser: { id: string; email?: string } | null = null;
vi.mock('@/lib/oauth/session-user', () => ({ getSessionUser: vi.fn(async () => sessionUser) }));
vi.mock('@/lib/oauth/auth', () => ({ getAuthUser: vi.fn(async () => sessionUser) }));

import { POST as token } from './token/route';
import { POST as revoke } from './revoke/route';
import { POST as deviceStart } from './device_authorization/route';
import { GET as deviceLookup, POST as deviceDecide } from './device/route';
import { GET as userinfo } from './userinfo/route';
import { GET as jwks } from './jwks/route';
import { GET as authorize, POST as consent } from './authorize/route';
import { POST as registerClient } from './clients/route';
import { GET as asMetadata } from '../../.well-known/oauth-authorization-server/route';
import { GET as oidcMetadata } from '../../.well-known/openid-configuration/route';
import { hashToken } from '@/lib/crypto/token-hash';
import { resetSigningKeyCache } from '@/lib/oauth/signing';
import { resetRateLimits } from '@/lib/web-wallet/rate-limit';
import { checkRedirectUris, redirectUriMatches } from '@/lib/oauth/client';
import { pkceProblem } from '@/lib/oauth/pkce';
import { GRANT_DEVICE_CODE } from '@/lib/oauth/client';

// Fixture secrets are generated per run, never literals.
const SECRET = 'cps_' + randomBytes(24).toString('hex');
const WRONG = 'cps_' + randomBytes(24).toString('hex');
const decodeClaims = (t: string): any => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
const decodeHeader = (t: string): any => JSON.parse(Buffer.from(t.split('.')[0], 'base64url').toString());

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'test@example.com', name: 'Test User' };
const RSA = generateKeyPairSync('rsa', { modulusLength: 2048 });
const RSA_PEM = RSA.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const b64url = (b: Buffer) => b.toString('base64url');
function pkce() {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

function form(url: string, body: Record<string, string>, headers: Record<string, string> = {}): any {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(body).toString(),
  });
}
function json(url: string, body: unknown, method = 'POST'): any {
  const r = new Request(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  (r as any).nextUrl = new URL(url);
  (r as any).cookies = { get: () => undefined };
  return r;
}
function get(url: string, headers: Record<string, string> = {}): any {
  const r = new Request(url, { headers });
  (r as any).nextUrl = new URL(url);
  (r as any).cookies = { get: () => undefined };
  return r;
}
const T = 'https://coinpay.dev/api/oauth/token';

async function seedClients() {
  const secretHash = await bcrypt.hash(SECRET, 4);
  db.seed('oauth_clients', [
    {
      client_id: 'pub', client_secret: '', name: 'Public CLI', is_active: true,
      redirect_uris: ['http://127.0.0.1/callback', 'https://pwa.example/cb'],
      scopes: ['openid', 'profile', 'email', 'merchant'],
      token_endpoint_auth_method: 'none', require_pkce: true, legacy_oauth2: false,
      grant_types: ['authorization_code', 'refresh_token', GRANT_DEVICE_CODE], id_token_signed_response_alg: 'RS256',
    },
    {
      client_id: 'conf', client_secret: secretHash, name: 'New Web App', is_active: true,
      redirect_uris: ['https://app.example/cb'], scopes: ['openid', 'profile', 'email'],
      token_endpoint_auth_method: 'client_secret_basic', require_pkce: true, legacy_oauth2: false,
      grant_types: ['authorization_code', 'refresh_token'], id_token_signed_response_alg: 'RS256',
    },
    {
      client_id: 'legacy', client_secret: secretHash, name: 'Legacy App', is_active: true,
      redirect_uris: ['https://legacy.example/cb', 'http://127.0.0.1:8765/callback'], scopes: ['openid', 'profile', 'email'],
      token_endpoint_auth_method: 'client_secret_basic', require_pkce: false, legacy_oauth2: true,
      grant_types: ['authorization_code', 'refresh_token'], id_token_signed_response_alg: 'HS256',
    },
  ]);
}

function seedCode(over: Record<string, any> = {}) {
  const code = b64url(randomBytes(24));
  db.seed('oauth_authorization_codes', [{
    code, client_id: 'pub', user_id: USER.id, redirect_uri: 'https://pwa.example/cb',
    scopes: ['openid', 'profile', 'email'], code_challenge: null, code_challenge_method: null,
    expires_at: new Date(Date.now() + 600_000).toISOString(), used: false, nonce: 'n-1', ...over,
  }]);
  return code;
}

async function exchangePublic() {
  const { verifier, challenge } = pkce();
  const code = seedCode({ code_challenge: challenge, code_challenge_method: 'S256' });
  const res = await token(form(T, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: 'https://pwa.example/cb', client_id: 'pub' }));
  return { res, body: await res.json(), code, verifier };
}

async function userinfoStatus(accessToken: string) {
  return (await userinfo(get('https://coinpay.dev/api/oauth/userinfo', { authorization: `Bearer ${accessToken}` }))).status;
}

beforeEach(async () => {
  db.tables = {};
  db.failNext = {};
  sessionUser = null;
  vi.stubEnv('OIDC_SIGNING_SECRET', 'test-oidc-signing-secret-for-unit-tests-min-32');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://coinpay.dev');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  vi.stubEnv('JWT_SECRET', 'test-jwt-secret-that-is-at-least-32-characters');
  vi.stubEnv('OIDC_RS256_PRIVATE_KEY', Buffer.from(RSA_PEM).toString('base64'));
  resetSigningKeyCache();
  resetRateLimits();
  db.seed('merchants', [{ ...USER }]);
  await seedClients();
});

describe('public clients (token_endpoint_auth_method none)', () => {
  it('complete a PKCE code exchange with no secret, and the tokens carry aud', async () => {
    const { res, body } = await exchangePublic();
    expect(res.status).toBe(200);
    expect(body.refresh_token).toBeTruthy();
    const access = decodeClaims(body.access_token);
    expect(access.aud).toBe('pub');
    expect(access.client_id).toBe('pub');
    expect(access.jti).toBeTruthy();
    expect(access.sid).toBeTruthy();
    expect(await userinfoStatus(body.access_token)).toBe(200);
  });

  it('get an RS256 ID token that verifies against the published JWKS', async () => {
    const { body } = await exchangePublic();
    const header = decodeHeader(body.id_token);
    expect(header.alg).toBe('RS256');
    const keys = (await (await jwks()).json()).keys;
    const jwk = keys.find((k: any) => k.kid === header.kid);
    expect(jwk.kty).toBe('RSA');
    const claims = jwt.verify(body.id_token, createPublicKey({ key: jwk, format: 'jwk' }), { algorithms: ['RS256'], audience: 'pub', issuer: 'https://coinpay.dev' }) as any;
    expect(claims.sub).toBe(USER.id);
    expect(claims.nonce).toBe('n-1');
    expect(claims.email_verified).toBe(false);
  });

  it('are refused if they present a client_secret', async () => {
    const { verifier, challenge } = pkce();
    const code = seedCode({ code_challenge: challenge });
    const res = await token(form(T, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: 'https://pwa.example/cb', client_id: 'pub', client_secret: 'x' }));
    expect(res.status).toBe(401);
  });

  it('cannot redeem a code that was not PKCE-bound', async () => {
    const code = seedCode();
    const res = await token(form(T, { grant_type: 'authorization_code', code, redirect_uri: 'https://pwa.example/cb', client_id: 'pub' }));
    expect((await res.json()).error).toBe('invalid_grant');
  });

  it('must send PKCE at authorize, and loopback redirects match on any port', async () => {
    sessionUser = USER;
    const base = 'https://coinpay.dev/api/oauth/authorize?response_type=code&client_id=pub&scope=openid&state=s1';
    const noPkce = await authorize(get(`${base}&redirect_uri=${encodeURIComponent('http://127.0.0.1:51234/callback')}`));
    expect(noPkce.status).toBe(400);
    expect((await noPkce.json()).error_description).toMatch(/code_challenge/);
    const { challenge } = pkce();
    const ok = await authorize(get(`${base}&code_challenge=${challenge}&code_challenge_method=S256&redirect_uri=${encodeURIComponent('http://127.0.0.1:51234/callback')}`));
    expect(ok.status).toBe(302);
    expect(ok.headers.get('location')).toContain('/oauth/consent');
    const plain = await authorize(get(`${base}&code_challenge=${challenge}&code_challenge_method=plain&redirect_uri=${encodeURIComponent('https://pwa.example/cb')}`));
    expect(plain.status).toBe(400);
  });

  it('consent POST enforces the same PKCE rule', async () => {
    sessionUser = USER;
    const res = await consent(json('https://coinpay.dev/api/oauth/authorize', { client_id: 'pub', redirect_uri: 'https://pwa.example/cb', scope: 'openid', state: 'x', action: 'approve' }));
    expect(res.status).toBe(400);
  });
});

describe('confidential clients', () => {
  it('registered under OAuth 2.1 must send their secret even with PKCE', async () => {
    const { verifier, challenge } = pkce();
    const code = seedCode({ client_id: 'conf', redirect_uri: 'https://app.example/cb', code_challenge: challenge });
    const body = { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: 'https://app.example/cb', client_id: 'conf' };
    expect((await token(form(T, body))).status).toBe(401);
    const basic = 'Basic ' + Buffer.from(`conf:${SECRET}`).toString('base64');
    const res = await token(form(T, body, { authorization: basic }));
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(decodeHeader(out.id_token).alg).toBe('RS256');
  });

  it('wrong secret is invalid_client', async () => {
    const { verifier, challenge } = pkce();
    const code = seedCode({ client_id: 'conf', redirect_uri: 'https://app.example/cb', code_challenge: challenge });
    const res = await token(form(T, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: 'https://app.example/cb', client_id: 'conf', client_secret: WRONG }));
    expect(res.status).toBe(401);
  });

  it('legacy (pre-2.1) clients keep working: secretless PKCE exchange, state-only authorize, HS256 id_token', async () => {
    const { verifier, challenge } = pkce();
    const code = seedCode({ client_id: 'legacy', redirect_uri: 'https://legacy.example/cb', code_challenge: challenge });
    const res = await token(form(T, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: 'https://legacy.example/cb', client_id: 'legacy' }));
    expect(res.status).toBe(200);
    expect(decodeHeader((await res.json()).id_token).alg).toBe('HS256');

    // No PKCE: the secret is still required, as before.
    const code2 = seedCode({ client_id: 'legacy', redirect_uri: 'https://legacy.example/cb' });
    const noSecret = await token(form(T, { grant_type: 'authorization_code', code: code2, redirect_uri: 'https://legacy.example/cb', client_id: 'legacy' }));
    expect(noSecret.status).toBe(401);
    const withSecret = await token(form(T, { grant_type: 'authorization_code', code: code2, redirect_uri: 'https://legacy.example/cb', client_id: 'legacy', client_secret: SECRET }));
    expect(withSecret.status).toBe(200);

    sessionUser = USER;
    const stateOnly = await authorize(get('https://coinpay.dev/api/oauth/authorize?response_type=code&client_id=legacy&scope=openid&state=s1&redirect_uri=' + encodeURIComponent('https://legacy.example/cb')));
    expect(stateOnly.status).toBe(302);
  });
});

describe('authorization codes', () => {
  it('reject expired codes, wrong redirect_uri and a wrong verifier', async () => {
    const { verifier, challenge } = pkce();
    const expired = seedCode({ code_challenge: challenge, expires_at: new Date(Date.now() - 1000).toISOString() });
    expect((await (await token(form(T, { grant_type: 'authorization_code', code: expired, code_verifier: verifier, redirect_uri: 'https://pwa.example/cb', client_id: 'pub' }))).json()).error).toBe('invalid_grant');
    const c2 = seedCode({ code_challenge: challenge });
    expect((await (await token(form(T, { grant_type: 'authorization_code', code: c2, code_verifier: verifier, redirect_uri: 'https://pwa.example/other', client_id: 'pub' }))).json()).error_description).toMatch(/Redirect URI/);
    const c3 = seedCode({ code_challenge: challenge });
    expect((await (await token(form(T, { grant_type: 'authorization_code', code: c3, code_verifier: pkce().verifier, redirect_uri: 'https://pwa.example/cb', client_id: 'pub' }))).json()).error_description).toMatch(/PKCE/);
  });

  it('are single-use, and a replay revokes the tokens the first exchange issued', async () => {
    const { body, code, verifier } = await exchangePublic();
    expect(await userinfoStatus(body.access_token)).toBe(200);
    const again = await token(form(T, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: 'https://pwa.example/cb', client_id: 'pub' }));
    expect(again.status).toBe(400);
    expect(await userinfoStatus(body.access_token)).toBe(401);
    const refresh = await token(form(T, { grant_type: 'refresh_token', refresh_token: body.refresh_token, client_id: 'pub' }));
    expect(refresh.status).toBe(400);
  });
});

describe('refresh tokens', () => {
  it('rotate, and reusing a rotated token revokes the whole grant', async () => {
    const { body: first } = await exchangePublic();
    const r1 = await token(form(T, { grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: 'pub' }));
    expect(r1.status).toBe(200);
    const second = await r1.json();
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(await userinfoStatus(second.access_token)).toBe(200);

    const reuse = await token(form(T, { grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: 'pub' }));
    expect(reuse.status).toBe(400);
    expect((await reuse.json()).error_description).toMatch(/reuse/);
    // The legitimate holder's newer tokens die with the family.
    expect(await userinfoStatus(second.access_token)).toBe(401);
    const r3 = await token(form(T, { grant_type: 'refresh_token', refresh_token: second.refresh_token, client_id: 'pub' }));
    expect(r3.status).toBe(400);
  });

  it('refuse a value that is a stored hash, and another client\'s token', async () => {
    const { body } = await exchangePublic();
    const asHash = await token(form(T, { grant_type: 'refresh_token', refresh_token: hashToken(body.refresh_token), client_id: 'pub' }));
    expect(asHash.status).toBe(400);
    const other = await token(form(T, { grant_type: 'refresh_token', refresh_token: body.refresh_token, client_id: 'conf', client_secret: SECRET }));
    expect(other.status).toBe(400);
  });

  it('confidential clients must authenticate to refresh', async () => {
    const { verifier, challenge } = pkce();
    const code = seedCode({ client_id: 'conf', redirect_uri: 'https://app.example/cb', code_challenge: challenge });
    const out = await (await token(form(T, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: 'https://app.example/cb', client_id: 'conf', client_secret: SECRET }))).json();
    expect((await token(form(T, { grant_type: 'refresh_token', refresh_token: out.refresh_token, client_id: 'conf' }))).status).toBe(401);
    expect((await token(form(T, { grant_type: 'refresh_token', refresh_token: out.refresh_token, client_id: 'conf', client_secret: SECRET }))).status).toBe(200);
  });
});

describe('grant types', () => {
  it('implicit, password and client_credentials are unsupported', async () => {
    for (const g of ['implicit', 'password', 'client_credentials']) {
      expect((await (await token(form(T, { grant_type: g, client_id: 'pub' }))).json()).error).toBe('unsupported_grant_type');
    }
    const r = await authorize(get('https://coinpay.dev/api/oauth/authorize?response_type=token&client_id=pub&redirect_uri=https://pwa.example/cb'));
    expect((await r.json()).error).toBe('unsupported_response_type');
  });
});

describe('device authorization grant (RFC 8628)', () => {
  async function start(scope = 'openid profile merchant') {
    const res = await deviceStart(form('https://coinpay.dev/api/oauth/device_authorization', { client_id: 'pub', scope }));
    expect(res.status).toBe(200);
    return res.json();
  }
  const poll = (device_code: string) => token(form(T, { grant_type: GRANT_DEVICE_CODE, device_code, client_id: 'pub' }));
  const lastPollAgo = (ms: number) => {
    for (const r of db.rows('oauth_device_codes')) r.last_polled_at = new Date(Date.now() - ms).toISOString();
  };

  it('pending, slow_down, then tokens once the signed-in user approves', async () => {
    const d = await start();
    expect(d.user_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(d.verification_uri).toBe('https://coinpay.dev/oauth/device');
    expect(d.verification_uri_complete).toBeUndefined();
    expect(db.rows('oauth_device_codes')[0].device_code).toBe(hashToken(d.device_code));

    expect((await (await poll(d.device_code)).json()).error).toBe('authorization_pending');
    const fast = await (await poll(d.device_code)).json();
    expect(fast.error).toBe('slow_down');
    expect(db.rows('oauth_device_codes')[0].interval_seconds).toBe(10);

    // The verification page needs a session, and shows the app and scopes.
    expect((await deviceLookup(get(`https://coinpay.dev/api/oauth/device?user_code=${d.user_code}`))).status).toBe(401);
    sessionUser = USER;
    const look = await (await deviceLookup(get(`https://coinpay.dev/api/oauth/device?user_code=${d.user_code.toLowerCase().replace('-', '')}`))).json();
    expect(look).toMatchObject({ status: 'pending', name: 'Public CLI', scopes: ['openid', 'profile', 'merchant'] });
    expect((await deviceDecide(json('https://coinpay.dev/api/oauth/device', { user_code: d.user_code, action: 'approve' }))).status).toBe(200);
    expect(db.rows('oauth_consents')[0]).toMatchObject({ user_id: USER.id, client_id: 'pub' });

    lastPollAgo(20_000);
    const res = await poll(d.device_code);
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.scope).toBe('openid profile merchant');
    expect((decodeClaims(out.access_token)).aud).toBe('pub');
    expect(await userinfoStatus(out.access_token)).toBe(200);

    lastPollAgo(20_000);
    expect((await (await poll(d.device_code)).json()).error).toBe('invalid_grant');
    // Already used: the page says so.
    expect((await deviceDecide(json('https://coinpay.dev/api/oauth/device', { user_code: d.user_code, action: 'approve' }))).status).toBe(409);
  });

  it('access_denied when the user denies, expired_token after expiry', async () => {
    const d = await start();
    sessionUser = USER;
    await deviceDecide(json('https://coinpay.dev/api/oauth/device', { user_code: d.user_code, action: 'deny' }));
    expect((await (await poll(d.device_code)).json()).error).toBe('access_denied');

    const e = await start();
    db.rows('oauth_device_codes').find((r) => r.user_code === e.user_code)!.expires_at = new Date(Date.now() - 1).toISOString();
    expect((await (await poll(e.device_code)).json()).error).toBe('expired_token');
  });

  it('is limited to registered scopes and to clients registered for the grant', async () => {
    const d = await start('openid wallet:read');
    expect(db.rows('oauth_device_codes')[0].scopes).toEqual(['openid']);
    const res = await deviceStart(form('https://coinpay.dev/api/oauth/device_authorization', { client_id: 'conf', client_secret: SECRET, scope: 'openid' }));
    expect((await res.json()).error).toBe('unauthorized_client');
    expect(d.device_code).toBeTruthy();
  });

  it('another client cannot redeem the device code', async () => {
    const d = await start();
    sessionUser = USER;
    await deviceDecide(json('https://coinpay.dev/api/oauth/device', { user_code: d.user_code, action: 'approve' }));
    db.rows('oauth_clients').find((c) => c.client_id === 'conf')!.grant_types.push(GRANT_DEVICE_CODE);
    const res = await token(form(T, { grant_type: GRANT_DEVICE_CODE, device_code: d.device_code, client_id: 'conf', client_secret: SECRET }));
    expect((await res.json()).error).toBe('invalid_grant');
  });
});

describe('revocation (RFC 7009)', () => {
  const R = 'https://coinpay.dev/api/oauth/revoke';

  it('revoking a refresh token kills the grant, including its access token at userinfo', async () => {
    const { body } = await exchangePublic();
    const res = await revoke(form(R, { token: body.refresh_token, token_type_hint: 'refresh_token', client_id: 'pub' }));
    expect(res.status).toBe(200);
    expect(await userinfoStatus(body.access_token)).toBe(401);
    expect((await token(form(T, { grant_type: 'refresh_token', refresh_token: body.refresh_token, client_id: 'pub' }))).status).toBe(400);
  });

  it('revoking an access token kills only that token', async () => {
    const { body } = await exchangePublic();
    expect((await revoke(form(R, { token: body.access_token, client_id: 'pub' }))).status).toBe(200);
    expect(await userinfoStatus(body.access_token)).toBe(401);
    const refreshed = await (await token(form(T, { grant_type: 'refresh_token', refresh_token: body.refresh_token, client_id: 'pub' }))).json();
    expect(await userinfoStatus(refreshed.access_token)).toBe(200);
  });

  it('answers 200 for unknown tokens and does not touch another client\'s tokens', async () => {
    const { body } = await exchangePublic();
    expect((await revoke(form(R, { token: randomBytes(32).toString('hex'), client_id: 'pub' }))).status).toBe(200);
    const other = await revoke(form(R, { token: body.refresh_token, client_id: 'conf', client_secret: SECRET }));
    expect(other.status).toBe(200);
    expect(await userinfoStatus(body.access_token)).toBe(200);
  });

  it('requires a confidential client to authenticate', async () => {
    expect((await revoke(form(R, { token: 'x', client_id: 'conf' }))).status).toBe(401);
  });

  it('fails closed at userinfo when the revocation list cannot be read', async () => {
    const { body } = await exchangePublic();
    db.failNext.oauth_revoked_tokens = 'boom';
    expect(await userinfoStatus(body.access_token)).toBe(401);
  });
});

describe('discovery', () => {
  it('RFC 8414 and OIDC documents advertise every endpoint and method', async () => {
    for (const handler of [asMetadata, oidcMetadata]) {
      const doc = await (await handler()).json();
      expect(doc.issuer).toBe('https://coinpay.dev');
      expect(doc.revocation_endpoint).toBe('https://coinpay.dev/api/oauth/revoke');
      expect(doc.device_authorization_endpoint).toBe('https://coinpay.dev/api/oauth/device_authorization');
      expect(doc.grant_types_supported).toEqual(['authorization_code', 'refresh_token', GRANT_DEVICE_CODE]);
      expect(doc.token_endpoint_auth_methods_supported).toContain('none');
      expect(doc.code_challenge_methods_supported).toEqual(['S256']);
      expect(doc.id_token_signing_alg_values_supported).toEqual(['RS256', 'HS256']);
      expect(doc.response_types_supported).toEqual(['code']);
    }
  });

  it('without an RS256 key, only HS256 is advertised and ID tokens fall back to HS256', async () => {
    vi.stubEnv('OIDC_RS256_PRIVATE_KEY', '');
    resetSigningKeyCache();
    const doc = await (await asMetadata()).json();
    expect(doc.id_token_signing_alg_values_supported).toEqual(['HS256']);
    const { body } = await exchangePublic();
    expect(decodeHeader(body.id_token).alg).toBe('HS256');
  });
});

describe('client registration', () => {
  const C = 'https://coinpay.dev/api/oauth/clients';
  beforeEach(() => {
    sessionUser = USER;
  });

  it('registers a public client with no secret, PKCE-only, device grant included', async () => {
    const res = await registerClient(json(C, { name: 'My CLI', redirect_uris: ['http://127.0.0.1/callback'], token_endpoint_auth_method: 'none', scopes: ['openid', 'profile'] }));
    expect(res.status).toBe(201);
    const out = await res.json();
    expect(out.client.client_secret || null).toBeNull();
    expect(out.client.token_endpoint_auth_method).toBe('none');
    expect(out.client.grant_types).toContain(GRANT_DEVICE_CODE);
    const row = db.rows('oauth_clients').find((c) => c.client_id === out.client.client_id)!;
    expect(row.client_secret).toBe('');
    expect(row.require_pkce).toBe(true);
    expect(row.id_token_signed_response_alg).toBe('RS256');
  });

  it('confidential clients get a secret, but no loopback or http redirects', async () => {
    expect((await registerClient(json(C, { name: 'x', redirect_uris: ['http://127.0.0.1:9000/cb'] }))).status).toBe(400);
    expect((await registerClient(json(C, { name: 'x', redirect_uris: ['http://app.example/cb'] }))).status).toBe(400);
    const ok = await (await registerClient(json(C, { name: 'x', redirect_uris: ['https://app.example/cb'] }))).json();
    expect(ok.client.client_secret).toMatch(/^cps_/);
  });

  it('refuses implicit/password grants, unknown scopes and bad algs', async () => {
    expect((await registerClient(json(C, { name: 'x', redirect_uris: ['https://a.example/cb'], grant_types: ['implicit'] }))).status).toBe(400);
    expect((await registerClient(json(C, { name: 'x', redirect_uris: ['https://a.example/cb'], scopes: ['openid', 'admin'] }))).status).toBe(400);
    expect((await registerClient(json(C, { name: 'x', redirect_uris: ['https://a.example/cb'], id_token_signed_response_alg: 'none' }))).status).toBe(400);
    const hs = await (await registerClient(json(C, { name: 'x', redirect_uris: ['https://a.example/cb'], id_token_signed_response_alg: 'HS256' }))).json();
    expect(hs.client.id_token_signed_response_alg).toBe('HS256');
  });
});

describe('helpers', () => {
  it('checkRedirectUris: OAuth 2.1 registration rules', () => {
    expect(checkRedirectUris(['https://a.example/cb'], false)).toBeNull();
    expect(checkRedirectUris(['https://a.example/cb#x'], false)).toMatch(/fragment/);
    expect(checkRedirectUris(['http://[::1]/cb'], true)).toBeNull();
    expect(checkRedirectUris(['http://localhost/cb'], true)).toMatch(/https/);
    expect(checkRedirectUris(['com.example.app:/cb'], true)).toBeNull();
    expect(checkRedirectUris(['myapp:/cb'], true)).toMatch(/reverse-domain/);
    expect(checkRedirectUris(['com.example.app:/cb'], false)).toMatch(/public/);
    expect(checkRedirectUris(['javascript:alert(1)'], true)).toMatch(/not allowed/);
  });

  it('redirectUriMatches: exact unless loopback port flexibility applies', () => {
    expect(redirectUriMatches('http://127.0.0.1/cb', 'http://127.0.0.1:4000/cb', { loopbackAnyPort: false })).toBe(false);
    expect(redirectUriMatches('http://127.0.0.1/cb', 'http://127.0.0.1:4000/cb', { loopbackAnyPort: true })).toBe(true);
  });

  it('pkceProblem', () => {
    const pub = { client_secret: '', token_endpoint_auth_method: 'none' as const };
    const old = { client_secret: 'h', token_endpoint_auth_method: 'client_secret_basic' as const, require_pkce: false };
    const c = pkce().challenge;
    expect(pkceProblem(pub, undefined, undefined, 'st')).toMatch(/required/);
    expect(pkceProblem(pub, c, 'S256', undefined)).toBeNull();
    expect(pkceProblem(pub, c, undefined, undefined)).toBeNull();
    expect(pkceProblem(pub, c, 'plain', undefined)).toMatch(/S256/);
    expect(pkceProblem(old, undefined, undefined, 'st')).toBeNull();
    expect(pkceProblem(old, undefined, undefined, undefined)).toMatch(/state or code_challenge/);
  });
});
