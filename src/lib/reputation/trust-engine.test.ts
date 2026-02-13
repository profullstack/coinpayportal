/**
 * Trust Engine Tests — CPTL Phase 2
 */

import { describe, it, expect } from 'vitest';
import {
  economicScale,
  diminishingReturns,
  recencyDecay,
  isValidActionCategory,
  CANONICAL_CATEGORIES,
  BASE_WEIGHTS,
} from './trust-engine';

describe('Trust Engine', () => {
  describe('isValidActionCategory', () => {
    it('accepts all canonical categories', () => {
      for (const cat of CANONICAL_CATEGORIES) {
        expect(isValidActionCategory(cat)).toBe(true);
      }
    });

    it('rejects invalid categories', () => {
      expect(isValidActionCategory('invalid.category')).toBe(false);
      expect(isValidActionCategory('')).toBe(false);
      expect(isValidActionCategory('economic')).toBe(false);
    });
  });

  describe('economicScale', () => {
    it('scales weight by log(1 + value_usd)', () => {
      // log(1 + 0) = 0
      expect(economicScale(10, 0)).toBe(0);
      // log(1 + 100) ≈ 4.615
      expect(economicScale(10, 100)).toBeCloseTo(10 * Math.log(101), 5);
      // negative values clamped to 0
      expect(economicScale(10, -50)).toBe(0);
    });

    it('handles negative base weights (disputes)', () => {
      expect(economicScale(-12, 100)).toBeCloseTo(-12 * Math.log(101), 5);
    });
  });

  describe('diminishingReturns', () => {
    it('applies log(1 + unique_count)', () => {
      expect(diminishingReturns(10, 0)).toBe(0);
      expect(diminishingReturns(10, 1)).toBeCloseTo(10 * Math.log(2), 5);
      expect(diminishingReturns(10, 10)).toBeCloseTo(10 * Math.log(11), 5);
    });

    it('grows sub-linearly', () => {
      const at10 = diminishingReturns(10, 10);
      const at100 = diminishingReturns(10, 100);
      // 100 unique actions should NOT give 10x more than 10
      expect(at100 / at10).toBeLessThan(3);
    });
  });

  describe('recencyDecay', () => {
    it('returns 1 for 0 days', () => {
      expect(recencyDecay(0)).toBe(1);
    });

    it('returns ~0.5 at 90 days (half-life)', () => {
      expect(recencyDecay(90)).toBeCloseTo(0.5, 2);
    });

    it('returns ~0.25 at 180 days', () => {
      expect(recencyDecay(180)).toBeCloseTo(0.25, 2);
    });

    it('approaches 0 for very old data', () => {
      expect(recencyDecay(365)).toBeLessThan(0.1);
    });
  });

  describe('BASE_WEIGHTS', () => {
    it('has correct weights per PRD', () => {
      expect(BASE_WEIGHTS['economic.transaction']).toBe(10);
      expect(BASE_WEIGHTS['economic.dispute']).toBe(-12);
      expect(BASE_WEIGHTS['productivity.completion']).toBe(5);
      expect(BASE_WEIGHTS['productivity.application']).toBe(1);
      expect(BASE_WEIGHTS['identity.verification']).toBe(3);
      expect(BASE_WEIGHTS['identity.profile_update']).toBe(0.5);
      expect(BASE_WEIGHTS['social.post']).toBe(0.05);
      expect(BASE_WEIGHTS['social.comment']).toBe(0.02);
      expect(BASE_WEIGHTS['compliance.violation']).toBe(-20);
    });
  });
});
