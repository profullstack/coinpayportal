import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { checkUrl, clearGuardCache, isBlockedAddress, isInternalHostname } from './bank-guard';

describe('isBlockedAddress', () => {
  it('blocks every private, loopback, link-local, CGNAT and metadata address', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '64:ff9b::a00:1']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '159.53.224.21', '172.32.0.1', '100.128.0.1', '2606:4700::1111']) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });
});

describe('isInternalHostname', () => {
  it('catches Compose service names and local suffixes', () => {
    expect(isInternalHostname('supabase-db')).toBe(true);
    expect(isInternalHostname('redis')).toBe(true);
    expect(isInternalHostname('localhost')).toBe(true);
    expect(isInternalHostname('api.localhost')).toBe(true);
    expect(isInternalHostname('metadata.google.internal')).toBe(true);
    expect(isInternalHostname('printer.local')).toBe(true);
    expect(isInternalHostname('secure.chase.com')).toBe(false);
  });
});

describe('checkUrl', () => {
  beforeEach(() => clearGuardCache());
  const resolveTo = (map: Record<string, string[]>) => async (host: string) => {
    if (!map[host]) throw new Error('ENOTFOUND');
    return map[host]!;
  };

  it('allows a public https site and local-only schemes', async () => {
    const resolve = resolveTo({ 'secure.chase.com': ['159.53.224.21'] });
    expect(await checkUrl('https://secure.chase.com/web/auth/dashboard', resolve)).toEqual({ ok: true });
    expect(await checkUrl('data:text/html,hi', resolve)).toEqual({ ok: true });
    expect(await checkUrl('about:blank', resolve)).toEqual({ ok: true });
  });

  it('refuses plain http, file, chrome and internal hosts', async () => {
    const resolve = resolveTo({});
    expect((await checkUrl('http://example.com/', resolve)).ok).toBe(false);
    expect((await checkUrl('file:///etc/passwd', resolve)).ok).toBe(false);
    expect((await checkUrl('chrome://settings', resolve)).ok).toBe(false);
    expect((await checkUrl('https://supabase-db:5432/', resolve)).ok).toBe(false);
    expect((await checkUrl('https://127.0.0.1/', resolve)).ok).toBe(false);
    expect((await checkUrl('https://[::1]/', resolve)).ok).toBe(false);
  });

  it('refuses a public-looking name that resolves inside, even partly', async () => {
    const resolve = resolveTo({ 'evil.example': ['8.8.8.8', '10.0.0.7'], 'nope.example': [] });
    expect(await checkUrl('https://evil.example/', resolve)).toEqual({ ok: false, reason: 'resolves to a private address' });
    expect((await checkUrl('https://nope.example/', resolve)).ok).toBe(false);
    expect((await checkUrl('https://missing.example/', resolve)).ok).toBe(false);
  });
});
