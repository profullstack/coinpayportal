import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPaypalPlatformConfig, isPaypalPartnerModeEnabled, requirePaypalPlatformConfig } from './platform';

const KEYS = [
  'PAYPAL_PLATFORM_CLIENT_ID',
  'PAYPAL_PLATFORM_CLIENT_SECRET',
  'PAYPAL_PARTNER_MERCHANT_ID',
  'PAYPAL_ENVIRONMENT',
  'PAYPAL_BN_CODE',
  'PAYPAL_WEBHOOK_ID',
];

describe('getPaypalPlatformConfig', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('returns null when partner credentials are absent', () => {
    expect(getPaypalPlatformConfig()).toBeNull();
    expect(isPaypalPartnerModeEnabled()).toBe(false);
  });

  it('returns null when only some of the three required values are set', () => {
    process.env.PAYPAL_PLATFORM_CLIENT_ID = 'cid';
    process.env.PAYPAL_PLATFORM_CLIENT_SECRET = 'secret';
    // PAYPAL_PARTNER_MERCHANT_ID missing — without it there is nobody to pay
    // the platform fee to, so a partial config must not read as enabled.
    expect(getPaypalPlatformConfig()).toBeNull();
  });

  it('treats whitespace-only values as absent', () => {
    process.env.PAYPAL_PLATFORM_CLIENT_ID = '   ';
    process.env.PAYPAL_PLATFORM_CLIENT_SECRET = 'secret';
    process.env.PAYPAL_PARTNER_MERCHANT_ID = 'PARTNER1';
    expect(getPaypalPlatformConfig()).toBeNull();
  });

  it('defaults to the live environment', () => {
    process.env.PAYPAL_PLATFORM_CLIENT_ID = 'cid';
    process.env.PAYPAL_PLATFORM_CLIENT_SECRET = 'secret';
    process.env.PAYPAL_PARTNER_MERCHANT_ID = 'PARTNER1';

    const config = getPaypalPlatformConfig();
    expect(config?.environment).toBe('live');
    expect(config?.bnCode).toBeNull();
    expect(config?.webhookId).toBeNull();
    expect(isPaypalPartnerModeEnabled()).toBe(true);
  });

  it('reads sandbox and the optional partner fields', () => {
    process.env.PAYPAL_PLATFORM_CLIENT_ID = 'cid';
    process.env.PAYPAL_PLATFORM_CLIENT_SECRET = 'secret';
    process.env.PAYPAL_PARTNER_MERCHANT_ID = 'PARTNER1';
    process.env.PAYPAL_ENVIRONMENT = 'sandbox';
    process.env.PAYPAL_BN_CODE = 'BN123';
    process.env.PAYPAL_WEBHOOK_ID = 'WH123';

    const config = getPaypalPlatformConfig();
    expect(config).toMatchObject({
      environment: 'sandbox',
      partnerMerchantId: 'PARTNER1',
      bnCode: 'BN123',
      webhookId: 'WH123',
    });
  });

  it('requirePaypalPlatformConfig throws with an actionable message', () => {
    expect(() => requirePaypalPlatformConfig()).toThrow(/PAYPAL_PLATFORM_CLIENT_ID/);
  });
});
