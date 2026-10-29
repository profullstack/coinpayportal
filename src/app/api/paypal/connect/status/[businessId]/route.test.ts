/**
 * GET /api/paypal/connect/status/:businessId takes a merchant-scope OAuth
 * token, so pay.agent can tell whether a link's business takes card before its
 * first checkout. The writes beside it (POST/DELETE /api/paypal/connect) still
 * refuse OAuth.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';

const JWT_SECRET = randomUUID();
const OIDC_SECRET = randomUUID();
const verifyBusinessAccess = vi.fn();
let account: Record<string, unknown> | null = null;

vi.mock('@/lib/wallets/supported-coins', () => ({
  verifyBusinessAccess: (...args: unknown[]) => verifyBusinessAccess(...args),
}));
vi.mock('@/lib/paypal/platform', () => ({ isPaypalPartnerModeEnabled: () => false }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: account, error: null }) }) }),
    }),
  }),
}));

const { GET } = await import('./route');
const connect = await import('../../route');

const oauth = (scope: string) =>
  jwt.sign({ sub: 'merchant-9', client_id: 'cp_payagent', scope, token_type: 'access' }, OIDC_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });

const status = (token: string) =>
  GET(new NextRequest('http://localhost/api/paypal/connect/status/biz-1', { headers: { authorization: `Bearer ${token}` } }), {
    params: Promise.resolve({ businessId: 'biz-1' }),
  });

describe('PayPal connection status with an OAuth bearer', () => {
  beforeEach(() => {
    vi.stubEnv('JWT_SECRET', JWT_SECRET);
    vi.stubEnv('OIDC_SIGNING_SECRET', OIDC_SECRET);
    verifyBusinessAccess.mockReset().mockResolvedValue({ ok: true });
    account = null;
  });
  afterEach(() => vi.unstubAllEnvs());

  it('reports connected for a merchant-scope token, with no secret', async () => {
    account = { paypal_client_id: 'AbcClient1234', environment: 'live', email: 'shop@example.com', connected: true, created_at: '2026-10-28T00:00:00Z' };
    const res = await status(oauth('openid merchant'));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ success: true, connected: true, client_id_last4: '1234', connection_mode: 'self_serve' });
    expect(JSON.stringify(json)).not.toMatch(/secret/i);
    expect(verifyBusinessAccess).toHaveBeenCalledWith(expect.anything(), 'biz-1', 'merchant-9');
  });

  it('reports not connected for a business without PayPal', async () => {
    const json = await (await status(oauth('openid merchant'))).json();
    expect(json).toMatchObject({ success: true, connected: false });
  });

  it('still checks the token holder can read that business', async () => {
    verifyBusinessAccess.mockResolvedValue({ ok: false, error: 'Business not found', status: 404 });
    expect((await status(oauth('openid merchant'))).status).toBe(404);
  });

  it('refuses an OAuth token without the merchant scope', async () => {
    expect((await status(oauth('openid profile'))).status).toBe(403);
  });

  it('keeps OAuth out of the PayPal connect write', async () => {
    const res = await connect.POST(
      new NextRequest('http://localhost/api/paypal/connect', {
        method: 'POST',
        headers: { authorization: `Bearer ${oauth('openid merchant')}`, 'content-type': 'application/json' },
        body: JSON.stringify({ business_id: 'biz-1', client_id: 'id', client_secret: 'secret' }),
      }),
    );
    expect(res.status).toBe(403);
  });
});
