/**
 * Reputation Protocol — Attestation Engine
 * Computes credentials from receipts
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { signCredential } from './crypto';
import { checkAntiGaming } from './anti-gaming';

export interface ReputationSummary {
  agent_did: string;
  total_tasks: number;
  completed: number;
  failed: number;
  disputed: number;
  cancelled: number;
  completion_rate: number;
  dispute_rate: number;
  total_volume: number;
  avg_task_value: number;
  unique_buyers: number;
  categories: Record<string, { count: number; volume: number }>;
  anti_gaming: Awaited<ReturnType<typeof checkAntiGaming>>;
}

/**
 * Aggregate reputation for an agent across time windows
 */
export async function aggregateReputation(
  supabase: SupabaseClient,
  agentDid: string,
  windowDays?: number
): Promise<ReputationSummary> {
  let query = supabase
    .from('reputation_receipts')
    .select('*')
    .eq('agent_did', agentDid);

  if (windowDays) {
    const windowStart = new Date(Date.now() - windowDays * 86400000).toISOString();
    query = query.gte('created_at', windowStart);
  }

  const { data: receipts } = await query;
  const items = receipts || [];

  const completed = items.filter(r => r.outcome === 'completed').length;
  const failed = items.filter(r => r.outcome === 'failed').length;
  const disputed = items.filter(r => r.outcome === 'disputed').length;
  const cancelled = items.filter(r => r.outcome === 'cancelled').length;
  const totalVolume = items.reduce((s, r) => s + Number(r.amount), 0);
  const uniqueBuyers = new Set(items.map(r => r.buyer_did));

  // Category breakdown
  const categories: Record<string, { count: number; volume: number }> = {};
  for (const r of items) {
    const cat = r.category || 'general';
    if (!categories[cat]) categories[cat] = { count: 0, volume: 0 };
    categories[cat].count++;
    categories[cat].volume += Number(r.amount);
  }

  const antiGaming = await checkAntiGaming(supabase, agentDid, windowDays || 30);

  return {
    agent_did: agentDid,
    total_tasks: items.length,
    completed,
    failed,
    disputed,
    cancelled,
    completion_rate: items.length > 0 ? completed / items.length : 0,
    dispute_rate: items.length > 0 ? disputed / items.length : 0,
    total_volume: totalVolume,
    avg_task_value: items.length > 0 ? totalVolume / items.length : 0,
    unique_buyers: uniqueBuyers.size,
    categories,
    anti_gaming: antiGaming,
  };
}

/**
 * Compute and store credentials from receipts
 */
export async function computeCredentials(
  supabase: SupabaseClient,
  agentDid: string,
  windowDays: number = 30
): Promise<string[]> {
  const summary = await aggregateReputation(supabase, agentDid, windowDays);
  const credentialIds: string[] = [];
  const windowStart = new Date(Date.now() - windowDays * 86400000).toISOString();
  const windowEnd = new Date().toISOString();

  // Skip if anti-gaming flagged
  if (summary.anti_gaming.flagged) return credentialIds;

  const credentialTypes: Array<{ type: string; data: Record<string, unknown>; condition: boolean }> = [
    {
      type: 'volume',
      data: { total_tasks: summary.total_tasks, completion_rate: summary.completion_rate },
      condition: summary.total_tasks >= 5,
    },
    {
      type: 'dispute_rate',
      data: { dispute_rate: summary.dispute_rate, total_tasks: summary.total_tasks },
      condition: summary.total_tasks >= 5 && summary.dispute_rate < 0.1,
    },
    {
      type: 'economic_volume',
      data: { total_volume: summary.total_volume, avg_task_value: summary.avg_task_value },
      condition: summary.total_volume > 100,
    },
  ];

  // Category specialization credentials
  for (const [cat, info] of Object.entries(summary.categories)) {
    if (info.count >= 3) {
      credentialTypes.push({
        type: 'category_specialization',
        data: { category: cat, count: info.count, volume: info.volume },
        condition: true,
      });
    }
  }

  for (const cred of credentialTypes) {
    if (!cred.condition) continue;

    const credData = {
      agent_did: agentDid,
      credential_type: cred.type,
      data: cred.data,
      window_start: windowStart,
      window_end: windowEnd,
      issuer_did: 'did:web:coinpayportal.com',
    };

    const signature = signCredential(credData);

    const { data, error } = await supabase
      .from('reputation_credentials')
      .insert({ ...credData, signature })
      .select('id')
      .single();

    if (!error && data) {
      credentialIds.push(data.id);
    }
  }

  return credentialIds;
}

/**
 * Get multi-window reputation (30d, 90d, all-time)
 */
export async function getMultiWindowReputation(
  supabase: SupabaseClient,
  agentDid: string
): Promise<{ '30d': ReputationSummary; '90d': ReputationSummary; all: ReputationSummary }> {
  const [d30, d90, all] = await Promise.all([
    aggregateReputation(supabase, agentDid, 30),
    aggregateReputation(supabase, agentDid, 90),
    aggregateReputation(supabase, agentDid),
  ]);

  return { '30d': d30, '90d': d90, all };
}
