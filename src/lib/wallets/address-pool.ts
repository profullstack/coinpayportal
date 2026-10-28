/**
 * Pre-derived deposit addresses for while the operator keys are locked.
 *
 * Minting a deposit address needs the SYSTEM_MNEMONIC_* (ed25519 chains like
 * SOL and ADA cannot derive from a public key at all), and those are only in
 * memory while an operator has unlocked. So while unlocked we derive ahead:
 * each pool row is a reserved family index, its address, and its private key
 * already sealed to the operator public key. While locked, checkout claims a
 * row instead of deriving, and forwarding of that payment waits for the next
 * unlock like every other.
 *
 * An empty pool refuses that coin only, with an alert line.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { acquireFamilyIndex, type SystemBlockchain } from './derivation-family';
import { getSystemKeyGeneration } from './key-generation';
import { isOperatorUnlocked, operatorAlert, sealPaymentAddressKey } from './operator-keys';

export interface PoolAddress {
  id: string;
  cryptocurrency: SystemBlockchain;
  derivation_index: number;
  address: string;
  derivation_path: string;
  key_generation: number;
  sealed_private_key: string;
}

/** Coins the pool keeps ready (the ones CoinPay mints deposit addresses for). */
export const POOL_CRYPTOS: SystemBlockchain[] = [
  'BTC', 'BCH', 'ETH', 'POL', 'SOL', 'DOGE', 'XRP', 'ADA', 'BNB',
  'USDT', 'USDT_ETH', 'USDT_POL', 'USDT_SOL', 'USDT_TRON',
  'USDC', 'USDC_ETH', 'USDC_POL', 'USDC_SOL', 'USDC_BASE',
];

export function poolTarget(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.OPERATOR_ADDRESS_POOL_TARGET ?? '');
  return Number.isInteger(n) && n >= 0 && n <= 5000 ? n : 100;
}

/** Claim one unclaimed address for a coin, or null when the pool is empty. */
export async function claimPoolAddress(supabase: SupabaseClient, cryptocurrency: SystemBlockchain): Promise<PoolAddress | null> {
  const { data, error } = await supabase.rpc('claim_operator_pool_address', { p_cryptocurrency: cryptocurrency });
  if (error) throw new Error(`Could not claim a pooled address: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as PoolAddress | null | undefined;
  if (!row) {
    operatorAlert(`${cryptocurrency} deposit address pool is empty while operator keys are locked; ${cryptocurrency} checkout refused until unlock`, true);
    return null;
  }
  return row;
}

const REFILL_KEY = Symbol.for('coinpay.address-pool.refilling');

/**
 * Top every coin up to the target. Only while unlocked; coins whose mnemonic
 * is not configured are skipped. Returns how many addresses were added.
 */
export async function refillAddressPool(
  supabase: SupabaseClient,
  derive: (c: SystemBlockchain, index: number) => Promise<{ address: string; privateKey: string; derivationPath: string }>,
  { target = poolTarget(), cryptos = POOL_CRYPTOS }: { target?: number; cryptos?: SystemBlockchain[] } = {},
): Promise<Record<string, number>> {
  const g = globalThis as unknown as Record<symbol, boolean | undefined>;
  const added: Record<string, number> = {};
  if (g[REFILL_KEY] || !isOperatorUnlocked() || target === 0) return added;
  g[REFILL_KEY] = true;
  try {
    for (const c of cryptos) {
      const { count, error } = await supabase
        .from('operator_address_pool')
        .select('id', { count: 'exact', head: true })
        .eq('cryptocurrency', c)
        .is('claimed_at', null);
      if (error) throw new Error(error.message);
      const missing = target - (count ?? 0);
      for (let i = 0; i < missing; i++) {
        if (!isOperatorUnlocked()) return added;
        let derived: { address: string; privateKey: string; derivationPath: string };
        const index = await acquireFamilyIndex(supabase, c);
        try {
          derived = await derive(c, index);
        } catch {
          break; // not configured for this coin
        }
        const sealed = await sealPaymentAddressKey(derived.address, derived.privateKey);
        const { error: insErr } = await supabase.from('operator_address_pool').insert({
          cryptocurrency: c,
          derivation_index: index,
          address: derived.address,
          derivation_path: derived.derivationPath,
          key_generation: getSystemKeyGeneration(),
          sealed_private_key: sealed,
        });
        if (insErr) continue; // duplicate address (shared family index); the next index is fresh
        added[c] = (added[c] ?? 0) + 1;
      }
    }
    return added;
  } finally {
    g[REFILL_KEY] = false;
  }
}
