import { randomBytes } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isPlatformSealed,
  openPlatformSecret,
  platformSealConfigured,
  PLATFORM_SEAL_PREFIX,
  sealPlatformSecret,
} from './platform-seal';

const AAD = 'paypal_accounts:biz-1:client_secret';

describe('PayPal platform seal (PAYPAL_SECRETS_KEY)', () => {
  beforeEach(() => vi.stubEnv('PAYPAL_SECRETS_KEY', randomBytes(32).toString('base64')));
  afterEach(() => vi.unstubAllEnvs());

  it('round-trips with a versioned prefix', () => {
    const sealed = sealPlatformSecret('the-client-secret', AAD);
    expect(sealed.startsWith(PLATFORM_SEAL_PREFIX)).toBe(true);
    expect(sealed).not.toContain('the-client-secret');
    expect(isPlatformSealed(sealed)).toBe(true);
    expect(openPlatformSecret(sealed, AAD)).toBe('the-client-secret');
  });

  it('uses a fresh IV every time', () => {
    expect(sealPlatformSecret('s', AAD)).not.toBe(sealPlatformSecret('s', AAD));
  });

  it('fails with the wrong AAD (another business)', () => {
    const sealed = sealPlatformSecret('the-client-secret', AAD);
    expect(() => openPlatformSecret(sealed, 'paypal_accounts:biz-2:client_secret')).toThrow();
  });

  it('fails with a different key', () => {
    const sealed = sealPlatformSecret('the-client-secret', AAD);
    vi.stubEnv('PAYPAL_SECRETS_KEY', randomBytes(32).toString('base64'));
    expect(() => openPlatformSecret(sealed, AAD)).toThrow();
  });

  it('fails on a tampered value', () => {
    const sealed = sealPlatformSecret('the-client-secret', AAD);
    const raw = Buffer.from(sealed.slice(PLATFORM_SEAL_PREFIX.length), 'base64');
    raw[14] ^= 0xff;
    expect(() => openPlatformSecret(PLATFORM_SEAL_PREFIX + raw.toString('base64'), AAD)).toThrow();
  });

  it('is not configured without a key, or with a key that is not 32 bytes', () => {
    expect(platformSealConfigured()).toBe(true);
    vi.stubEnv('PAYPAL_SECRETS_KEY', '');
    expect(platformSealConfigured()).toBe(false);
    expect(() => sealPlatformSecret('s', AAD)).toThrow(/not configured/);
    vi.stubEnv('PAYPAL_SECRETS_KEY', randomBytes(16).toString('base64'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(platformSealConfigured()).toBe(false);
    err.mockRestore();
  });

  it('recognises only its own prefix', () => {
    expect(isPlatformSealed('cpv1.abc')).toBe(false);
    expect(isPlatformSealed(null)).toBe(false);
  });
});
