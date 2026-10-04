import { describe, it, expect, vi, beforeEach } from 'vitest';
import { inspectHeaders } from '../src/headers.js';
import { lookupIp, createIpCache } from '../src/ip.js';
import { score, isNonHuman } from '../src/score.js';
import { analyze, analyzeSync } from '../src/index.js';

/** A Request-alike carrying exactly the headers given. */
function req(headers = {}) {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: { get: (n) => map.get(String(n).toLowerCase()) ?? null } };
}

/** What a real Chrome navigation looks like. */
const CHROME = {
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-dest': 'document',
  'sec-ch-ua': '"Chromium";v="148"',
  'accept': 'text/html,application/xhtml+xml',
  'accept-language': 'en-US,en;q=0.9',
  'accept-encoding': 'gzip, deflate, br',
};

describe('inspectHeaders', () => {
  it('reads a real Chrome navigation as an unremarkable browser', () => {
    const s = inspectHeaders(req(CHROME));
    expect(s.spoofedBrowser).toBe(false);
    expect(s.hasFetchMetadata).toBe(true);
    expect(s.browserHeaderCount).toBeGreaterThanOrEqual(5);
  });

  it('catches a Chrome string with no Sec-Fetch-Mode', () => {
    // The whole point: Chromium cannot omit this header, so a request that
    // claims Chrome and lacks it is an HTTP client wearing a copied string.
    const { 'sec-fetch-mode': _drop, ...spoofed } = CHROME;
    const s = inspectHeaders(req(spoofed));
    expect(s.spoofedBrowser).toBe(true);
  });

  it('does NOT accuse Googlebot, which claims Chrome and sends no Sec-Fetch', () => {
    // Googlebot's evergreen string contains "compatible;" and "Googlebot".
    // Convicting it here would cut off search indexing.
    const s = inspectHeaders(req({
      'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/W.X.Y.Z Safari/537.36',
    }));
    expect(s.spoofedBrowser).toBe(false);
    expect(s.declaresItself).toBe(true);
  });

  it('does not accuse a browser that never claimed Chromium', () => {
    // Older Firefox/Safari predate Sec-Fetch; absence proves nothing there.
    const s = inspectHeaders(req({
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15',
      accept: 'text/html',
      'accept-language': 'en',
    }));
    expect(s.spoofedBrowser).toBe(false);
  });

  it('spots self-identified tools and a missing user agent', () => {
    expect(inspectHeaders(req({ 'user-agent': 'curl/8.4.0' })).obviousTool).toBe(true);
    expect(inspectHeaders(req({ 'user-agent': 'python-requests/2.31' })).obviousTool).toBe(true);
    expect(inspectHeaders(req({})).missingUserAgent).toBe(true);
  });
});

describe('score', () => {
  it('calls a real browser human', () => {
    const r = score(inspectHeaders(req(CHROME)));
    expect(r.verdict).toBe('human');
  });

  it('calls a spoofed browser automated on headers alone', () => {
    const { 'sec-fetch-mode': _d, ...spoofed } = CHROME;
    const r = score(inspectHeaders(req(spoofed)));
    expect(r.verdict).toBe('automated');
    expect(r.reasons.join(' ')).toMatch(/Sec-Fetch-Mode/);
  });

  it('calls a bare HTTP client automated', () => {
    const r = score(inspectHeaders(req({ 'user-agent': 'curl/8.4.0' })));
    expect(r.verdict).toBe('automated');
  });

  it('does not convict on a hosting address alone', () => {
    // Corporate VPN, university egress and privacy relays all resolve to
    // infrastructure while carrying real readers. Hosting corroborates; it
    // must never be sufficient by itself.
    const r = score(inspectHeaders(req(CHROME)), {
      unknown: false, isHosting: true, isProxy: false, isVpn: false, isTor: false,
    });
    expect(r.verdict).not.toBe('automated');
  });

  it('treats an unknown lookup as no evidence, not as innocence', () => {
    const withUnknown = score(inspectHeaders(req(CHROME)), {
      unknown: true, isHosting: false, isProxy: false, isVpn: false, isTor: false,
    });
    const headersOnly = score(inspectHeaders(req(CHROME)));
    expect(withUnknown.score).toBe(headersOnly.score);
  });

  it('adds hosting to a weak browser claim to reach automated', () => {
    const r = score(
      inspectHeaders(req({ 'user-agent': CHROME['user-agent'] })), // no other headers
      { unknown: false, isHosting: true, isProxy: true, isVpn: false, isTor: false },
    );
    expect(r.verdict).toBe('automated');
  });
});

describe('isNonHuman', () => {
  it('charges the unclear middle by default, and can be told not to', () => {
    const unclear = { verdict: 'unclear' };
    expect(isNonHuman(unclear)).toBe(true);
    expect(isNonHuman(unclear, { chargeUnclear: false })).toBe(false);
  });

  it('never counts a human as non-human', () => {
    expect(isNonHuman({ verdict: 'human' })).toBe(false);
    expect(isNonHuman({ verdict: 'human' }, { chargeUnclear: false })).toBe(false);
  });
});

describe('lookupIp', () => {
  let fetchImpl;
  let cache;

  beforeEach(() => {
    cache = createIpCache();
    fetchImpl = vi.fn();
  });

  it('reads ip-api hosting and proxy flags', async () => {
    fetchImpl.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'success', countryCode: 'US', isp: 'Amazon.com', hosting: true, proxy: false }),
    });
    const r = await lookupIp('1.2.3.4', { fetch: fetchImpl, cache });
    expect(r.isHosting).toBe(true);
    expect(r.unknown).toBe(false);
  });

  it('treats a cloud ISP as hosting, NOT as trusted', () => {
    // The extracted service scored google/amazon/microsoft as TRUSTED, which
    // for scraper detection is backwards: that is where scraping runs from.
    return lookupIp('1.2.3.4', {
      cache: createIpCache(),
      fetch: async () => ({
        ok: true,
        json: async () => ({ status: 'success', isp: 'Google LLC', countryCode: 'US' }),
      }),
    }).then((r) => expect(r.isHosting).toBe(true));
  });

  it('marks a failed lookup unknown rather than clean', async () => {
    fetchImpl.mockResolvedValue({ ok: false, status: 429 });
    const r = await lookupIp('1.2.3.4', { fetch: fetchImpl, cache });
    expect(r.unknown).toBe(true);
    expect(r.isProxy).toBe(false);
  });

  it('never throws when the upstream dies', async () => {
    fetchImpl.mockRejectedValue(new Error('ECONNRESET'));
    const r = await lookupIp('1.2.3.4', { fetch: fetchImpl, cache });
    expect(r.unknown).toBe(true);
  });

  it('serves the second call from cache', async () => {
    fetchImpl.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'success', isp: 'Comcast', countryCode: 'US' }),
    });
    await lookupIp('9.9.9.9', { fetch: fetchImpl, cache });
    const second = await lookupIp('9.9.9.9', { fetch: fetchImpl, cache });
    expect(second.fromCache).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('bounds the cache so scraper traffic cannot grow it without limit', () => {
    const small = createIpCache({ max: 3 });
    for (let i = 0; i < 10; i++) small.set(`10.0.0.${i}`, { ip: `10.0.0.${i}` });
    expect(small.size).toBeLessThanOrEqual(3);
  });
});

describe('analyze', () => {
  it('makes no network call unless an ip is supplied', async () => {
    const fetchImpl = vi.fn();
    const r = await analyze(req(CHROME), { fetch: fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.ip).toBeNull();
    expect(r.nonHuman).toBe(false);
  });

  it('analyzeSync answers without awaiting anything', () => {
    const r = analyzeSync(req({ 'user-agent': 'curl/8.4.0' }));
    expect(r.verdict).toBe('automated');
    expect(r.nonHuman).toBe(true);
  });
});
