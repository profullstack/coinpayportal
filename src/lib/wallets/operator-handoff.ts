/**
 * Deploy handoff for the operator unlock.
 *
 * The operator unlock lives in process memory only, so every redeploy used to
 * lock the vault and pause forwarding until Anthony unlocked again (six times
 * on 2026-10-28). Now the outgoing process hands its unlock to the incoming
 * one: deploy-app.sh asks the old container for it before `compose up`, and
 * gives it to the new container once it is healthy
 * (scripts/operator-vault-handoff.sh).
 *
 * The channel is a Unix socket inside the container, in a 0700 directory of
 * its own (socket 0600, root), so only
 * `docker exec` reaches it: nothing on HTTP, nothing on disk, nothing in env.
 * Whoever can docker exec can already read this process's memory, so the
 * socket adds no new way in. The imported unlock keeps the ORIGINAL expiry:
 * a deploy never extends it, and an unlock with under a minute left is refused.
 *
 * Protocol: one JSON line in, one JSON line out.
 *   {"op":"export"}                              -> {"ok":true,"data_key":"...","expires_at":"..."} | {"ok":false,"error":"locked"}
 *   {"op":"import","data_key":"...","expires_at":"..."} -> {"ok":true,"expires_at":"..."} | {"ok":false,"error":"..."}
 */
import { chmodSync, lstatSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { createServer, type Server } from 'node:net';
import { getSupabaseAdmin } from '../supabase/server';
import { operatorHandoffExport, unlockOperatorKeys } from './operator-keys';
import { refillAddressPool } from './address-pool';
import { deriveSystemPaymentAddress } from './system-wallet';

export const DEFAULT_HANDOFF_SOCKET = '/run/coinpay-operator/handoff.sock';
const MIN_REMAINING_MS = 60_000;
const MAX_LINE = 4096;
const SERVER_KEY = Symbol.for('coinpay.operator-handoff.server');

type HandoffReply = { ok: true; data_key?: string; expires_at: string } | { ok: false; error: string };

export async function handleHandoffRequest(line: string, now: number = Date.now()): Promise<HandoffReply> {
  let req: { op?: string; data_key?: string; expires_at?: string };
  try {
    req = JSON.parse(line);
  } catch {
    return { ok: false, error: 'bad json' };
  }
  if (req.op === 'export') {
    const h = operatorHandoffExport();
    if (!h) return { ok: false, error: 'locked' };
    return { ok: true, data_key: h.dataKey, expires_at: h.expiresAt };
  }
  if (req.op === 'import') {
    const until = Date.parse(String(req.expires_at ?? ''));
    if (!Number.isFinite(until)) return { ok: false, error: 'expires_at missing' };
    if (until - now < MIN_REMAINING_MS) return { ok: false, error: 'unlock expires in under a minute' };
    try {
      const { expiresAt } = await unlockOperatorKeys(String(req.data_key ?? ''), until - now);
      console.log(`[operator-vault] unlock handed over from the previous process, until ${expiresAt}`);
      void refillAddressPool(getSupabaseAdmin(), (c, i) => deriveSystemPaymentAddress(c, i)).catch((err) =>
        console.error('[operator-vault] pool refill failed', err instanceof Error ? err.message : err),
      );
      return { ok: true, expires_at: expiresAt };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'import failed' };
    }
  }
  return { ok: false, error: 'unknown op' };
}

/** Listen on the handoff socket (once per process). OPERATOR_HANDOFF=off disables it. */
export function startOperatorHandoffSocket(path: string = process.env.OPERATOR_HANDOFF_SOCKET || DEFAULT_HANDOFF_SOCKET): Server | null {
  if (process.env.OPERATOR_HANDOFF === 'off') return null;
  const g = globalThis as unknown as Record<symbol, Server | undefined>;
  if (g[SERVER_KEY]) return g[SERVER_KEY]!;
  // A private directory, never a shared one like /tmp: refuse a symlink or a
  // directory someone else owns or can write to.
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = lstatSync(dir);
  const uid = process.getuid?.();
  if (!st.isDirectory() || st.isSymbolicLink() || (uid !== undefined && st.uid !== uid) || (st.mode & 0o077) !== 0) {
    console.error(`[operator-vault] handoff socket NOT started: ${dir} is not a private directory`);
    return null;
  }
  try {
    unlinkSync(path);
  } catch {
    /* no stale socket */
  }
  const server = createServer((conn) => {
    let buf = '';
    conn.setEncoding('utf8');
    conn.setTimeout(10_000, () => conn.destroy());
    conn.on('data', (chunk: string) => {
      buf += chunk;
      if (buf.length > MAX_LINE) return conn.destroy();
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      const line = buf.slice(0, nl);
      buf = '';
      void handleHandoffRequest(line).then((reply) => conn.end(`${JSON.stringify(reply)}\n`));
    });
    conn.on('error', () => conn.destroy());
  });
  server.on('error', (err) => console.error('[operator-vault] handoff socket error', err.message));
  server.listen(path, () => {
    try {
      chmodSync(path, 0o600);
    } catch {
      /* best effort; /tmp in the container is root's anyway */
    }
  });
  server.unref();
  g[SERVER_KEY] = server;
  return server;
}
