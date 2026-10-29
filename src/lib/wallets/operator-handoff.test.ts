import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Deploy handoff: export gives the current unlock (key + original expiry),
 * import unlocks with the time that is LEFT, never more, and a nearly expired
 * or missing unlock is refused.
 */
const keys = vi.hoisted(() => ({
  current: null as { dataKey: string; expiresAt: string } | null,
  unlockOperatorKeys: vi.fn(async (_k: string, ttl: number) => ({ expiresAt: new Date(Date.now() + ttl).toISOString(), names: [] })),
}));
vi.mock('./operator-keys', () => ({
  operatorHandoffExport: () => keys.current,
  unlockOperatorKeys: keys.unlockOperatorKeys,
}));
vi.mock('./address-pool', () => ({ refillAddressPool: vi.fn(async () => ({})) }));
vi.mock('./system-wallet', () => ({ deriveSystemPaymentAddress: vi.fn() }));
vi.mock('../supabase/server', () => ({ getSupabaseAdmin: () => ({}) }));

import { handleHandoffRequest, startOperatorHandoffSocket } from './operator-handoff';

afterEach(() => {
  keys.current = null;
  keys.unlockOperatorKeys.mockClear();
});

describe('operator handoff', () => {
  it('export answers locked while locked', async () => {
    expect(await handleHandoffRequest('{"op":"export"}')).toEqual({ ok: false, error: 'locked' });
  });

  it('export returns the data key and the original expiry', async () => {
    keys.current = { dataKey: 'a2V5', expiresAt: '2026-11-05T03:43:03.288Z' };
    expect(await handleHandoffRequest('{"op":"export"}')).toEqual({ ok: true, data_key: 'a2V5', expires_at: '2026-11-05T03:43:03.288Z' });
  });

  it('import unlocks for the remaining time only', async () => {
    const now = Date.parse('2026-10-29T04:00:00Z');
    const r = await handleHandoffRequest('{"op":"import","data_key":"a2V5","expires_at":"2026-10-29T10:00:00Z"}', now);
    expect(r.ok).toBe(true);
    expect(keys.unlockOperatorKeys).toHaveBeenCalledWith('a2V5', 6 * 3600_000);
  });

  it('import refuses an unlock that is about to expire', async () => {
    const now = Date.parse('2026-10-29T04:00:00Z');
    expect(await handleHandoffRequest('{"op":"import","data_key":"a2V5","expires_at":"2026-10-29T04:00:30Z"}', now)).toEqual({
      ok: false,
      error: 'unlock expires in under a minute',
    });
    expect(keys.unlockOperatorKeys).not.toHaveBeenCalled();
  });

  it('import reports a wrong key without unlocking', async () => {
    keys.unlockOperatorKeys.mockRejectedValueOnce(new Error('Wrong key'));
    const r = await handleHandoffRequest(`{"op":"import","data_key":"x","expires_at":"${new Date(Date.now() + 3600_000).toISOString()}"}`);
    expect(r).toEqual({ ok: false, error: 'Wrong key' });
  });

  it('rejects junk', async () => {
    expect(await handleHandoffRequest('nope')).toEqual({ ok: false, error: 'bad json' });
    expect(await handleHandoffRequest('{"op":"dump"}')).toEqual({ ok: false, error: 'unknown op' });
  });

  it('serves the protocol on a Unix socket', async () => {
    keys.current = { dataKey: 'a2V5', expiresAt: '2026-11-05T03:43:03.288Z' };
    const path = join(mkdtempSync(join(tmpdir(), 'cp-handoff-')), 's.sock');
    const server = startOperatorHandoffSocket(path)!;
    await new Promise((r) => (server.listening ? r(null) : server.once('listening', r)));
    const reply = await new Promise<string>((resolve, reject) => {
      let out = '';
      const c = connect(path, () => c.write('{"op":"export"}\n'));
      c.setEncoding('utf8');
      c.on('data', (d) => (out += d));
      c.on('end', () => resolve(out));
      c.on('error', reject);
    });
    server.close();
    expect(JSON.parse(reply)).toEqual({ ok: true, data_key: 'a2V5', expires_at: '2026-11-05T03:43:03.288Z' });
  });
});
