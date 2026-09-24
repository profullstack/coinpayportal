import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The exclusions are the safety-critical half of this file, not the matching.
 *
 * A false negative costs us one free page view. A false positive answers a
 * paying customer — or Railway's healthcheck, which would fail every future
 * deploy — with a demand for USDC. So each exclusion is pinned individually.
 */

const matches = vi.fn();
vi.mock('@profullstack/footprint/cloud', () => ({
  createCloudMatcher: () => ({
    matches: (ip: string) => matches(ip),
    refresh: vi.fn().mockResolvedValue({ size: 1, failed: [] }),
    size: 1,
    lastRefresh: Date.now(),
    lastError: null,
  }),
}));

const { judgeCloudClient, clientAddress, cloudGate, cloudGateway } = await import('./cloud-gate');

const CLOUD_IP = '3.0.0.1';

function req(headers: Record<string, string> = {}) {
  return new Request('https://coinpayportal.com/reputation', { headers });
}

beforeEach(() => {
  matches.mockReset();
  matches.mockImplementation((ip: string) => ip === CLOUD_IP);
  vi.stubEnv('CLOUD_CHARGE', 'pages');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('judgeCloudClient', () => {
  it('charges a cloud address on a page route', () => {
    const v = judgeCloudClient(req({ 'x-forwarded-for': CLOUD_IP }), '/reputation');
    expect(v.charge).toBe(true);
  });

  it('does not charge an address outside every published range', () => {
    const v = judgeCloudClient(req({ 'x-forwarded-for': '86.1.2.3' }), '/reputation');
    expect(v).toMatchObject({ charge: false, reason: 'not a published cloud range' });
  });

  it('is inert unless CLOUD_CHARGE=pages', () => {
    // Ships off. Merging it must not start charging anyone.
    vi.stubEnv('CLOUD_CHARGE', 'off');
    expect(judgeCloudClient(req({ 'x-forwarded-for': CLOUD_IP }), '/reputation')).toMatchObject({
      charge: false,
      reason: 'disabled',
    });
    vi.stubEnv('CLOUD_CHARGE', '');
    expect(judgeCloudClient(req({ 'x-forwarded-for': CLOUD_IP }), '/reputation').charge).toBe(false);
  });

  it('never charges an internal caller with no forwarded address', () => {
    // Railway runs ON a cloud and healthchecks `/`. Charging this would mark
    // the deploy unhealthy and break every future deploy.
    const v = judgeCloudClient(req(), '/');
    expect(v).toMatchObject({ charge: false, reason: 'no client address (internal)' });
  });

  it('never charges /api/, where integrations and webhooks arrive', () => {
    // Stripe, Column and Plaid all call us from cloud addresses by nature.
    for (const path of ['/api/webhooks/stripe', '/api/x402/settle', '/api/payments']) {
      expect(judgeCloudClient(req({ 'x-forwarded-for': CLOUD_IP }), path)).toMatchObject({
        charge: false,
        reason: 'api route',
      });
    }
  });

  it('never charges a search crawler, even from a cloud address', () => {
    // These send readers back; charging them de-indexes the site.
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0)',
      'PerplexityBot/1.0',
      'OAI-SearchBot/1.0',
    ]) {
      expect(
        judgeCloudClient(req({ 'x-forwarded-for': CLOUD_IP, 'user-agent': ua }), '/reputation'),
      ).toMatchObject({ charge: false, reason: 'search crawler' });
    }
  });

  it('never charges an uptime monitor', async () => {
    // Not politeness. A monitor counts 200-399 as up, so a 402 does not bill
    // it — it reports the site as DOWN. Ours runs on Railway, from a cloud
    // address, so without this we page ourselves.
    for (const ua of ['CrawlProof-Uptime/1.0', 'UptimeRobot/2.0', 'Pingdom.com_bot', 'Better Uptime Bot']) {
      expect(
        judgeCloudClient(req({ 'x-forwarded-for': CLOUD_IP, 'user-agent': ua }), '/'),
      ).toMatchObject({ charge: false, reason: 'uptime monitor' });
    }

    const answer = await cloudGate(
      new Request('https://coinpayportal.com/', {
        headers: { 'x-forwarded-for': CLOUD_IP, 'user-agent': 'CrawlProof-Uptime/1.0' },
      }),
      '/',
    );
    expect(answer).toBeNull();
  });

  it('never charges a signed-in customer', () => {
    const v = judgeCloudClient(
      req({ 'x-forwarded-for': CLOUD_IP, cookie: 'sb-abcdef-auth-token=xyz' }),
      '/dashboard',
    );
    expect(v).toMatchObject({ charge: false, reason: 'signed in' });
  });

  it('actually answers 402, rather than deciding and then being overruled', async () => {
    // The bug this pins: the first version delegated to the CRAWL gateway,
    // whose isPaidAgent defaults to the training-crawler list. It re-decided
    // the question this module had just answered, saw an ordinary Chrome user
    // agent, returned null, and charged nobody — while every unit test of
    // judgeCloudClient passed, because the verdict was never the broken half.
    const answer = await cloudGate(
      new Request('https://coinpayportal.com/reputation', {
        headers: {
          'x-forwarded-for': CLOUD_IP,
          'user-agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
          'sec-fetch-mode': 'navigate',
        },
      }),
      '/reputation',
    );
    expect(answer).not.toBeNull();
    expect(answer!.status).toBe(402);
  });

  it('lets an address outside every range through the gate untouched', async () => {
    const answer = await cloudGate(
      new Request('https://coinpayportal.com/reputation', {
        headers: { 'x-forwarded-for': '86.1.2.3' },
      }),
      '/reputation',
    );
    expect(answer).toBeNull();
  });

  it('charges regardless of user agent, since the address already decided', () => {
    // The gateway must not re-apply a user-agent rule on top of the verdict.
    expect(cloudGateway).toBeDefined();
    for (const ua of ['curl/8.4.0', 'GPTBot/1.0', 'Mozilla/5.0 Chrome/148.0.0.0']) {
      const v = judgeCloudClient(req({ 'x-forwarded-for': CLOUD_IP, 'user-agent': ua }), '/reputation');
      expect(v.charge).toBe(true);
    }
  });

  it('reads the first hop of a forwarded chain', () => {
    // The client is the leftmost entry; the rest are our own proxies.
    expect(clientAddress(req({ 'x-forwarded-for': `${CLOUD_IP}, 10.0.0.1, 10.0.0.2` }))).toBe(CLOUD_IP);
    expect(clientAddress(req({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
    expect(clientAddress(req())).toBeNull();
  });
});
