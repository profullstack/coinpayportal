import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clientIp } from '@profullstack/x402-gateway';

// Deliberately excludes IP, URL, cookies, authorization and request IDs. Only
// ordinary browser capability headers: no canvas or cross-site tracking.
const HEADERS = ['user-agent', 'accept', 'accept-language', 'accept-encoding',
  'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
  'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'upgrade-insecure-requests'];
export function explorerFingerprint(request: Request): string {
  return createHash('sha256').update(JSON.stringify(HEADERS.map(h => request.headers.get(h) ?? ''))).digest('hex');
}

interface Ban { strikes: number; bannedUntil: number }
interface Activity extends Ban { start: number; count: number; ips: Set<string> }
interface Decision { fingerprint: string; blocked: boolean; retryAfterSeconds?: number }

/** 1, 2, 3, 5 ... minutes, saturated at one day. */
export function accountBanMinutes(strike: number): number {
  let previous = 1, current = 1;
  for (let i = 1; i < Math.min(strike, 16); i++) [previous, current] = [current, previous + current];
  return Math.min(current, 1440);
}

export function createExplorerAbuseGuard(now = Date.now, directory?: string) {
  const activity = new Map<string, Activity>();
  return (request: Request, account: string | null): Decision => {
    const fingerprint = explorerFingerprint(request);
    const listed = (name: string, key: string) => (process.env[name] ?? '').split(',').map(s => s.trim()).includes(key);
    if (listed('EXPLORER_BANNED_FINGERPRINTS', fingerprint) ||
        (account && listed('EXPLORER_BANNED_ACCOUNTS', account))) return { fingerprint, blocked: true };
    const key = account ? `account:${account}` : fingerprint;
    const time = now();
    const windowMs = account ? 60_000 : 300_000;
    const blocked = (until: number): Decision => ({ fingerprint, blocked: true, retryAfterSeconds: Math.max(1, Math.ceil((until - time) / 1000)) });
    // Account history survives sessions and deployments. A filesystem lock also
    // serializes overlapping deployments on the production volume.
    const file = account && directory ? join(directory, `${createHash('sha256').update(account).digest('hex')}.json`) : undefined;
    const lock = file ? `${file}.lock` : undefined;
    let locked = false;
    try {
      let history: Ban | undefined;
      if (file && lock) {
        mkdirSync(directory!, { recursive: true });
        try { mkdirSync(lock); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || time - statSync(lock).mtimeMs < 60_000) throw error;
          rmdirSync(lock);
          mkdirSync(lock);
        }
        locked = true;
        try {
          history = JSON.parse(readFileSync(file, 'utf8'));
          if (!history || !Number.isSafeInteger(history.strikes) || history.strikes < 0 ||
              !Number.isSafeInteger(history.bannedUntil) || history.bannedUntil < 0) throw new Error('Invalid account ban state');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      let entry = activity.get(key);
      if (history && history.bannedUntil > time) return blocked(history.bannedUntil);
      if (entry && entry.bannedUntil > time) return blocked(entry.bannedUntil);
      if (!entry || time - entry.start >= windowMs) {
        if (activity.size >= 10_000) {
          for (const [k, v] of activity) if (v.bannedUntil <= time && time - v.start >= 86_400_000) activity.delete(k);
          if (activity.size >= 10_000 && !activity.has(key)) return blocked(time + 60_000);
        }
        entry = { start: time, count: 0, ips: new Set(), bannedUntil: 0, strikes: history?.strikes ?? entry?.strikes ?? 0 };
        activity.set(key, entry);
      }
      entry.count++;
      const ip = clientIp(request);
      if (ip && entry.ips.size < 100) entry.ips.add(ip);
      // A shared browser string alone never triggers a ban: anonymous cohorts
      // must also exhibit sustained activity across a fleet of source IPs.
      const abusive = account ? entry.count > 120 : entry.count >= 60 && entry.ips.size >= 20;
      if (abusive) {
        entry.strikes = Math.min(Math.max(entry.strikes, history?.strikes ?? 0) + 1, 16);
        const minutes = account ? accountBanMinutes(entry.strikes) : 60;
        entry.bannedUntil = time + minutes * 60_000;
        if (file) {
          writeFileSync(`${file}.tmp`, JSON.stringify({ strikes: entry.strikes, bannedUntil: entry.bannedUntil }), { mode: 0o600 });
          renameSync(`${file}.tmp`, file);
        }
        console.warn(`[explorer-abuse] banned ${account ? 'account' : 'fingerprint'} fingerprint=${fingerprint} requests=${entry.count} addresses=${entry.ips.size} seconds=${minutes * 60} strike=${entry.strikes} profile=${JSON.stringify(Object.fromEntries(HEADERS.map(h => [h, (request.headers.get(h) ?? '').slice(0,256)])))}`);
        return blocked(entry.bannedUntil);
      }
      return { fingerprint, blocked: false };
    } catch {
      // A corrupt or unavailable ban store does not grant a clean history.
      return blocked(time + 60_000);
    } finally {
      if (locked && lock) {
        try { rmdirSync(lock); } catch { /* Stale locks recover after one minute. */ }
      }
    }
  };
}
export const checkExplorerAbuse = createExplorerAbuseGuard(Date.now,
  process.env.NODE_ENV === 'production'
    ? `${process.env.RAILWAY_VOLUME_MOUNT_PATH || '/mnt/files'}/explorer/bans`
    : undefined);
