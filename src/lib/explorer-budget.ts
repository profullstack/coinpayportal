import { mkdirSync, readFileSync, renameSync, writeFileSync, rmdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';

const DAY_MS = 86_400_000;
interface DailyBudget { day: number; used: number }

/**
 * A cost ceiling shared by all callers, including callers rotating IPs or
 * inventing credentials. Production has one Node process and one volume.
 * Persist before allowing a read so restarts do not replenish the allowance.
 * Replicas on separate volumes require an atomic shared database counter instead.
 */
export function createExplorerBudget(options: {
  dailyLimit: number;
  minuteLimit?: number;
  file?: string;
  now?: () => number;
}) {
  let daily: DailyBudget | undefined;
  let minuteStart = 0;
  let minuteUsed = 0;
  return function reserve(): 'allowed' | 'daily' | 'burst' | 'unavailable' {
    const now = (options.now ?? Date.now)();
    const day = Math.floor(now / DAY_MS);
    let locked = false;
    const lock = options.file ? `${options.file}.lock` : undefined;
    try {
      if (options.file && lock) {
        mkdirSync(dirname(options.file), { recursive: true });
        try {
          mkdirSync(lock);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || now - statSync(lock).mtimeMs < 60_000) throw error;
          // Recover a lock left behind by a terminated process.
          rmdirSync(lock);
          mkdirSync(lock);
        }
        locked = true;
      }
      if (options.file) {
        try {
          const saved = JSON.parse(readFileSync(options.file, 'utf8'));
          if (!Number.isSafeInteger(saved.day) || !Number.isSafeInteger(saved.used) || saved.used < 0) {
            throw new Error('Invalid explorer budget');
          }
          daily = saved;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          daily = undefined;
        }
      }
      if (!daily || daily.day !== day) daily = { day, used: 0 };
      if (daily.used >= options.dailyLimit) return 'daily';
      if (now - minuteStart >= 60_000) {
        minuteStart = now;
        minuteUsed = 0;
      }
      if (minuteUsed >= (options.minuteLimit ?? 60)) return 'burst';
      const next = { day, used: daily.used + 1 };
      if (options.file) {
        mkdirSync(dirname(options.file), { recursive: true });
        const pending = `${options.file}.tmp`;
        writeFileSync(pending, JSON.stringify(next), { mode: 0o600 });
        renameSync(pending, options.file);
      }
      daily = next;
      minuteUsed++;
      return 'allowed';
    } catch {
      // A broken store must not silently restore unlimited free RPC access.
      return 'unavailable';
    } finally {
      if (locked && lock) {
        try { rmdirSync(lock); } catch { /* A stale lock fails closed until recovery. */ }
      }
    }
  };
}

function configuredLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

export const reserveExplorerRead = createExplorerBudget({
  dailyLimit: configuredLimit('EXPLORER_SHARED_FREE_PER_DAY', 2_000),
  minuteLimit: configuredLimit('EXPLORER_SHARED_FREE_PER_MINUTE', 60),
  file: process.env.NODE_ENV === 'production'
    ? `${process.env.RAILWAY_VOLUME_MOUNT_PATH || '/mnt/files'}/explorer/free-budget.json`
    : undefined,
});

const accountBudgets = new Map<string, { day: number; reserve: ReturnType<typeof createExplorerBudget> }>();
export function reserveExplorerAccountRead(account: string) {
  const key = createHash('sha256').update(account).digest('hex');
  const day = Math.floor(Date.now() / DAY_MS);
  let entry = accountBudgets.get(key);
  if (!entry || entry.day !== day) {
    if (accountBudgets.size >= 10_000) {
      for (const [id, value] of accountBudgets) if (value.day !== day) accountBudgets.delete(id);
      if (accountBudgets.size >= 10_000 && !entry) return 'unavailable' as const;
    }
    entry = { day, reserve: createExplorerBudget({
      dailyLimit: 2_000,
      minuteLimit: 30,
      file: process.env.NODE_ENV === 'production'
        ? `${process.env.RAILWAY_VOLUME_MOUNT_PATH || '/mnt/files'}/explorer/accounts/${key}.json`
        : undefined,
    }) };
    accountBudgets.set(key, entry);
  }
  return entry.reserve();
}
