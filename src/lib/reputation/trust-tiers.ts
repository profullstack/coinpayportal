/**
 * Trust Tiers — Maps trust vectors to credit-style tiers (A/B/C/D/F)
 * Inspired by isnad's /verify/trust endpoint
 */

import type { TrustVector } from './trust-engine';

export type TrustTier = 'A' | 'B' | 'C' | 'D' | 'F';

export interface TrustTierResult {
  tier: TrustTier;
  score: number; // 0-100 composite
  label: string;
  description: string;
  risk_level: 'low' | 'medium' | 'high' | 'very_high' | 'extreme';
}

const TIER_WEIGHTS = {
  E: 0.30, // Economic — heaviest weight (money talks)
  P: 0.15, // Productivity
  B: 0.25, // Behavioral (dispute rate matters a lot)
  D: 0.10, // Diversity
  R: 0.10, // Recency
  A: 0.05, // Anomaly (penalty, already negative)
  C: 0.05, // Compliance (penalty, already negative)
};

/**
 * Compute a composite score (0-100) from a trust vector
 */
export function computeCompositeScore(vector: TrustVector): number {
  // Normalize each dimension to 0-10 range
  // E, P: log-scaled raw scores, cap at 100 for normalization
  const eNorm = Math.min(vector.E / 10, 10);
  const pNorm = Math.min(vector.P / 10, 10);
  // B: already 0-10
  const bNorm = vector.B;
  // D: log-scaled, cap at ~4.6 (100 unique counterparties)
  const dNorm = Math.min(vector.D / 0.46, 10);
  // R: 0-1, scale to 0-10
  const rNorm = vector.R * 10;
  // A, C: negative penalties, add them (they reduce score)
  const aNorm = Math.max(vector.A, -10);
  const cNorm = Math.max(vector.C, -10);

  const weighted =
    eNorm * TIER_WEIGHTS.E +
    pNorm * TIER_WEIGHTS.P +
    bNorm * TIER_WEIGHTS.B +
    dNorm * TIER_WEIGHTS.D +
    rNorm * TIER_WEIGHTS.R +
    aNorm * TIER_WEIGHTS.A +
    cNorm * TIER_WEIGHTS.C;

  // Scale to 0-100
  return Math.max(0, Math.min(100, weighted * 10));
}

/**
 * Map a composite score to a credit-style tier
 */
export function scoreToTier(score: number): TrustTierResult {
  if (score >= 80) {
    return { tier: 'A', score, label: 'Excellent', description: 'Highly trusted agent with strong track record', risk_level: 'low' };
  }
  if (score >= 60) {
    return { tier: 'B', score, label: 'Good', description: 'Reliable agent with solid history', risk_level: 'medium' };
  }
  if (score >= 40) {
    return { tier: 'C', score, label: 'Fair', description: 'Moderate trust — some risk indicators', risk_level: 'high' };
  }
  if (score >= 20) {
    return { tier: 'D', score, label: 'Poor', description: 'Low trust — significant risk factors', risk_level: 'very_high' };
  }
  return { tier: 'F', score, label: 'Untrusted', description: 'No trust established or severe violations', risk_level: 'extreme' };
}

/**
 * Compute trust tier from a trust vector
 */
export function computeTrustTier(vector: TrustVector): TrustTierResult {
  return scoreToTier(computeCompositeScore(vector));
}
