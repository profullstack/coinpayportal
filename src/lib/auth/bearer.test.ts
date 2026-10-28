import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { resolveBearerAuth, resolveMerchantBearer, hasScope, type BearerAuthOk } from './bearer';

const JWT_SECRET = 'session-secret-for-tests';
const OIDC_SECRET = 'oidc-secret-for-tests';

function sessionToken(secret = JWT_SECRET, payload: Record<string, any> = {}) {
  return jwt.sign({ userId: 'user-123', email: 'a@b.c', ...payload }, secret, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
}

function accessToken(secret = OIDC_SECRET, payload: Record<string, any> = {}) {
  return jwt.sign(
    {
      sub: 'user-123',
      client_id: 'cp_02526f19',
      scope: 'openid profile email wallet:read',
      token_type: 'access',
      ...payload,
    },
    secret,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
}

describe('resolveBearerAuth', () => {
  beforeEach(() => {
    vi.stubEnv('JWT_SECRET', JWT_SECRET);
    vi.stubEnv('OIDC_SIGNING_SECRET', OIDC_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects a missing header', () => {
    const auth = resolveBearerAuth(null);
    expect(auth.ok).toBe(false);
    expect((auth as any).status).toBe(401);
  });

  it('rejects a non-Bearer header', () => {
    const auth = resolveBearerAuth('Basic abc123');
    expect(auth.ok).toBe(false);
    expect((auth as any).status).toBe(401);
  });

  it('resolves a dashboard session token', () => {
    const auth = resolveBearerAuth(`Bearer ${sessionToken()}`);
    expect(auth.ok).toBe(true);
    expect((auth as BearerAuthOk).userId).toBe('user-123');
    expect((auth as BearerAuthOk).kind).toBe('session');
    expect((auth as BearerAuthOk).scopes).toBeNull();
  });

  it('resolves an OAuth access token signed with the OIDC secret', () => {
    const auth = resolveBearerAuth(`Bearer ${accessToken()}`);
    expect(auth.ok).toBe(true);
    expect((auth as BearerAuthOk).userId).toBe('user-123');
    expect((auth as BearerAuthOk).kind).toBe('oauth');
    expect((auth as BearerAuthOk).scopes).toContain('wallet:read');
  });

  it('resolves an OAuth access token when OIDC_SIGNING_SECRET falls back to JWT_SECRET', () => {
    vi.stubEnv('OIDC_SIGNING_SECRET', '');
    const auth = resolveBearerAuth(`Bearer ${accessToken(JWT_SECRET)}`);
    expect(auth.ok).toBe(true);
    // Subject comes from `sub`, not the absent `userId` claim.
    expect((auth as BearerAuthOk).userId).toBe('user-123');
    expect((auth as BearerAuthOk).kind).toBe('oauth');
  });

  it('does not accept an OAuth-shaped token signed with the session secret when OIDC_SIGNING_SECRET is set', () => {
    const auth = resolveBearerAuth(`Bearer ${accessToken(JWT_SECRET)}`);
    expect(auth.ok).toBe(false);
  });

  it('rejects a token signed with the wrong secret', () => {
    const auth = resolveBearerAuth(`Bearer ${sessionToken('not-the-secret')}`);
    expect(auth.ok).toBe(false);
    expect((auth as any).status).toBe(401);
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign({ userId: 'user-123' }, JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '-1h',
    });
    const auth = resolveBearerAuth(`Bearer ${expired}`);
    expect(auth.ok).toBe(false);
    expect((auth as any).status).toBe(401);
  });

  it('rejects a valid JWT that identifies nobody', () => {
    const anonymous = jwt.sign({ foo: 'bar' }, JWT_SECRET, { algorithm: 'HS256' });
    const auth = resolveBearerAuth(`Bearer ${anonymous}`);
    expect(auth.ok).toBe(false);
  });

  it('rejects an OIDC id_token (not an access token)', () => {
    const idToken = jwt.sign({ sub: 'user-123', aud: 'cp_1' }, OIDC_SECRET, {
      algorithm: 'HS256',
    });
    const auth = resolveBearerAuth(`Bearer ${idToken}`);
    expect(auth.ok).toBe(false);
  });
});

describe('hasScope', () => {
  it('grants everything to dashboard sessions', () => {
    const auth: BearerAuthOk = { ok: true, userId: 'u', kind: 'session', scopes: null };
    expect(hasScope(auth, 'wallet:read')).toBe(true);
  });

  it('honours granted OAuth scopes', () => {
    const auth: BearerAuthOk = {
      ok: true,
      userId: 'u',
      kind: 'oauth',
      scopes: ['openid', 'wallet:read'],
    };
    expect(hasScope(auth, 'wallet:read')).toBe(true);
    expect(hasScope(auth, 'did')).toBe(false);
  });
});

describe('resolveMerchantBearer', () => {
  beforeEach(() => {
    vi.stubEnv('JWT_SECRET', JWT_SECRET);
    vi.stubEnv('OIDC_SIGNING_SECRET', OIDC_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts a dashboard session as that merchant', () => {
    const auth = resolveMerchantBearer(`Bearer ${sessionToken()}`);
    expect(auth).toEqual({ ok: true, merchantId: 'user-123', kind: 'session' });
  });

  it('accepts an OAuth token with the merchant scope, acting as its sub', () => {
    const auth = resolveMerchantBearer(
      `Bearer ${accessToken(OIDC_SECRET, { sub: 'merchant-9', scope: 'openid profile email wallet:read merchant' })}`
    );
    expect(auth).toEqual({ ok: true, merchantId: 'merchant-9', kind: 'oauth' });
  });

  it('accepts a merchant-scope OAuth token signed with the session secret fallback', () => {
    vi.stubEnv('OIDC_SIGNING_SECRET', '');
    const auth = resolveMerchantBearer(
      `Bearer ${accessToken(JWT_SECRET, { scope: 'openid merchant' })}`
    );
    expect(auth).toEqual({ ok: true, merchantId: 'user-123', kind: 'oauth' });
  });

  it('refuses an OAuth token without the merchant scope with 403 insufficient_scope', () => {
    const auth = resolveMerchantBearer(`Bearer ${accessToken()}`);
    expect(auth.ok).toBe(false);
    if (auth.ok) return;
    expect(auth.status).toBe(403);
    expect(auth.error).toMatch(/insufficient_scope/);
    expect(auth.wwwAuthenticate).toContain('scope="merchant"');
  });

  it('does not treat a scope that merely contains "merchant" as the merchant scope', () => {
    const auth = resolveMerchantBearer(`Bearer ${accessToken(OIDC_SECRET, { scope: 'openid merchant:read' })}`);
    expect(auth.ok).toBe(false);
  });

  it('refuses a refresh token even when it names the merchant scope', () => {
    const auth = resolveMerchantBearer(
      `Bearer ${accessToken(OIDC_SECRET, { token_type: 'refresh', scope: 'merchant' })}`
    );
    expect(auth.ok).toBe(false);
    if (auth.ok) return;
    expect(auth.status).toBe(401);
  });

  it('refuses a missing or forged token with 401', () => {
    expect(resolveMerchantBearer(null)).toMatchObject({ ok: false, status: 401 });
    expect(
      resolveMerchantBearer(`Bearer ${accessToken('wrong-secret', { scope: 'merchant' })}`)
    ).toMatchObject({ ok: false, status: 401 });
  });
});
