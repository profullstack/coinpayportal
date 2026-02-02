/**
 * Web Wallet Balance & Transaction Indexer
 *
 * Background polling scheduler that periodically refreshes cached balances
 * and scans for new transactions on all active wallet addresses.
 *
 * For single-server deployments. For multi-server, replace with a
 * distributed job queue (e.g. BullMQ / Redis).
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { refreshChainBalances } from './balance';
import { scanTransactions, upsertTransactions } from './transactions';
import type { WalletChain } from './identity';
import { VALID_CHAINS } from './identity';

// ──────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────

/** Polling intervals per chain category (milliseconds) */
export const POLL_INTERVALS: Record<string, number> = {
  // Fast chains - poll more frequently
  SOL: 10_000,        // 10 seconds
  USDC_SOL: 10_000,

  // Medium chains
  ETH: 15_000,        // 15 seconds
  POL: 15_000,
  USDC_ETH: 15_000,
  USDC_POL: 15_000,

  // Slow chains - poll less frequently
  BTC: 30_000,        // 30 seconds
  BCH: 30_000,
};

// ──────────────────────────────────────────────
// Indexer State
// ──────────────────────────────────────────────

interface IndexerState {
  isRunning: boolean;
  intervals: Map<string, ReturnType<typeof setInterval>>;
  lastRun: Map<string, number>;
  stats: {
    balancesUpdated: number;
    transactionsFound: number;
    errors: number;
  };
}

const state: IndexerState = {
  isRunning: false,
  intervals: new Map(),
  lastRun: new Map(),
  stats: {
    balancesUpdated: 0,
    transactionsFound: 0,
    errors: 0,
  },
};

// ──────────────────────────────────────────────
// Core Indexer Logic
// ──────────────────────────────────────────────

/**
 * Run a single indexing cycle for a given chain.
 * Refreshes balances and scans for new transactions.
 */
async function indexChain(supabase: SupabaseClient, chain: WalletChain): Promise<void> {
  try {
    // 1. Refresh balances for all active addresses on this chain
    const balanceResult = await refreshChainBalances(supabase, chain);
    state.stats.balancesUpdated += balanceResult.updated;
    state.stats.errors += balanceResult.errors;

    // 2. Scan for new transactions
    const { data: addresses, error } = await supabase
      .from('wallet_addresses')
      .select('id, wallet_id, address, chain')
      .eq('chain', chain)
      .eq('is_active', true);

    if (error || !addresses) return;

    for (const addr of addresses) {
      try {
        const rawTxs = await scanTransactions(addr.address, addr.chain as WalletChain);
        if (rawTxs.length > 0) {
          const result = await upsertTransactions(
            supabase,
            addr.wallet_id,
            addr.id,
            addr.chain as WalletChain,
            addr.address,
            rawTxs
          );
          state.stats.transactionsFound += result.inserted;
        }
      } catch (err) {
        console.error(`[Indexer] Transaction scan failed for ${addr.address} on ${chain}:`, err);
        state.stats.errors++;
      }
    }

    state.lastRun.set(chain, Date.now());
  } catch (err) {
    console.error(`[Indexer] Chain indexing failed for ${chain}:`, err);
    state.stats.errors++;
  }
}

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

/**
 * Start the indexer for all chains.
 */
export function startIndexer(): void {
  if (state.isRunning) return;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('[Indexer] Cannot start: missing Supabase credentials');
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  for (const chain of VALID_CHAINS) {
    const interval = POLL_INTERVALS[chain] || 30_000;
    const timerId = setInterval(() => {
      indexChain(supabase, chain).catch(() => {
        state.stats.errors++;
      });
    }, interval);

    // Don't prevent process exit
    if (timerId.unref) timerId.unref();
    state.intervals.set(chain, timerId);
  }

  state.isRunning = true;
  console.log('[Indexer] Started for chains:', VALID_CHAINS.join(', '));
}

/**
 * Stop the indexer.
 */
export function stopIndexer(): void {
  for (const [chain, timerId] of state.intervals) {
    clearInterval(timerId);
  }
  state.intervals.clear();
  state.isRunning = false;
  console.log('[Indexer] Stopped');
}

/**
 * Check if the indexer is running.
 */
export function isIndexerRunning(): boolean {
  return state.isRunning;
}

/**
 * Get indexer stats.
 */
export function getIndexerStats() {
  return {
    isRunning: state.isRunning,
    chains: Array.from(state.intervals.keys()),
    lastRun: Object.fromEntries(state.lastRun),
    stats: { ...state.stats },
  };
}

/**
 * Reset indexer stats (for testing).
 */
export function resetIndexerStats(): void {
  state.stats.balancesUpdated = 0;
  state.stats.transactionsFound = 0;
  state.stats.errors = 0;
  state.lastRun.clear();
}

/**
 * Run a single indexing cycle for a specific chain (for testing/manual trigger).
 */
export async function runOnce(chain: WalletChain): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase credentials');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  await indexChain(supabase, chain);
}
