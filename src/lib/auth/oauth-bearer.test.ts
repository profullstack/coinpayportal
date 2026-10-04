import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';

import { merchantFromAccessToken } from './oauth-bearer';
import { generateAccessToken } from '../oauth/tokens';

describe('merchantFromAccessToken', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-oauth-bearer-0123456789';
  });

  it('accepts an access token whose grant carries the merchant scope', () => {
    const token = generateAccessToken({ id: 'm-1' }, { client_id: 'coinpay-cli' }, ['openid', 'merchant']);
    expect(merchantFromAccessToken(token)).toEqual({ id: 'm-1', clientId: 'coinpay-cli' });
  });

  it('refuses a third-party token without the merchant scope', () => {
    const token = generateAccessToken({ id: 'm-1' }, { client_id: 'cp_other' }, ['openid', 'profile', 'email']);
    expect(merchantFromAccessToken(token)).toBeNull();
  });

  it('refuses ID tokens, forged signatures and expired tokens', () => {
    const secret = process.env.OIDC_SIGNING_SECRET || process.env.JWT_SECRET!;
    const idToken = jwt.sign({ sub: 'm-1', scope: 'merchant' }, secret, { algorithm: 'HS256' });
    expect(merchantFromAccessToken(idToken)).toBeNull();
    const forged = jwt.sign({ sub: 'm-1', scope: 'merchant', token_type: 'access' }, 'wrong-secret', { algorithm: 'HS256' });
    expect(merchantFromAccessToken(forged)).toBeNull();
    const expired = jwt.sign({ sub: 'm-1', scope: 'merchant', token_type: 'access', exp: Math.floor(Date.now() / 1000) - 10 }, secret, { algorithm: 'HS256' });
    expect(merchantFromAccessToken(expired)).toBeNull();
    expect(merchantFromAccessToken(null)).toBeNull();
  });
});
