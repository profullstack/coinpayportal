import { describe, it, expect } from 'vitest';
import {
  BLOCK_THRESHOLD,
  VERIFY_THRESHOLD,
  scoreCheckout,
  type MerchantSnapshot,
  type ScoringInput,
  type VelocitySnapshot,
} from './rules';
import { detectMisrepresentation } from './misrepresentation';

const quietVelocity: VelocitySnapshot = {
  attemptsPerIp10m: 1,
  distinctEmailsPerIp1h: 1,
  attemptsPerEmail10m: 1,
  declinesPerBusiness1h: 0,
  declinesPerIp1h: 0,
  smallAmountAttempts10m: 0,
  disputesPerBusiness30d: 0,
};

const cleanMerchant: MerchantSnapshot = {
  riskLevel: 'low',
  reviewStatus: 'not_required',
  category: 'ecommerce-retail',
  linkedBusinessIds: [],
  linkedToBlockedBusiness: false,
};

function score(overrides: Partial<ScoringInput> = {}) {
  return scoreCheckout({
    velocity: quietVelocity,
    merchant: cleanMerchant,
    email: 'buyer@example.com',
    amount: 4999,
    ...overrides,
  });
}

describe('scoreCheckout', () => {
  it('allows an ordinary payment', () => {
    const result = score();
    expect(result.decision).toBe('allow');
    expect(result.score).toBe(0);
  });

  it('blocks outright on a blocklist match and stops scoring', () => {
    const result = score({ blocklistAction: 'block', blocklistReason: 'chargeback ring' });
    expect(result.decision).toBe('block');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].code).toBe('blocklist');
    expect(result.findings[0].detail).toBe('chargeback ring');
  });

  it('blocks a prohibited merchant category', () => {
    const result = score({ merchant: { ...cleanMerchant, riskLevel: 'prohibited', category: 'gambling' } });
    expect(result.decision).toBe('block');
  });

  it('blocks a merchant rejected in review', () => {
    const result = score({ merchant: { ...cleanMerchant, reviewStatus: 'rejected' } });
    expect(result.decision).toBe('block');
  });

  it('caps the score at 100', () => {
    const result = score({
      merchant: { ...cleanMerchant, riskLevel: 'prohibited', reviewStatus: 'rejected' },
    });
    expect(result.score).toBe(100);
  });

  describe('card testing patterns', () => {
    it('blocks a burst of declines from one network', () => {
      const result = score({
        velocity: {
          ...quietVelocity,
          declinesPerIp1h: 4,
          attemptsPerIp10m: 6,
          distinctEmailsPerIp1h: 4,
        },
      });
      expect(result.score).toBeGreaterThanOrEqual(BLOCK_THRESHOLD);
      expect(result.decision).toBe('block');
      expect(result.findings.map((f) => f.code)).toContain('ip-declines');
    });

    it('escalates a run of small charges to verification', () => {
      const result = score({
        amount: 100,
        velocity: { ...quietVelocity, smallAmountAttempts10m: 4, declinesPerBusiness1h: 5 },
      });
      expect(result.decision).toBe('verify');
      expect(result.findings.map((f) => f.code)).toEqual(
        expect.arrayContaining(['small-amount-burst', 'merchant-declines'])
      );
    });

    it('flags many buyers behind one IP', () => {
      const result = score({ velocity: { ...quietVelocity, distinctEmailsPerIp1h: 7 } });
      expect(result.score).toBeGreaterThanOrEqual(VERIFY_THRESHOLD);
      expect(result.findings.map((f) => f.code)).toContain('ip-many-emails');
    });

    it('does not fire on a single quiet attempt', () => {
      expect(score({ velocity: { ...quietVelocity, distinctEmailsPerIp1h: 2 } }).decision).toBe('allow');
    });
  });

  describe('merchant signals', () => {
    it('adds score for a high-risk merchant awaiting review', () => {
      const result = score({
        merchant: { ...cleanMerchant, riskLevel: 'high', reviewStatus: 'pending', category: 'streaming-iptv' },
      });
      expect(result.score).toBe(40);
      expect(result.decision).toBe('verify');
    });

    it('escalates when linked to a blocked business', () => {
      const result = score({
        merchant: {
          ...cleanMerchant,
          linkedBusinessIds: ['biz-2'],
          linkedToBlockedBusiness: true,
        },
      });
      expect(result.decision).toBe('verify');
      expect(result.findings.map((f) => f.code)).toContain('linked-to-blocked');
    });
  });

  describe('misrepresentation', () => {
    it('scores a VPN business actually selling IPTV', () => {
      const mis = detectMisrepresentation({
        declaredCategory: 'hosting-infrastructure',
        texts: ['12 month IPTV subscription with VOD'],
      });
      expect(mis.mismatch).toBe(true);

      const result = score({
        misrepresentation: mis,
        merchant: { ...cleanMerchant, category: 'hosting-infrastructure' },
      });
      expect(result.findings.map((f) => f.code)).toContain('category-misrepresentation');
      expect(result.decision).toBe('verify');
    });

    it('ignores activity consistent with the declaration', () => {
      const mis = detectMisrepresentation({
        declaredCategory: 'ecommerce-retail',
        texts: ['Blue cotton t-shirt, size medium'],
      });
      expect(mis.mismatch).toBe(false);
      expect(score({ misrepresentation: mis }).decision).toBe('allow');
    });
  });

  describe('buyer signals', () => {
    it('adds score for a disposable mailbox', () => {
      const result = score({ email: 'x@mailinator.com' });
      expect(result.findings.map((f) => f.code)).toContain('disposable-email');
    });

    it('adds a little for no email at all', () => {
      const result = score({ email: null });
      expect(result.findings.map((f) => f.code)).toContain('no-email');
      expect(result.decision).toBe('allow');
    });
  });

  it('sorts findings worst first', () => {
    const result = score({
      email: 'x@mailinator.com',
      velocity: { ...quietVelocity, declinesPerIp1h: 5 },
    });
    expect(result.findings[0].code).toBe('ip-declines');
  });
});
