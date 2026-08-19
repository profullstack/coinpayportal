/**
 * CPTL Phase 2 — Trust Engine
 * 7-dimension trust vector computation
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { analyzeAgent } from './anti-gaming';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface TrustVector {
  E: number; // Economic Score
  P: number; // Productivity Score
  B: number; // Behavioral Score
  D: number; // Diversity Score
  R: number; // Recency Score (overall recency factor)
  A: number; // Anomaly Penalty (0 = no penalty, negative = penalized)
  C: number; // Compliance Penalty (0 = no penalty, negative = penalized)
}

export interface TrustProfile {
  agent_did: string;
  trust_vector: TrustVector;
  computed_at: string;
}

// ═══════════════════════════════════════════════════════════
// Canonical Action Categories
// ═══════════════════════════════════════════════════════════

export const CANONICAL_CATEGORIES = [
  'economic.transaction',
  'economic.dispute',
  'economic.refund',
  'productivity.task',
  'productivity.application',
  'productivity.completion',
  'identity.profile_update',
  'identity.verification',
  'social.post',
  'social.comment',
  'social.endorsement',
  'compliance.incident',
  'compliance.violation',
] as const;

export type ActionCategory = typeof CANONICAL_CATEGORIES[number];

export function isValidActionCategory(cat: string): cat is ActionCategory {
  return (CANONICAL_CATEGORIES as readonly string[]).includes(cat);
}

// ═══════════════════════════════════════════════════════════
// Base Signal Weights
// ═══════════════════════════════════════════════════════════

export const BASE_WEIGHTS: Partial<Record<ActionCategory, number>> = {
  'economic.transaction': 10,
  'economic.dispute': -12,
  'productivity.completion': 5,
  'productivity.application': 1,
  'identity.verification': 3,
  'identity.profile_update': 0.5,
  'social.post': 0.05,
  'social.comment': 0.02,
  'compliance.violation': -20,
};

// Recency decay: 90-day half-life
const LAMBDA = Math.LN2 / 90;

// ═══════════════════════════════════════════════════════════
// Computation Helpers (exported for testing)
// ═══════════════════════════════════════════════════════════

/** Economic scaling: base_weight × log(1 + value_usd) */
export function economicScale(baseWeight: number, valueUsd: number): number {
  return baseWeight * Math.log(1 + Math.max(0, valueUsd));
}

/** Diminishing returns: base_weight × log(1 + unique_count) */
export function diminishingReturns(baseWeight: number, uniqueCount: number): number {
  return baseWeight * Math.log(1 + uniqueCount);
}

/** Recency decay weight */
export function recencyDecay(days: number): number {
  return Math.exp(-LAMBDA * days);
}

// ═══════════════════════════════════════════════════════════
// Trust Vector Computation
// ═══════════════════════════════════════════════════════════

interface ReceiptRow {
  action_category: string | null;
  action_type: string | null;
  amount: number | null;
  buyer_did: string | null;
  dispute: boolean | null;
  outcome: string | null;
  created_at: string;
  /**
   * On-chain settlement reference. Present only when the transaction actually
   * settled through escrow, which is what makes the receipt's `amount`
   * something other than a claim by the party being scored.
   */
  escrow_tx: string | null;
}

export async function computeTrustVector(
  supabase: SupabaseClient,
  agentDid: string
): Promise<TrustProfile> {
  const { data: receipts } = await supabase
    .from('reputation_receipts')
    .select('action_category, action_type, amount, buyer_did, dispute, outcome, created_at, escrow_tx')
    .eq('agent_did', agentDid);

  const rows: ReceiptRow[] = (receipts || []) as ReceiptRow[];
  const now = Date.now();

  // Track unique counts per action_category for diminishing returns
  const categoryUniqueCounts: Record<string, Set<string>> = {};

  // Accumulators
  let economicScore = 0;
  let productivityScore = 0;
  let complianceScore = 0;
  let recencyWeightedSum = 0;
  let recencyTotalWeight = 0;

  const counterparties = new Set<string>();
  let totalReceipts = 0;
  let disputeCount = 0;

  for (const r of rows) {
    totalReceipts++;
    const cat = (r.action_category || 'economic.transaction') as ActionCategory;
    const baseWeight = BASE_WEIGHTS[cat] ?? 0;
    const daysAgo = (now - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24);
    const decay = recencyDecay(daysAgo);

    // Track counterparties for diversity
    if (r.buyer_did) counterparties.add(r.buyer_did);

    // Track disputes for behavioral score
    if (r.dispute || r.outcome === 'disputed') disputeCount++;

    // Track unique action IDs per category for diminishing returns
    if (!categoryUniqueCounts[cat]) categoryUniqueCounts[cat] = new Set();
    categoryUniqueCounts[cat].add(`${r.created_at}-${r.buyer_did}`);

    const uniqueCount = categoryUniqueCounts[cat].size;
    const adjustedWeight = diminishingReturns(baseWeight, uniqueCount);

    // Economic scaling applies only to a VERIFIABLE amount.
    //
    // REP-F14-01: `amount` is written by the party being scored, and
    // `economicScale` multiplies weight by log(1 + amount) — so declaring large
    // values was the whole of the work needed to reach the top tier. The
    // anti-gaming penalty below is capped at -3 out of 100 and cannot offset
    // it. That score is consumed by `web-bot-auth/verify` for real trust
    // decisions.
    //
    // `escrow_tx` is the discriminator already available: it is set when the
    // transaction settled through escrow, so the amount corresponds to funds
    // that actually moved. A self-declared amount with no settlement behind it
    // still counts — the job may well have happened — but at unit weight, so it
    // cannot be inflated by choosing a bigger number.
    const amountIsVerifiable = !!r.escrow_tx;

    let signalWeight: number;
    if (cat.startsWith('economic.') && amountIsVerifiable && r.amount != null && r.amount > 0) {
      signalWeight = economicScale(adjustedWeight, r.amount);
    } else {
      signalWeight = adjustedWeight;
    }

    const decayedWeight = signalWeight * decay;

    // Route to correct dimension
    if (cat.startsWith('economic.')) {
      economicScore += decayedWeight;
    } else if (cat.startsWith('productivity.')) {
      productivityScore += decayedWeight;
    } else if (cat.startsWith('compliance.')) {
      complianceScore += decayedWeight;
    }
    // identity and social contribute to recency-weighted sum but not their own dimension
    recencyWeightedSum += Math.abs(signalWeight) * decay;
    recencyTotalWeight += Math.abs(signalWeight);
  }

  // D: Diversity Score
  const diversityScore = Math.log(1 + counterparties.size);

  // B: Behavioral Score (1 minus dispute rate, scaled 0-10)
  const disputeRate = totalReceipts > 0 ? disputeCount / totalReceipts : 0;
  const behavioralScore = totalReceipts > 0 ? (1 - disputeRate) * 10 : 0;

  // R: Recency Score (weighted average of decay factors, 0-1)
  const recencyScore = recencyTotalWeight > 0 ? recencyWeightedSum / recencyTotalWeight : 0;

  // A: Anomaly Penalty (from anti-gaming)
  const antiGaming = await analyzeAgent(supabase, agentDid);
  const anomalyPenalty = antiGaming.flagged ? Math.max(-(1 - antiGaming.adjustedWeight) * 5, -3) : 0; // Capped at -3 to prevent score destruction

  return {
    agent_did: agentDid,
    trust_vector: {
      E: Math.round(economicScore * 100) / 100,
      P: Math.round(productivityScore * 100) / 100,
      B: Math.round(behavioralScore * 100) / 100,
      D: Math.round(diversityScore * 100) / 100,
      R: Math.round(recencyScore * 100) / 100,
      A: Math.round(anomalyPenalty * 100) / 100,
      C: Math.round(complianceScore * 100) / 100,
    },
    computed_at: new Date().toISOString(),
  };
}
