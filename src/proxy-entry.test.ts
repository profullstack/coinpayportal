import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import * as crawl from './lib/crawl-gateway';
import * as throttle from './lib/throttle';
import { config, proxy } from './proxy';

const request = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
  new NextRequest(`https://coinpayportal.com${path}`, { headers, method });

function expectSecurityHeaders(response: Response) {
  expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains');
  expect(response.headers.get('X-Frame-Options')).toBe('DENY');
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
}

afterEach(() => vi.restoreAllMocks());

describe('security proxy response handling', () => {
  it('tracks referrals on the continuation response with security and CORS headers intact', async () => {
    const response = await proxy(request('/api/health?ref=partner', { origin: 'https://coinpayportal.com' }));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('set-cookie')).toContain('referral_code=partner');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://coinpayportal.com');
    expectSecurityHeaders(response);
  });

  it.each([200, 402, 307])('preserves a terminal gateway response with status %i', async (status) => {
    // A payment receipt or sales page can be 200; status alone is not a
    // continuation signal. Gateway responses are plain Response objects.
    const answer = new Response('gateway response', {
      status,
      headers: { 'Content-Type': 'text/plain', 'X-Payment-Response': 'receipt', Location: '/crawl', Vary: 'Accept, User-Agent, X-Payment' },
    });
    vi.spyOn(crawl, 'gate').mockResolvedValueOnce(answer);
    const meter = vi.spyOn(throttle, 'meter');
    const response = await proxy(request('/api/health?ref=partner', { origin: 'https://coinpayportal.com' }));
    expect(response).toBe(answer);
    expect(response.status).toBe(status);
    expect(await response.text()).toBe('gateway response');
    expect(response.headers.get('X-Payment-Response')).toBe('receipt');
    expect(response.headers.get('Location')).toBe('/crawl');
    expect(response.headers.get('Vary')).toBe('Accept, User-Agent, X-Payment, Origin');
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(response.headers.has('x-middleware-next')).toBe(false);
    expect(meter).not.toHaveBeenCalled();
    expectSecurityHeaders(response);
  });

  it('preserves throttle refusals and retry headers', async () => {
    const answer = new Response('Too many requests', { status: 429, headers: { 'Retry-After': '60' } });
    vi.spyOn(throttle, 'meter').mockResolvedValueOnce(answer);
    const response = await proxy(request('/api/health?ref=partner'));
    expect(response).toBe(answer);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(response.headers.has('set-cookie')).toBe(false);
    expectSecurityHeaders(response);
  });

  it.each([
    ['https://coinpayportal.com', 204],
    ['https://untrusted.example', 403],
  ])('preserves CORS preflight for %s', async (origin, status) => {
    const response = await proxy(request('/api/health?ref=partner', { origin }, 'OPTIONS'));
    expect(response.status).toBe(status);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(status === 204 ? origin : null);
    expect(response.headers.get('Vary')).toBe(status === 204 ? 'Origin' : null);
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(await response.text()).toBe('');
    expectSecurityHeaders(response);
  });

  it.each([false, true])('keeps HSTS off onion responses (gateway refusal: %s)', async (refused) => {
    if (refused) vi.spyOn(crawl, 'gate').mockResolvedValueOnce(new Response('Payment required', { status: 402 }));
    const response = await proxy(request('/pricing', { host: 'coinpay.onion' }));
    expect(response.headers.has('Strict-Transport-Security')).toBe(false);
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
  });
});

describe('runtime matcher', () => {
  it.each(['/api/health', '/api/auth/login', '/explorer/eth/tx/0x123', '/explorer-pass', '/crawl', '/pricing'])
  ('protects %s', (url) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(true);
  });

  it.each(['/_next/static/chunk.js', '/_next/image?url=test', '/favicon.ico', '/logo.svg', '/photo.png'])
  ('excludes static assets at %s', (url) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(false);
  });
});
