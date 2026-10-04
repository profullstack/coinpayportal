/**
 * `coinpay login` over OAuth 2.1: PKCE, the loopback round trip, and token rotation.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { request } from 'node:http';

import { authorizeUrl, ensureFreshSession, loopbackLogin, pkcePair, siteOrigin, toStoredSession } from '../src/oauth-login.js';

/** The "browser" following the redirect: always the loopback host, only port and path vary. */
const callLoopback = (back) =>
  new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port: Number(back.port), path: `${back.pathname}${back.search}`, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    req.on('error', resolve);
    req.end();
  });

const s256 = (v) => createHash('sha256').update(v).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('PKCE and the authorize URL', () => {
  it('makes an S256 challenge from a 43+ character verifier', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(challenge).toBe(s256(verifier));
    expect(pkcePair().verifier).not.toBe(verifier);
  });

  it('asks for code + PKCE + state as the public coinpay-cli client', () => {
    const url = new URL(authorizeUrl({ origin: 'https://coinpayportal.com', redirectUri: 'http://127.0.0.1:5000/callback', challenge: 'abc', state: 'st' }));
    expect(url.pathname).toBe('/api/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'coinpay-cli',
      redirect_uri: 'http://127.0.0.1:5000/callback',
      code_challenge: 'abc',
      code_challenge_method: 'S256',
      state: 'st',
    });
    expect(url.searchParams.get('scope')).toContain('merchant');
    expect(siteOrigin('https://coinpay.example/api')).toBe('https://coinpay.example');
  });
});

describe('loopbackLogin', () => {
  it('catches the redirect, checks state, and exchanges the code with the verifier', async () => {
    let tokenBody = null;
    const fetchImpl = async (url, init) => {
      expect(String(url)).toBe('https://coinpay.example/api/oauth/token');
      tokenBody = Object.fromEntries(new URLSearchParams(init.body));
      return new Response(JSON.stringify({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, scope: 'openid merchant' }), { status: 200 });
    };
    // The "browser": approve at once by following the redirect with a code.
    const open = (url) => {
      const u = new URL(url);
      const back = new URL(u.searchParams.get('redirect_uri'));
      back.searchParams.set('code', 'the-code');
      back.searchParams.set('state', u.searchParams.get('state'));
      setTimeout(() => callLoopback(back), 20);
      open.challenge = u.searchParams.get('code_challenge');
      return true;
    };
    const tokens = await loopbackLogin({ apiBase: 'https://coinpay.example/api', open, fetchImpl, timeoutMs: 5000 });
    expect(tokens.access_token).toBe('at-1');
    expect(tokenBody).toMatchObject({ grant_type: 'authorization_code', code: 'the-code', client_id: 'coinpay-cli' });
    expect(tokenBody.redirect_uri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(s256(tokenBody.code_verifier)).toBe(open.challenge);
  });

  it('rejects a callback whose state does not match', async () => {
    const open = (url) => {
      const back = new URL(new URL(url).searchParams.get('redirect_uri'));
      back.searchParams.set('code', 'x');
      back.searchParams.set('state', 'forged');
      setTimeout(() => callLoopback(back), 20);
      return true;
    };
    await expect(loopbackLogin({ apiBase: 'https://coinpay.example/api', open, fetchImpl: async () => { throw new Error('must not exchange'); }, timeoutMs: 5000 })).rejects.toThrow(/state mismatch/);
  });
});

describe('ensureFreshSession', () => {
  const stored = (expiresInMs) => ({ baseUrl: 'https://coinpay.example/api', jwtToken: 'old', oauth: { accessToken: 'old', refreshToken: 'rt-1', expiresAt: new Date(Date.now() + expiresInMs).toISOString(), clientId: 'coinpay-cli' } });

  it('leaves a fresh token alone', async () => {
    const cfg = stored(30 * 60_000);
    let saved = 0;
    expect(await ensureFreshSession(cfg, () => (saved += 1), { fetchImpl: async () => { throw new Error('no'); } })).toBe(true);
    expect(saved).toBe(0);
  });

  it('rotates a token about to expire and keeps the new refresh token', async () => {
    const cfg = stored(10_000);
    let body = null;
    const fetchImpl = async (_url, init) => {
      body = Object.fromEntries(new URLSearchParams(init.body));
      return new Response(JSON.stringify({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600 }), { status: 200 });
    };
    expect(await ensureFreshSession(cfg, () => {}, { fetchImpl })).toBe(true);
    expect(body).toEqual({ grant_type: 'refresh_token', refresh_token: 'rt-1', client_id: 'coinpay-cli' });
    expect(cfg.jwtToken).toBe('at-2');
    expect(cfg.oauth.refreshToken).toBe('rt-2');
  });

  it('signs out when the refresh token is spent', async () => {
    const cfg = stored(-1000);
    const fetchImpl = async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Refresh token has been revoked' }), { status: 400 });
    expect(await ensureFreshSession(cfg, () => {}, { fetchImpl })).toBe(false);
    expect(cfg.oauth).toBeUndefined();
    expect(cfg.jwtToken).toBeUndefined();
  });

  it('stores what a token response says', () => {
    expect(toStoredSession({ access_token: 'a', refresh_token: 'r', expires_in: 60, scope: 's' }, 0)).toEqual({ accessToken: 'a', refreshToken: 'r', expiresAt: '1970-01-01T00:01:00.000Z', scope: 's', clientId: 'coinpay-cli' });
  });
});
