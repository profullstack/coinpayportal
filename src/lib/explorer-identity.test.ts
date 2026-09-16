import { afterEach, expect, it, vi } from 'vitest';
import { generateToken } from './auth/jwt';
import { explorerAccount } from './explorer-identity';
const secret = 'explorer-test-secret';
const req = (token: string) => new Request('https://coinpayportal.com/explorer', { headers: { cookie: `token=${token}` } });
afterEach(() => vi.unstubAllEnvs());
it('uses the verified account identity across refreshed sessions', () => {
  vi.stubEnv('JWT_SECRET', secret);
  expect(explorerAccount(req(generateToken({ userId: 'alice', email: 'a@example.test' }, secret)))).toBe('alice');
});
it('rejects forged, expired and refresh tokens', () => {
  vi.stubEnv('JWT_SECRET', secret);
  for (const token of [
    'invented',
    generateToken({ userId: 'alice', email: 'a@example.test' }, 'wrong'),
    generateToken({ userId: 'alice', email: 'a@example.test' }, secret, '-1s'),
    generateToken({ userId: 'alice', email: 'a@example.test', type: 'refresh' }, secret),
  ]) expect(explorerAccount(req(token))).toBe(null);
});
