import { describe, it, expect, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getClientIp } from './client-ip';

function requestWith(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/api/anything', { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getClientIp', () => {
  // X-Forwarded-For is APPENDED to by each proxy, so a value the client sent
  // ends up on the LEFT and the address the edge actually saw on the RIGHT.
  // Reading the leftmost entry — which this used to do — hands the attacker
  // control of the rate-limit bucket.
  it('takes the rightmost entry, not the client-supplied leftmost one', () => {
    const req = requestWith({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' });
    expect(getClientIp(req)).toBe('203.0.113.9');
  });

  it('cannot be steered by prepending a forged address', () => {
    const forged = requestWith({ 'x-forwarded-for': '9.9.9.9, 8.8.8.8, 203.0.113.9' });
    const honest = requestWith({ 'x-forwarded-for': '203.0.113.9' });

    // Whatever the client prepends, the bucket stays the same.
    expect(getClientIp(forged)).toBe(getClientIp(honest));
  });

  it('honours TRUSTED_PROXY_HOPS when more than one proxy is in front', () => {
    vi.stubEnv('TRUSTED_PROXY_HOPS', '2');
    const req = requestWith({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9, 10.0.0.7' });
    // Two hops in from the right: skip the innermost proxy's own address.
    expect(getClientIp(req)).toBe('203.0.113.9');
  });

  it('ignores vendor headers unless they are explicitly trusted', () => {
    // The origin may be reachable directly, in which case these are just
    // another value the caller picks.
    const req = requestWith({
      'cf-connecting-ip': '6.6.6.6',
      'x-real-ip': '7.7.7.7',
      'x-forwarded-for': '203.0.113.9',
    });
    expect(getClientIp(req)).toBe('203.0.113.9');
  });

  it('uses vendor headers when the deployment opts in', () => {
    vi.stubEnv('TRUST_VENDOR_IP_HEADERS', 'true');
    const req = requestWith({
      'cf-connecting-ip': '6.6.6.6',
      'x-forwarded-for': '203.0.113.9',
    });
    expect(getClientIp(req)).toBe('6.6.6.6');
  });

  it('falls back to unknown rather than trusting a malformed value', () => {
    expect(getClientIp(requestWith({ 'x-forwarded-for': 'not-an-ip' }))).toBe('unknown');
    expect(getClientIp(requestWith({}))).toBe('unknown');
  });

  it('handles a single-entry header', () => {
    expect(getClientIp(requestWith({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9');
  });
});
