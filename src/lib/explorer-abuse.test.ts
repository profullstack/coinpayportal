import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { accountBanMinutes, createExplorerAbuseGuard, explorerFingerprint } from './explorer-abuse';
const req = (ip: string, headers = {}) => new Request('https://coinpayportal.com/explorer/sol/tx/hash', { headers: { 'x-forwarded-for': ip, 'user-agent': 'test browser', ...headers } });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it('bans a rotating fleet for an hour based on matching browser headers', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  let now = 1_000_000;
  const guard = createExplorerAbuseGuard(() => now);
  for (let i = 0; i < 59; i++) expect(guard(req(`198.51.100.${i}`), null).blocked).toBe(false);
  expect(guard(req('198.51.100.60'), null).blocked).toBe(true);
  now += 60_001;
  expect(guard(req('203.0.113.1'), null).blocked).toBe(true);
  // A separately verified account doesn't share an anonymous cohort's ban.
  expect(guard(req('203.0.113.1'), 'alice').blocked).toBe(false);
  now += 3_600_000;
  expect(guard(req('203.0.113.1'), null).blocked).toBe(false);
});
it('does not ban a common user agent without fleet behavior', () => {
  const guard = createExplorerAbuseGuard();
  for (let i = 0; i < 100; i++) expect(guard(req('198.51.100.1'), null).blocked).toBe(false);
});
it('ignores credentials and IP in the fingerprint but distinguishes client hints', () => {
  expect(explorerFingerprint(req('198.51.100.1'))).toBe(explorerFingerprint(req('203.0.113.1', { cookie: 'token=secret', authorization: 'Bearer other' })));
  expect(explorerFingerprint(req('198.51.100.1'))).not.toBe(explorerFingerprint(req('198.51.100.1', { 'sec-ch-ua-platform': 'Linux' })));
});
it('enforces explicit account and fingerprint bans', () => {
  const guard = createExplorerAbuseGuard();
  vi.stubEnv('EXPLORER_BANNED_ACCOUNTS', 'alice');
  expect(guard(req('198.51.100.1'), 'alice').blocked).toBe(true);
  vi.stubEnv('EXPLORER_BANNED_FINGERPRINTS', explorerFingerprint(req('198.51.100.1')));
  expect(guard(req('203.0.113.1'), 'bob').blocked).toBe(true);
});
it('bans an account hammering from multiple addresses even with renewed tokens', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const guard = createExplorerAbuseGuard();
  for (let i = 0; i < 120; i++) expect(guard(req(`198.51.100.${i}`), 'alice').blocked).toBe(false);
  expect(guard(req('203.0.113.1'), 'alice').blocked).toBe(true);
});

it('escalates repeat account bans through Fibonacci minutes without extending an active ban', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  let now = 1_000_000;
  const guard = createExplorerAbuseGuard(() => now);
  for (const minutes of [1, 2, 3, 5, 8, 13, 21]) {
    for (let i = 0; i < 120; i++) expect(guard(req('198.51.100.1'), 'repeat-offender').blocked).toBe(false);
    expect(guard(req('198.51.100.1'), 'repeat-offender').retryAfterSeconds).toBe(minutes * 60);
    now += 30_000;
    for (let i = 0; i < 20; i++) expect(guard(req('203.0.113.1'), 'repeat-offender').retryAfterSeconds).toBe(minutes * 60 - 30);
    now += minutes * 60_000 - 30_000;
  }
});

it('persists account ban expiry and the next Fibonacci strike across restarts', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const directory = mkdtempSync(join(tmpdir(), 'explorer-bans-'));
  let now = Date.now();
  try {
    let guard = createExplorerAbuseGuard(() => now, directory);
    for (let i = 0; i < 121; i++) guard(req('198.51.100.1'), 'persisted-account');
    guard = createExplorerAbuseGuard(() => now, directory);
    expect(guard(req('203.0.113.1'), 'persisted-account').retryAfterSeconds).toBe(60);
    now += 60_000;
    for (let i = 0; i < 120; i++) expect(guard(req('203.0.113.1'), 'persisted-account').blocked).toBe(false);
    expect(guard(req('203.0.113.1'), 'persisted-account').retryAfterSeconds).toBe(120);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
it('caps Fibonacci bans at 24 hours', () => {
  expect([1, 2, 3, 4, 5].map(accountBanMinutes)).toEqual([1, 2, 3, 5, 8]);
  expect(accountBanMinutes(16)).toBe(1440);
  expect(accountBanMinutes(1000)).toBe(1440);
});
