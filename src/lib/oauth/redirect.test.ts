import { describe, it, expect, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

import { redirectUriMatches } from './client';
import { VALID_SCOPES, validateScopes } from './scopes';

describe('redirectUriMatches (RFC 8252 loopback)', () => {
  const registered = 'http://127.0.0.1/callback';

  it('matches exactly, and any port on a registered loopback redirect', () => {
    expect(redirectUriMatches('https://app.example/cb', 'https://app.example/cb')).toBe(true);
    expect(redirectUriMatches(registered, 'http://127.0.0.1:53124/callback')).toBe(true);
    expect(redirectUriMatches('http://[::1]/callback', 'http://[::1]:8080/callback')).toBe(true);
  });

  it('still requires the same host, path, query and no fragment', () => {
    expect(redirectUriMatches(registered, 'http://127.0.0.1:53124/other')).toBe(false);
    expect(redirectUriMatches(registered, 'http://127.0.0.1:53124/callback?x=1')).toBe(false);
    expect(redirectUriMatches(registered, 'http://127.0.0.1:53124/callback#x')).toBe(false);
    expect(redirectUriMatches(registered, 'http://localhost:53124/callback')).toBe(false);
    expect(redirectUriMatches(registered, 'http://127.0.0.2:53124/callback')).toBe(false);
    expect(redirectUriMatches(registered, 'http://user@127.0.0.1:53124/callback')).toBe(false);
  });

  it('never relaxes non-loopback redirects', () => {
    expect(redirectUriMatches('https://app.example/cb', 'https://app.example:8443/cb')).toBe(false);
    expect(redirectUriMatches('http://example.com/cb', 'http://example.com:81/cb')).toBe(false);
  });
});

describe('merchant scope', () => {
  it('is a valid scope a client must be registered for', () => {
    expect(VALID_SCOPES).toContain('merchant');
    expect(validateScopes('openid merchant', ['openid', 'profile'])).toEqual(['openid']);
    expect(validateScopes('openid profile merchant', ['openid', 'profile', 'merchant'])).toEqual(['openid', 'profile', 'merchant']);
  });
});
