import 'server-only';
import { getSupabaseAdmin } from '../supabase/server';
import { loadEngine } from './cloud-browser';

/**
 * The server's attempt ledger for sites that lock accounts (the tax sources).
 *
 * Same rules as the CLI's ~/.coinpay/statements/throttle.json, from the same
 * code (the engine's evaluateThrottle): at most 2 visits per 30 minutes and 4
 * per day per merchant and source, nothing during a recorded lockout, every
 * visit counted before it is made. Rows live in finance_site_attempts.
 */

export type AttemptKind = 'connect' | 'fetch';

export interface ThrottleVerdict {
  ok: boolean;
  reason?: 'locked' | 'daily_limit' | 'window_limit';
  retryAt?: string;
  message?: string;
}

interface AttemptRow {
  kind: 'connect' | 'fetch' | 'lockout';
  locked_until: string | null;
  note: string | null;
  created_at: string;
}

/** Fold ledger rows into the engine's input: visits, and the latest lockout end. */
export function ledgerFromRows(rows: readonly AttemptRow[]): { attempts: string[]; lockedUntil: string | null; lockReason: string | null } {
  const attempts = rows.filter((r) => r.kind !== 'lockout').map((r) => r.created_at);
  let lockedUntil: string | null = null;
  let lockReason: string | null = null;
  for (const r of rows) {
    if (r.kind === 'lockout' && r.locked_until && (!lockedUntil || Date.parse(r.locked_until) > Date.parse(lockedUntil))) {
      lockedUntil = r.locked_until;
      lockReason = r.note;
    }
  }
  return { attempts, lockedUntil, lockReason };
}

async function readLedger(merchantId: string, institutionKey: string, now: Date): Promise<AttemptRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('finance_site_attempts')
    .select('kind, locked_until, note, created_at')
    .eq('merchant_id', merchantId)
    .eq('institution_key', institutionKey)
    // A day of visits matters for the caps; a week covers any lockout a site names.
    .gte('created_at', new Date(now.getTime() - 7 * 24 * 3_600_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(`Could not read the attempt ledger: ${error.message}`);
  return (data ?? []) as AttemptRow[];
}

export async function checkSiteThrottle(merchantId: string, institutionKey: string, now: Date = new Date()): Promise<ThrottleVerdict> {
  const sf = await loadEngine();
  return sf.evaluateThrottle(ledgerFromRows(await readLedger(merchantId, institutionKey, now)), now) as ThrottleVerdict;
}

/**
 * Check and, when allowed, record the visit before it is made. Two requests
 * racing could both pass the check; the cap is a courtesy to the site, and a
 * one-attempt overshoot between two clicks of the same merchant is acceptable.
 */
export async function takeSiteAttempt(merchantId: string, institutionKey: string, kind: AttemptKind, now: Date = new Date()): Promise<ThrottleVerdict> {
  const verdict = await checkSiteThrottle(merchantId, institutionKey, now);
  if (!verdict.ok) return verdict;
  const { error } = await getSupabaseAdmin()
    .from('finance_site_attempts')
    .insert({ merchant_id: merchantId, institution_key: institutionKey, kind, created_at: now.toISOString() });
  if (error) throw new Error(`Could not record the attempt: ${error.message}`);
  return verdict;
}

export async function recordSiteLockout(merchantId: string, institutionKey: string, lockedUntil: string, note: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('finance_site_attempts')
    .insert({ merchant_id: merchantId, institution_key: institutionKey, kind: 'lockout', locked_until: lockedUntil, note: note.slice(0, 200) });
  if (error) throw new Error(`Could not record the lockout: ${error.message}`);
}

/**
 * A page-text watcher for a live cloud sign-in: records the first lockout
 * page it sees (once), so the next connect or fetch is refused until it ends.
 */
export async function lockoutWatcher(merchantId: string, institutionKey: string, lockoutMinutes?: number): Promise<(text: string) => void> {
  const sf = await loadEngine();
  let recorded = false;
  return (text: string) => {
    if (recorded) return;
    const found = sf.detectLockout(text);
    if (!found) return;
    recorded = true;
    const until = sf.lockoutUntil(found, new Date(), undefined, lockoutMinutes);
    void recordSiteLockout(merchantId, institutionKey, until, 'lockout page during cloud sign-in').catch(() => undefined);
  };
}
