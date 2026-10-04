/**
 * Reading and writing agent wallets.
 *
 * The decision itself lives in ./limits, which is pure. This file is the part
 * that talks to the database, kept separate so the rule that stops someone's
 * money can be read and tested without a Supabase client in the way.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentLimits, AgentSpending, AgentStatus } from './limits';

export interface AgentWallet {
  id: string;
  businessId: string;
  name: string;
  address: string;
  status: AgentStatus;
  limits: AgentLimits;
  createdAt: string;
  updatedAt: string;
}

interface AgentWalletRow {
  id: string;
  business_id: string;
  name: string;
  address: string;
  status: AgentStatus;
  per_payment_limit_usd: string | number | null;
  daily_limit_usd: string | number | null;
  total_limit_usd: string | number | null;
  created_at: string;
  updated_at: string;
}

/**
 * Postgres `numeric` arrives as a string from PostgREST, because a numeric can
 * hold values a double cannot. These are dollar limits well inside a double's
 * range, so parsing is safe here, but it has to be done explicitly rather than
 * left to a comparison between a string and a number.
 */
const toNumber = (value: string | number | null): number | null => {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const rowToAgent = (row: AgentWalletRow): AgentWallet => ({
  id: row.id,
  businessId: row.business_id,
  name: row.name,
  address: row.address,
  status: row.status,
  limits: {
    perPaymentUsd: toNumber(row.per_payment_limit_usd),
    dailyUsd: toNumber(row.daily_limit_usd),
    totalUsd: toNumber(row.total_limit_usd),
  },
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * EVM addresses are case-insensitive and arrive in mixed checksum case. Every
 * comparison and every stored row uses the fold, so that a lookup is an
 * equality test on an indexed column rather than a scan.
 */
export const normaliseAddress = (address: string): string => address.trim().toLowerCase();

/**
 * The agent registered for a payer address, or null when the address belongs to
 * nobody. A null is the ordinary case: most payers are not agents, and they are
 * not subject to any of this.
 */
export async function findAgentByAddress(
  supabase: SupabaseClient,
  address: string,
): Promise<AgentWallet | null> {
  if (!address) return null;
  const { data, error } = await supabase
    .from('agent_wallets')
    .select('*')
    .eq('address', normaliseAddress(address))
    .maybeSingle();

  if (error || !data) return null;
  return rowToAgent(data as AgentWalletRow);
}

/**
 * What an agent has spent: the rolling 24 hours the daily limit covers, and its
 * whole life.
 *
 * A rolling window rather than a calendar day on purpose. A calendar day resets
 * at a boundary the agent's operator did not choose and probably is not in the
 * timezone of, and it lets an agent spend a full allowance either side of
 * midnight — twice the limit in a couple of hours.
 */
export async function getSpending(
  supabase: SupabaseClient,
  agentWalletId: string,
  now: Date = new Date(),
): Promise<AgentSpending> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('agent_spends')
    .select('amount_usd, created_at')
    .eq('agent_wallet_id', agentWalletId);

  if (error || !data) return { last24hUsd: 0, lifetimeUsd: 0 };

  let last24hUsd = 0;
  let lifetimeUsd = 0;
  for (const row of data as { amount_usd: string | number; created_at: string }[]) {
    const amount = toNumber(row.amount_usd) ?? 0;
    lifetimeUsd += amount;
    if (row.created_at >= since) last24hUsd += amount;
  }
  return { last24hUsd, lifetimeUsd };
}

/**
 * Record a spend we allowed through. Called only after the broadcast succeeded:
 * a refused or failed settlement must not consume an agent's allowance.
 *
 * The nonce makes this idempotent. It is single-use on the token itself, so a
 * retried settle for a payment already broadcast collides with the unique index
 * and is dropped rather than counted twice. A conflict is therefore success,
 * not an error.
 */
export async function recordSpend(
  supabase: SupabaseClient,
  spend: {
    agentWalletId: string;
    amountUsd: number;
    network: string;
    nonce?: string | null;
    txHash?: string | null;
  },
): Promise<void> {
  await supabase.from('agent_spends').insert({
    agent_wallet_id: spend.agentWalletId,
    amount_usd: spend.amountUsd,
    network: spend.network,
    nonce: spend.nonce ?? null,
    tx_hash: spend.txHash ?? null,
  });
}

/**
 * Token units to USD.
 *
 * The v2 rail is USDC only: EIP-3009 is an ERC-20 extension, so a native coin
 * cannot be paid this way, and every method we offer is a six-decimal USDC
 * deployment. One USDC is one dollar, so the conversion is exact and needs no
 * price feed.
 *
 * Returns null for anything else. That matters: a limit cannot be enforced on
 * an amount we cannot price, and the caller treats null as a refusal rather
 * than waving the payment through unmeasured.
 */
export function usdFromTokenUnits(amount: string | bigint, decimals = 6): number | null {
  if (decimals !== 6) return null;
  let units: bigint;
  try {
    units = typeof amount === 'bigint' ? amount : BigInt(amount);
  } catch {
    return null;
  }
  if (units < 0n) return null;
  // Cents, then dollars, so the division happens once in integer space and the
  // result is a clean two-decimal number rather than a float with a tail.
  const cents = units / 10_000n;
  const remainder = units % 10_000n;
  const rounded = remainder >= 5_000n ? cents + 1n : cents;
  return Number(rounded) / 100;
}
