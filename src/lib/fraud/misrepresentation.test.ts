import { describe, it, expect } from 'vitest';
import { detectMisrepresentation } from './misrepresentation';

describe('detectMisrepresentation', () => {
  it('catches a VPN business billing for IPTV', () => {
    const result = detectMisrepresentation({
      declaredCategory: 'hosting-infrastructure',
      texts: [
        'VPN Premium - 1 month',
        '12 month IPTV subscription, 20000 live channels',
        'Restream reseller panel credits',
      ],
    });

    expect(result.mismatch).toBe(true);
    expect(result.declaredRisk).toBe('medium');
    expect(result.observedRisk).toBe('high');
    expect(result.observedCategories).toContain('streaming-iptv');
    expect(result.observedFlags).toContain('piracy');
    expect(result.matchedKeywords).toEqual(expect.arrayContaining(['iptv']));
  });

  it('accepts activity that matches the declaration', () => {
    const result = detectMisrepresentation({
      declaredCategory: 'streaming-iptv',
      texts: ['12 month IPTV subscription'],
    });
    // Declared high, observed high — no gap, so nothing to report.
    expect(result.mismatch).toBe(false);
  });

  it('flags a retail shop taking gambling payments', () => {
    const result = detectMisrepresentation({
      declaredCategory: 'ecommerce-retail',
      texts: ['Casino chips top-up', 'sportsbook deposit'],
    });
    expect(result.mismatch).toBe(true);
    expect(result.observedRisk).toBe('high');
    expect(result.observedFlags).toContain('gambling');
  });

  it('does not call a mismatch on a merely suggestive word', () => {
    // "wallet" points at crypto tooling in the taxonomy, but a leather wallet
    // in a retail shop is not a misrepresentation.
    const result = detectMisrepresentation({
      declaredCategory: 'ecommerce-retail',
      texts: ['Leather wallet, brown'],
    });
    expect(result.mismatch).toBe(false);
  });

  it('is quiet when there is nothing to look at', () => {
    const result = detectMisrepresentation({ declaredCategory: 'saas', texts: [] });
    expect(result.mismatch).toBe(false);
    expect(result.observedCategories).toEqual([]);
  });

  it('ignores blank and null entries', () => {
    const result = detectMisrepresentation({
      declaredCategory: 'saas',
      texts: [null, '   ', undefined],
    });
    expect(result.mismatch).toBe(false);
  });

  it('treats an undeclared category as medium risk', () => {
    const result = detectMisrepresentation({
      declaredCategory: null,
      texts: ['Monthly subscription'],
    });
    expect(result.declaredRisk).toBe('medium');
    expect(result.declaredCategory).toBeNull();
  });

  it('does not flag ordinary retail wording', () => {
    const result = detectMisrepresentation({
      declaredCategory: 'ecommerce-retail',
      texts: ['Blue cotton t-shirt', 'Leather wallet', 'Shipping to Ohio'],
    });
    expect(result.mismatch).toBe(false);
    expect(result.observedFlags).toEqual([]);
  });
});
