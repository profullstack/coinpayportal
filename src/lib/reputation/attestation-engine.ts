/**
 * Reputation Protocol — Attestation Engine
 * Computes credentials from receipts
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { signCredential } from './crypto';
import { analyzeAgent } from './anti-gaming';

interface ReputationWindow {
  task_count: number;
  accepted_count: number;
  disputed_count: number;
  total_volume: number;
  unique_buyers: number;
  avg_task_value: number;
  accepted_rate: number;
  dispute_rate: number;
  categories: Record<string, { count: number; volume: number }>;
}

interface ReputationResult {
  agent_did: string;
  windows: {
    last_30_days: ReputationWindow;
    last_90_days: ReputationWindow;
    all_time: ReputationWindow;
  };
  anti_gaming: {
    flagged: boolean;
    flags: string[];
    adjusted_weight: number;
  };
}

async function computeWindow(
  supabase: SupabaseClient,
  agentDid: string,
  since?: string
): Promise<ReputationWindow> {
  let query = supabase
    .from('reputation_receipts')
    .select('*')
    .eq('agent_did', agentDid);

  if (since) {
    query = query.gte('created_at', since);
  }

  const { data: receipts } = await query;

  if (!receipts || receipts.length === 0) {
    return {
      task_count: 0, accepted_count: 0, disputed_count: 0,
      total_volume: 0, unique_buyers: 0, avg_task_value: 0,
      accepted_rate: 0, dispute_rate: 0, categories: {},
    };
  }

  const accepted = receipts.filter((r: Record<string, unknown>) => r.outcome === 'accepted').length;
  const disputed = receipts.filter((r: Record<string, unknown>) => r.dispute === true).length;
  const totalVolume = receipts.reduce((sum: number, r: Record<string, unknown>) => sum + (Number(r.amount) || 0), 0);
  const uniqueBuyers = new Set(receipts.map((r: Record<string, unknown>) => r.buyer_did)).size;
  const categories: Record<string, { count: number; volume: number }> = {};

  for (const r of receipts) {
    const cat = (r as Record<string, unknown>).category as string || 'uncategorized';
    if (!categories[cat]) categories[cat] = { count: 0, volume: 0 };
    categories[cat].count++;
    categories[cat].volume += Number((r as Record<string, unknown>).amount) || 0;
  }

  return {
    task_count: receipts.length,
    accepted_count: accepted,
    disputed_count: disputed,
    total_volume: totalVolume,
    unique_buyers: uniqueBuyers,
    avg_task_value: receipts.length > 0 ? totalVolume / receipts.length : 0,
    accepted_rate: receipts.length > 0 ? accepted / receipts.length : 0,
    dispute_rate: receipts.length > 0 ? disputed / receipts.length : 0,
    categories,
  };
}

/**
 * Compute full reputation for an agent
 */
export async function computeReputation(
  supabase: SupabaseClient,
  agentDid: string
): Promise<ReputationResult> {
  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const d90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const [last30, last90, allTime, antiGaming] = await Promise.all([
    computeWindow(supabase, agentDid, d30),
    computeWindow(supabase, agentDid, d90),
    computeWindow(supabase, agentDid),
    analyzeAgent(supabase, agentDid),
  ]);

  return {
    agent_did: agentDid,
    windows: {
      last_30_days: last30,
      last_90_days: last90,
      all_time: allTime,
    },
    anti_gaming: {
      flagged: antiGaming.flagged,
      flags: antiGaming.flags,
      adjusted_weight: antiGaming.adjustedWeight,
    },
  };
}

/**
 * Issue a credential from computed reputation
 */
export async function issueCredential(
  supabase: SupabaseClient,
  agentDid: string,
  credentialType: string,
  category: string | null,
  windowDays: number
): Promise<Record<string, unknown> | null> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const since = windowDays > 0 ? windowStart.toISOString() : undefined;
  const windowData = await computeWindow(supabase, agentDid, since);

  const credentialData = {
    agent_did: agentDid,
    credential_type: credentialType,
    category,
    data: windowData as unknown as Record<string, unknown>,
    window_start: windowStart.toISOString(),
    window_end: now.toISOString(),
    issued_at: now.toISOString(),
  };

  const signature = signCredential(credentialData);

  const { data: credential, error } = await supabase
    .from('reputation_credentials')
    .insert({
      ...credentialData,
      signature,
    })
    .select()
    .single();

  if (error) return null;
  return credential as Record<string, unknown>;
}
