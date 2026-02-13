/**
 * Reputation Protocol — Anti-Gaming Engine
 * Detects circular payments, burst activity, and sybil-like patterns
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface AntiGamingFlags {
  circular_payment: boolean;
  burst_detected: boolean;
  below_economic_threshold: boolean;
  insufficient_unique_buyers: boolean;
  flagged: boolean;
  details: string[];
}

// Minimum economic threshold per receipt (USD equiv)
const MIN_ECONOMIC_THRESHOLD = 1.0;
// Maximum receipts per agent per hour before burst flag
const BURST_THRESHOLD = 20;
// Minimum unique buyers for credibility
const MIN_UNIQUE_BUYERS = 3;

/**
 * Run all anti-gaming checks for an agent
 */
export async function checkAntiGaming(
  supabase: SupabaseClient,
  agentDid: string,
  windowDays: number = 30
): Promise<AntiGamingFlags> {
  const flags: AntiGamingFlags = {
    circular_payment: false,
    burst_detected: false,
    below_economic_threshold: false,
    insufficient_unique_buyers: false,
    flagged: false,
    details: [],
  };

  const windowStart = new Date(Date.now() - windowDays * 86400000).toISOString();

  const { data: receipts } = await supabase
    .from('reputation_receipts')
    .select('agent_did, buyer_did, amount, created_at')
    .eq('agent_did', agentDid)
    .gte('created_at', windowStart)
    .order('created_at', { ascending: false });

  if (!receipts || receipts.length === 0) return flags;

  // 1. Circular payment detection: agent is also a buyer for the same counterparty
  await detectCircularPayments(supabase, agentDid, windowStart, flags);

  // 2. Burst detection
  detectBurst(receipts, flags);

  // 3. Minimum economic threshold
  const avgAmount = receipts.reduce((s, r) => s + Number(r.amount), 0) / receipts.length;
  if (avgAmount < MIN_ECONOMIC_THRESHOLD) {
    flags.below_economic_threshold = true;
    flags.details.push(`Average transaction ${avgAmount.toFixed(2)} below threshold ${MIN_ECONOMIC_THRESHOLD}`);
  }

  // 4. Unique buyer requirement
  const uniqueBuyers = new Set(receipts.map(r => r.buyer_did));
  if (uniqueBuyers.size < MIN_UNIQUE_BUYERS) {
    flags.insufficient_unique_buyers = true;
    flags.details.push(`Only ${uniqueBuyers.size} unique buyers (minimum ${MIN_UNIQUE_BUYERS})`);
  }

  flags.flagged = flags.circular_payment || flags.burst_detected ||
    flags.below_economic_threshold || flags.insufficient_unique_buyers;

  return flags;
}

/**
 * Detect circular payments: agent_did appears as buyer_did for their counterparties
 */
async function detectCircularPayments(
  supabase: SupabaseClient,
  agentDid: string,
  windowStart: string,
  flags: AntiGamingFlags
): Promise<void> {
  // Get all buyers who paid this agent
  const { data: agentReceipts } = await supabase
    .from('reputation_receipts')
    .select('buyer_did')
    .eq('agent_did', agentDid)
    .gte('created_at', windowStart);

  if (!agentReceipts || agentReceipts.length === 0) return;

  const buyerDids = [...new Set(agentReceipts.map(r => r.buyer_did))];

  // Check if this agent is a buyer for any of those counterparties
  const { data: reverseReceipts } = await supabase
    .from('reputation_receipts')
    .select('agent_did')
    .eq('buyer_did', agentDid)
    .in('agent_did', buyerDids)
    .gte('created_at', windowStart);

  if (reverseReceipts && reverseReceipts.length > 0) {
    flags.circular_payment = true;
    const circularAgents = [...new Set(reverseReceipts.map(r => r.agent_did))];
    flags.details.push(`Circular payments detected with: ${circularAgents.join(', ')}`);
  }
}

/**
 * Detect burst activity (too many receipts in short time)
 */
function detectBurst(
  receipts: Array<{ created_at: string }>,
  flags: AntiGamingFlags
): void {
  if (receipts.length < BURST_THRESHOLD) return;

  // Group by hour
  const hourBuckets = new Map<string, number>();
  for (const r of receipts) {
    const hour = r.created_at.slice(0, 13); // YYYY-MM-DDTHH
    hourBuckets.set(hour, (hourBuckets.get(hour) || 0) + 1);
  }

  for (const [hour, count] of hourBuckets) {
    if (count >= BURST_THRESHOLD) {
      flags.burst_detected = true;
      flags.details.push(`Burst: ${count} receipts in hour ${hour}`);
      break;
    }
  }
}
