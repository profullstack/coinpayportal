import { describe, it, expect } from 'vitest';
import {
  emailDomain,
  extractCheckoutSignals,
  ipPrefix,
  isDisposableEmail,
  normalizeEmail,
} from './signals';

describe('emailDomain', () => {
  it('extracts the domain', () => {
    expect(emailDomain('Buyer@Example.COM')).toBe('example.com');
  });

  it('rejects malformed addresses', () => {
    expect(emailDomain('no-at-sign')).toBeNull();
    expect(emailDomain('@nolocal.com')).toBeNull();
    expect(emailDomain('trailing@')).toBeNull();
    expect(emailDomain(null)).toBeNull();
  });
});

describe('normalizeEmail', () => {
  it('collapses gmail dots and plus-suffixes to one identity', () => {
    expect(normalizeEmail('j.doe+vpn@gmail.com')).toBe('jdoe@gmail.com');
    expect(normalizeEmail('JDoe@googlemail.com')).toBe('jdoe@gmail.com');
    expect(normalizeEmail('jdoe@gmail.com')).toBe('jdoe@gmail.com');
  });

  it('keeps dots on providers that treat them as significant', () => {
    expect(normalizeEmail('j.doe@fastmail.com')).toBe('j.doe@fastmail.com');
  });

  it('still strips plus-suffixes elsewhere', () => {
    expect(normalizeEmail('sales+two@shop.io')).toBe('sales@shop.io');
  });

  it('rejects malformed addresses', () => {
    expect(normalizeEmail('+only@gmail.com')).toBeNull();
    expect(normalizeEmail('nope')).toBeNull();
  });
});

describe('isDisposableEmail', () => {
  it('recognises throwaway providers', () => {
    expect(isDisposableEmail('a@mailinator.com')).toBe(true);
    expect(isDisposableEmail('a@gmail.com')).toBe(false);
  });
});

describe('ipPrefix', () => {
  it('groups IPv4 by /24', () => {
    expect(ipPrefix('203.0.113.42')).toBe('203.0.113.0/24');
    expect(ipPrefix('203.0.113.99')).toBe('203.0.113.0/24');
  });

  it('groups IPv6 by /48', () => {
    expect(ipPrefix('2001:db8:1234:5678::1')).toBe('2001:db8:1234::/48');
  });

  it('returns null for unusable values', () => {
    expect(ipPrefix('unknown')).toBeNull();
    expect(ipPrefix('')).toBeNull();
    expect(ipPrefix('1.2.3')).toBeNull();
    expect(ipPrefix(null)).toBeNull();
  });
});

describe('extractCheckoutSignals', () => {
  it('normalizes everything the rules read', () => {
    const signals = extractCheckoutSignals({
      businessId: 'biz-1',
      email: '  J.Doe+Test@Gmail.com ',
      ip: '203.0.113.42',
      amount: 499,
      currency: 'USD',
      description: '  12 month IPTV subscription ',
    });

    expect(signals.email).toBe('j.doe+test@gmail.com');
    expect(signals.emailNormalized).toBe('jdoe@gmail.com');
    expect(signals.emailDomain).toBe('gmail.com');
    expect(signals.ipPrefix).toBe('203.0.113.0/24');
    expect(signals.currency).toBe('usd');
    expect(signals.description).toBe('12 month IPTV subscription');
  });

  it('tolerates a request with nothing but a business id', () => {
    const signals = extractCheckoutSignals({ businessId: 'biz-1' });
    expect(signals.email).toBeNull();
    expect(signals.ip).toBeNull();
    expect(signals.ipPrefix).toBeNull();
    expect(signals.amount).toBeNull();
  });

  it('treats an unknown IP as absent', () => {
    expect(extractCheckoutSignals({ businessId: 'b', ip: 'unknown' }).ip).toBeNull();
  });
});
