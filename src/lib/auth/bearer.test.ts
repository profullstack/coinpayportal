import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { resolveBearerAuth, hasScope, type BearerAuthOk } from './bearer';

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
