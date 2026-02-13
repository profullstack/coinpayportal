/**
 * Reputation Protocol — Anti-Gaming Detection
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface AntiGamingResult {
  flagged: boolean;
  flags: string[];
  adjustedWeight: number; // 0-1, lower = more suspicious
}

/**
 * Detect circular payment patterns (agent↔buyer loops)
 */
export async function detectCircularPayments(
  supabase: SupabaseClient,
  agentDid: string,
  buyerDid: string
): Promise<{ circular: boolean; count: number }> {
  // Check if agent_did has also acted as buyer for this buyer_did acting as agent
  const { data: reverseReceipts } = await supabase
    .from('reputation_receipts')
    .select('id')
    .eq('agent_did', buyerDid)
    .eq('buyer_did', agentDid)
    .limit(1);

  const count = reverseReceipts?.length || 0;
  return { circular: count > 0, count };
}

/**
 * Detect burst activity (abnormal clustering of receipts)
 */
export async function detectBurst(
  supabase: SupabaseClient,
  agentDid: string,
  windowMinutes: number = 60,
  threshold: number = 10
): Promise<{ burst: boolean; count: number }> {
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  
  const { data: recentReceipts, count } = await supabase
    .from('reputation_receipts')
    .select('id', { count: 'exact' })
    .eq('agent_did', agentDid)
    .gte('created_at', windowStart);

  const receiptCount = count || 0;
  return { burst: receiptCount >= threshold, count: receiptCount };
}

/**
 * Check minimum economic threshold
 */
export function checkMinimumThreshold(
  amount: number | null | undefined,
  minAmount: number = 0.01
): boolean {
  return (amount || 0) >= minAmount;
}

/**
 * Calculate buyer diversity score for an agent
 */
export async function calculateBuyerDiversity(
  supabase: SupabaseClient,
  agentDid: string,
  since?: string
): Promise<{ uniqueBuyers: number; totalTasks: number; diversityScore: number }> {
  let query = supabase
    .from('reputation_receipts')
    .select('buyer_did')
    .eq('agent_did', agentDid);

  if (since) {
    query = query.gte('created_at', since);
  }

  const { data: receipts } = await query;

  if (!receipts || receipts.length === 0) {
    return { uniqueBuyers: 0, totalTasks: 0, diversityScore: 0 };
  }

  const uniqueBuyers = new Set(receipts.map((r: { buyer_did: string }) => r.buyer_did)).size;
  const totalTasks = receipts.length;
  // Diversity score: ratio of unique buyers to total tasks (capped at 1)
  const diversityScore = Math.min(uniqueBuyers / totalTasks, 1);

  return { uniqueBuyers, totalTasks, diversityScore };
}

/**
 * Run full anti-gaming analysis on an agent
 */
export async function analyzeAgent(
  supabase: SupabaseClient,
  agentDid: string
): Promise<AntiGamingResult> {
  const flags: string[] = [];
  let weight = 1.0;

  // Check burst
  const burst = await detectBurst(supabase, agentDid);
  if (burst.burst) {
    flags.push(`burst_detected: ${burst.count} receipts in last hour`);
    weight *= 0.5;
  }

  // Check buyer diversity
  const diversity = await calculateBuyerDiversity(supabase, agentDid);
  if (diversity.totalTasks > 5 && diversity.diversityScore < 0.2) {
    flags.push(`low_buyer_diversity: ${diversity.uniqueBuyers}/${diversity.totalTasks}`);
    weight *= 0.3;
  }

  return {
    flagged: flags.length > 0,
    flags,
    adjustedWeight: weight,
  };
}
