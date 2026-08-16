import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('dns/promises', () => ({
  lookup: vi.fn(),
}));

import { lookup } from 'dns/promises';
import { checkUrlSafety, isBlockedAddress, safeFetch } from './ssrf';

const publicAddress = [{ address: '93.184.216.34', family: 4 }];

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '127.42.7.9',
    '0.0.0.0',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '224.0.0.1',
    '255.255.255.255',
  ])('blocks IPv4 %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    '::1',
    '::',
    'fd00::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '::ffff:169.254.169.254',
    '::ffff:a9fe:a9fe',
    '::ffff:127.0.0.1',
  ])('blocks IPv6 %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '2606:2800:220:1:248:1893:25c8:1946'])(
    'allows public %s',
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    },
  );

  it('refuses anything that is not a parseable address', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true);
    expect(isBlockedAddress('')).toBe(true);
  });
});

describe('checkUrlSafety', () => {
  beforeEach(() => {
    vi.mocked(lookup).mockReset();
    vi.mocked(lookup).mockResolvedValue(publicAddress as never);
  });

  it.each([
    ['decimal-encoded IPv4', 'http://2852039166/'],
    ['hex-encoded IPv4', 'http://0xA9FEA9FE/'],
    ['octal-encoded IPv4', 'http://0251.0376.0251.0376/'],
    ['IPv4-mapped IPv6', 'http://[::ffff:169.254.169.254]/'],
  ])('rejects %s without consulting DNS', async (_label, url) => {
    const result = await checkUrlSafety(url);
    expect(result.safe).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects a name that resolves to a blocked address', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as never);

    const result = await checkUrlSafety('https://rebind.example.com/hook');

    expect(result.safe).toBe(false);
    if (!result.safe) expect(result.reason).toMatch(/blocked address/);
  });

  it('rejects a name where only ONE of several records is blocked', async () => {
    // Checking just the first record lets a host with a public A record and a
    // private one through half the time.
    vi.mocked(lookup).mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ] as never);

    const result = await checkUrlSafety('https://mixed.example.com/hook');

    expect(result.safe).toBe(false);
  });

  it('rejects a URL carrying credentials', async () => {
    const result = await checkUrlSafety('https://user:pass@example.com/hook');
    expect(result.safe).toBe(false);
  });

  it('rejects non-http schemes', async () => {
    for (const url of ['file:///etc/passwd', 'gopher://example.com/', 'ftp://example.com/']) {
      expect((await checkUrlSafety(url)).safe).toBe(false);
    }
  });

  it('allows a public https host', async () => {
    const result = await checkUrlSafety('https://api.merchant.com/webhook');
    expect(result.safe).toBe(true);
  });

  it('refuses a host that does not resolve rather than guessing', async () => {
    vi.mocked(lookup).mockRejectedValue(new Error('ENOTFOUND'));
    expect((await checkUrlSafety('https://nope.example.com/')).safe).toBe(false);
  });
});

describe('safeFetch', () => {
  beforeEach(() => {
    vi.mocked(lookup).mockReset();
    vi.mocked(lookup).mockResolvedValue(publicAddress as never);
    vi.stubGlobal('fetch', vi.fn());
  });

  it('re-validates each redirect hop', async () => {
    // Only the first URL was ever checked, so a public host that 302s to the
    // metadata service defeated validation entirely.
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      status: 302,
      headers: new Headers({ location: 'http://169.254.169.254/latest/meta-data/' }),
    } as never);

    const result = await safeFetch('https://api.merchant.com/webhook');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Redirect target rejected/);
  });

  it('follows a redirect to another public host', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce({
        status: 302,
        headers: new Headers({ location: 'https://cdn.merchant.com/webhook' }),
      } as never)
      .mockResolvedValueOnce({ status: 200, ok: true, headers: new Headers() } as never);

    const result = await safeFetch('https://api.merchant.com/webhook');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.finalUrl).toContain('cdn.merchant.com');
  });

  it('gives up rather than following redirects forever', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      status: 302,
      headers: new Headers({ location: 'https://loop.merchant.com/next' }),
    } as never);

    const result = await safeFetch('https://api.merchant.com/webhook', { maxRedirects: 2 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Too many redirects/);
  });

  it('never issues the request when the initial URL is blocked', async () => {
    const result = await safeFetch('http://169.254.169.254/latest/meta-data/');

    expect(result.ok).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
