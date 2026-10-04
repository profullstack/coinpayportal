import { describe, expect, it, afterEach, vi } from 'vitest';
import { getRpId, getOrigin } from './config';

/**
 * Regression tests for G-1.2-08 and NEW-05 (2026-08-19 audit).
 *
 * The RP ID and the origin were resolved independently, each from its own
 * environment variable with its own fallback. Setting one and not the other left
 * the pair decoupled — `expectedRPID` pinned by config while `expectedOrigin`
 * came from the request, or the reverse — and WebAuthn's security rests entirely
 * on those two agreeing. Both also fell back to the `Host` header, which a
 * client chooses.
 */

function req(host: string, proto?: string): Request {
  const headers = new Headers({ host });
  if (proto) headers.set('x-forwarded-proto', proto);
  return new Request('https://example.test/', { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('WebAuthn RP ID and origin', () => {
  it('derives the origin from the RP ID when only the RP ID is set', () => {
    // The decoupling case: previously the RP ID was pinned and the origin came
    // from the request header.
    vi.stubEnv('WEBAUTHN_RP_ID', 'coinpayportal.com');
    vi.stubEnv('WEBAUTHN_ORIGIN', '');

    const request = req('attacker.example');
    expect(getRpId(request)).toBe('coinpayportal.com');
    expect(getOrigin(request)).toBe('https://coinpayportal.com');
  });

  it('derives the RP ID from the origin when only the origin is set', () => {
    vi.stubEnv('WEBAUTHN_RP_ID', '');
    vi.stubEnv('WEBAUTHN_ORIGIN', 'https://coinpayportal.com');

    const request = req('attacker.example');
    expect(getRpId(request)).toBe('coinpayportal.com');
    expect(getOrigin(request)).toBe('https://coinpayportal.com');
  });

  it('accepts a subdomain origin within the configured RP ID', () => {
    vi.stubEnv('WEBAUTHN_RP_ID', 'coinpayportal.com');
    vi.stubEnv('WEBAUTHN_ORIGIN', 'https://app.coinpayportal.com');

    expect(getRpId()).toBe('coinpayportal.com');
    expect(getOrigin()).toBe('https://app.coinpayportal.com');
  });

  it('refuses a configured pair that does not belong together', () => {
    // The misconfiguration that silently weakened every ceremony is now a loud
    // error instead.
    vi.stubEnv('WEBAUTHN_RP_ID', 'coinpayportal.com');
    vi.stubEnv('WEBAUTHN_ORIGIN', 'https://evil.example');

    expect(() => getRpId()).toThrow(/not within/i);
  });

  it('ignores an unrecognised Host header rather than trusting it', () => {
    // NEW-05: a client chooses this header. Trusting it let credentials be
    // registered and verified against a domain the attacker controls.
    vi.stubEnv('WEBAUTHN_RP_ID', '');
    vi.stubEnv('WEBAUTHN_ORIGIN', '');

    const request = req('attacker.example');
    expect(getRpId(request)).toBe('coinpayportal.com');
    expect(getOrigin(request)).toBe('https://coinpayportal.com');
  });

  it('still allows localhost for development', () => {
    vi.stubEnv('WEBAUTHN_RP_ID', '');
    vi.stubEnv('WEBAUTHN_ORIGIN', '');

    const request = req('localhost:3000', 'http');
    expect(getRpId(request)).toBe('localhost');
    expect(getOrigin(request)).toBe('http://localhost:3000');
  });

  it('always returns a matching pair, whatever the input', () => {
    // The invariant the whole file exists to hold.
    vi.stubEnv('WEBAUTHN_RP_ID', '');
    vi.stubEnv('WEBAUTHN_ORIGIN', '');

    for (const host of ['attacker.example', 'coinpayportal.com', 'localhost:3000']) {
      const request = req(host);
      const rpId = getRpId(request);
      const originHost = new URL(getOrigin(request)).hostname;
      expect(originHost === rpId || originHost.endsWith(`.${rpId}`)).toBe(true);
    }
  });
});
