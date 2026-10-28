import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Bank credentials are sealed to the merchant's secrets vault: a locked
 * merchant's scheduled sync is not queued (it could only fail); the
 * connection shows "locked" and the slot moves on. No error loop.
 */
vi.mock('server-only', () => ({}));
const db = vi.hoisted(() => ({ tables: {} as Record<string, any[]>, updates: [] as Array<{ table: string; patch: any }> }));
vi.mock('../supabase/server', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const filters: Array<(r: any) => boolean> = [];
      let patch: any = null;
      const run = () => {
        const hit = (db.tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        if (patch) {
          hit.forEach((r) => Object.assign(r, patch));
          db.updates.push({ table, patch });
        }
        return hit;
      };
      const q: any = {
        select: () => q,
        update: (p: any) => ((patch = p), q),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        in: () => q,
        not: () => q,
        lte: () => q,
        limit: () => q,
        then: (res: any, rej: any) => Promise.resolve({ data: run(), error: null, count: 0 }).then(res, rej),
      };
      return q;
    },
  }),
}));

const jobs = await import('./jobs');
const createRefreshJob = vi.spyOn(jobs, 'createRefreshJob');
const { putUnlock, resetUnlockStore } = await import('../vault/unlock-store');

beforeEach(() => {
  resetUnlockStore();
  db.updates = [];
  db.tables = {
    finance_connections: [{ id: 'c1', merchant_id: 'm1', lifecycle_state: 'active', is_active: true, next_sync_at: '2026-10-28T00:00:00Z' }],
    finance_jobs: [],
  };
  createRefreshJob.mockReset();
});

describe('scheduled syncs while the vault is locked', () => {
  it('queue nothing, mark the connection locked, and push the slot on', async () => {
    const created = await jobs.enqueueScheduledSyncs(new Date('2026-10-28T01:00:00Z'));
    expect(created).toBe(0);
    const conn = db.tables.finance_connections[0];
    expect(conn.last_sync_status).toBe('locked');
    expect(conn.last_sync_error).toMatch(/unlock your secrets vault/);
    expect(Date.parse(conn.next_sync_at)).toBeGreaterThan(Date.parse('2026-10-28T01:00:00Z'));
    expect(db.tables.finance_jobs).toHaveLength(0);
  });

  it('run again once the merchant unlocks', async () => {
    putUnlock('merchant', 'm1', {} as CryptoKey, 3600_000);
    const statuses = () => db.updates.filter((u) => u.patch.last_sync_status === 'locked');
    await jobs.enqueueScheduledSyncs(new Date('2026-10-28T01:00:00Z')).catch(() => undefined);
    expect(statuses()).toHaveLength(0);
  });
});
