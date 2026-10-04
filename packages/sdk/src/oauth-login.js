/**
 * `coinpay login` over OAuth 2.1: authorization code + PKCE, a loopback
 * redirect, and rotating refresh tokens.
 *
 * The CLI is a public client (`coinpay-cli`, no secret). It listens on
 * 127.0.0.1 at a free port, opens the browser at CoinPay's /api/oauth/authorize
 * with an S256 code challenge and a random state, catches the redirect, checks
 * the state, and exchanges the code with its verifier. The access token lasts
 * an hour; the refresh token is single-use, so each refresh stores the new
 * one. Over SSH, where the browser cannot reach this machine's loopback, the
 * device flow (`coinpay login --device`) is the way in.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

export const CLI_CLIENT_ID = 'coinpay-cli';
export const CLI_SCOPE = 'openid profile email merchant';

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A PKCE verifier (43+ chars of base64url) and its S256 challenge. */
export function pkcePair() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** The site origin behind an API base such as https://coinpayportal.com/api. */
export function siteOrigin(apiBase) {
  return new URL(apiBase || 'https://coinpayportal.com/api').origin;
}

export function authorizeUrl({ origin, redirectUri, challenge, state, clientId = CLI_CLIENT_ID, scope = CLI_SCOPE }) {
  const url = new URL('/api/oauth/authorize', origin);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

async function tokenRequest(origin, params, fetchImpl = fetch) {
  const res = await fetchImpl(new URL('/api/oauth/token', origin), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const err = new Error(data.error_description || data.error || `token endpoint answered ${res.status}`);
    err.code = data.error || 'token_error';
    throw err;
  }
  return data;
}

/** What the CLI keeps: the access token is also stored as `jwtToken`, which every command already sends. */
export function toStoredSession(tokens, now = Date.now()) {
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: new Date(now + (Number(tokens.expires_in) || 3600) * 1000).toISOString(),
    scope: tokens.scope ?? CLI_SCOPE,
    clientId: CLI_CLIENT_ID,
  };
}

export async function exchangeCode({ origin, code, verifier, redirectUri, clientId = CLI_CLIENT_ID, fetchImpl }) {
  return tokenRequest(origin, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri, client_id: clientId }, fetchImpl);
}

export async function refreshTokens({ origin, refreshToken, clientId = CLI_CLIENT_ID, fetchImpl }) {
  return tokenRequest(origin, { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }, fetchImpl);
}

export function openInBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

const DONE_PAGE = (ok, message) => `<!doctype html><meta charset="utf-8"><title>CoinPay CLI</title>
<body style="font-family:system-ui;background:#0b1120;color:#e5e7eb;display:grid;place-items:center;height:100vh;margin:0">
<div><h1 style="font-size:20px">${ok ? 'Signed in to the CoinPay CLI' : 'Sign-in failed'}</h1><p>${message}</p></div></body>`;

/**
 * Run the whole loopback flow. Resolves with the token response.
 * `open` is how the browser is launched; `log` prints the URL for a human.
 */
export async function loopbackLogin({ apiBase, open = openInBrowser, log = () => {}, timeoutMs = 5 * 60_000, fetchImpl } = {}) {
  const origin = siteOrigin(apiBase);
  const { verifier, challenge } = pkcePair();
  const state = b64url(randomBytes(16));

  let settle;
  const result = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/callback') {
      res.writeHead(404).end();
      return;
    }
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    if (url.searchParams.get('state') !== state) {
      res.writeHead(400, { 'Content-Type': 'text/html' }).end(DONE_PAGE(false, 'The response did not match this login. Run coinpay login again.'));
      settle.reject(new Error('state mismatch: the callback was not for this login'));
      return;
    }
    if (error || !code) {
      res.writeHead(400, { 'Content-Type': 'text/html' }).end(DONE_PAGE(false, error === 'access_denied' ? 'You declined.' : 'No code came back.'));
      settle.reject(new Error(error === 'access_denied' ? 'access denied' : `authorization failed: ${error || 'no code'}`));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(DONE_PAGE(true, 'You can close this tab and go back to the terminal.'));
    settle.resolve(code);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
  const url = authorizeUrl({ origin, redirectUri, challenge, state });
  const timer = setTimeout(() => settle.reject(new Error('timed out waiting for the browser sign-in')), timeoutMs);
  try {
    const opened = open(url);
    log(opened ? `Opening your browser to sign in. If it did not open, visit:\n  ${url}` : `Open this URL to sign in:\n  ${url}`);
    const code = await result;
    return await exchangeCode({ origin, code, verifier, redirectUri, fetchImpl });
  } finally {
    clearTimeout(timer);
    server.close();
  }
}

/**
 * Before any command: if the stored OAuth access token is within a minute of
 * expiring, rotate it. Mutates and saves `cfg`. Returns false when the
 * refresh token is no longer good (sign in again).
 */
export async function ensureFreshSession(cfg, saveConfig, { now = Date.now(), fetchImpl } = {}) {
  const session = cfg.oauth;
  if (!session || !session.refreshToken) return true;
  if (Date.parse(session.expiresAt) - now > 60_000) return true;
  try {
    const tokens = await refreshTokens({ origin: siteOrigin(cfg.baseUrl), refreshToken: session.refreshToken, clientId: session.clientId || CLI_CLIENT_ID, fetchImpl });
    cfg.oauth = toStoredSession(tokens, now);
    cfg.jwtToken = cfg.oauth.accessToken;
    saveConfig(cfg);
    return true;
  } catch (err) {
    if (err.code === 'invalid_grant') {
      delete cfg.oauth;
      delete cfg.jwtToken;
      saveConfig(cfg);
      return false;
    }
    return true; // a network blip: let the command try with what it has
  }
}
