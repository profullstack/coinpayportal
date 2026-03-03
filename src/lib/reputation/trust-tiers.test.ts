import { describe, it, expect } from 'vitest';
import { computeCompositeScore, scoreToTier, computeTrustTier } from './trust-tiers';
import type { TrustVector } from './trust-engine';

describe('Trust Tiers', () => {
  const makeVector = (overrides: Partial<TrustVector> = {}): TrustVector => ({
    E: 0, P: 0, B: 0, D: 0, R: 0, A: 0, C: 0,
    ...overrides,
  });

  describe('computeCompositeScore', () => {
    it('returns 0 for empty vector', () => {
      expect(computeCompositeScore(makeVector())).toBe(0);
    });

    it('returns higher score for strong economic activity', () => {
      const weak = computeCompositeScore(makeVector({ E: 5 }));
      const strong = computeCompositeScore(makeVector({ E: 50 }));
      expect(strong).toBeGreaterThan(weak);
    });

    it('penalizes anomaly flags', () => {
      const clean = computeCompositeScore(makeVector({ E: 20, B: 8 }));
      const flagged = computeCompositeScore(makeVector({ E: 20, B: 8, A: -5 }));
      expect(flagged).toBeLessThan(clean);
    });

    it('clamps to 0-100 range', () => {
      const score = computeCompositeScore(makeVector({ E: 1000, B: 10, P: 100, D: 5, R: 1 }));
      expect(score).toBeLessThanOrEqual(100);
      expect(score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('scoreToTier', () => {
    it('maps 80+ to tier A', () => {
      expect(scoreToTier(85).tier).toBe('A');
    });
    it('maps 60-79 to tier B', () => {
      expect(scoreToTier(65).tier).toBe('B');
    });
    it('maps 40-59 to tier C', () => {
      expect(scoreToTier(45).tier).toBe('C');
    });
    it('maps 20-39 to tier D', () => {
      expect(scoreToTier(25).tier).toBe('D');
    });
    it('maps <20 to tier F', () => {
      expect(scoreToTier(10).tier).toBe('F');
    });
  });

  describe('computeTrustTier', () => {
    it('returns F for zero vector', () => {
      expect(computeTrustTier(makeVector()).tier).toBe('F');
    });

    it('returns higher tier for well-rounded agent', () => {
      const result = computeTrustTier(makeVector({
        E: 80, P: 30, B: 9, D: 3, R: 0.8,
      }));
      expect(['A', 'B']).toContain(result.tier);
    });
  });
});
