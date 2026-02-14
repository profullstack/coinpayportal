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
 * Calculate buyer diversity for economic transactions only (excludes social/platform actions)
 */
export async function calculateEconomicDiversity(
  supabase: SupabaseClient,
  agentDid: string
): Promise<{ uniqueBuyers: number; totalTasks: number; diversityScore: number }> {
  const SOCIAL_CATEGORIES = ['social'];
  const SOCIAL_ACTIONS = ['post_created', 'comment_created', 'upvoted', 'content_downvoted', 'followed_user', 'endorsement_given', 'profile_completed', 'resume_uploaded', 'portfolio_added', 'verification_requested'];

  const { data: receipts } = await supabase
    .from('reputation_receipts')
    .select('buyer_did, category, action_type')
    .eq('agent_did', agentDid);

  if (!receipts || receipts.length === 0) {
    return { uniqueBuyers: 0, totalTasks: 0, diversityScore: 0 };
  }

  // Filter out social/platform actions
  const economicReceipts = receipts.filter((r: { buyer_did: string; category: string; action_type: string }) =>
    !SOCIAL_CATEGORIES.includes(r.category) && !SOCIAL_ACTIONS.includes(r.action_type)
  );

  if (economicReceipts.length === 0) {
    return { uniqueBuyers: 0, totalTasks: 0, diversityScore: 1 }; // No economic activity = no penalty
  }

  const uniqueBuyers = new Set(economicReceipts.map((r: { buyer_did: string }) => r.buyer_did)).size;
  const totalTasks = economicReceipts.length;
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

  // Check buyer diversity (only for economic transactions, not social/platform actions)
  const diversity = await calculateBuyerDiversity(supabase, agentDid);
  const economicDiversity = await calculateEconomicDiversity(supabase, agentDid);
  if (economicDiversity.totalTasks > 5 && economicDiversity.diversityScore < 0.2) {
    flags.push(`low_buyer_diversity: ${economicDiversity.uniqueBuyers}/${economicDiversity.totalTasks}`);
    weight *= 0.3;
  }

  return {
    flagged: flags.length > 0,
    flags,
    adjustedWeight: weight,
  };
}
