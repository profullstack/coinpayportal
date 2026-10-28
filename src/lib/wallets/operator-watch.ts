import { getSupabaseAdmin } from '../supabase/server';
import { operatorAlert, operatorKeysLocked, refreshOperatorState } from './operator-keys';
import { refillAddressPool } from './address-pool';
import { deriveSystemPaymentAddress } from './system-wallet';

const WATCH_KEY = Symbol.for('coinpay.operator-watch.timer');

/** One watch tick: alert while locked, refill the address pool while unlocked. */
export async function operatorWatchTick(): Promise<'unsealed' | 'locked' | 'unlocked'> {
  const { sealed, unlocked } = await refreshOperatorState(true);
  if (!sealed) return 'unsealed';
  if (!unlocked || operatorKeysLocked()) {
    operatorAlert('operator keys locked: forwarding paused, unlock to resume (/admin/operator-vault)');
    return 'locked';
  }
  await refillAddressPool(getSupabaseAdmin(), (c, i) => deriveSystemPaymentAddress(c, i));
  return 'unlocked';
}

export function startOperatorKeysWatch(intervalMs = 10 * 60_000): void {
  const g = globalThis as unknown as Record<symbol, NodeJS.Timeout | undefined>;
  if (g[WATCH_KEY]) return;
  const tick = () =>
    operatorWatchTick().catch((err) => console.error('[operator-keys] watch tick failed', err instanceof Error ? err.message : err));
  g[WATCH_KEY] = setInterval(tick, intervalMs);
  g[WATCH_KEY]!.unref?.();
  void tick();
}
