import 'server-only';
import { lookup } from 'dns/promises';
import { isIP } from 'net';

/**
 * Keep the cloud bank browser on the public internet.
 *
 * CoinPay runs a real Chrome for merchants and lets them drive it (to sign in
 * to their bank), so without a fence it would be a proxy into dev2's private
 * network: the Supabase containers, Redis, the Docker host, cloud metadata
 * addresses. Every request from every target (tabs, popups, frames, workers)
 * is paused through the DevTools Fetch domain and allowed only when
 *
 *   - the scheme is https (or data:, blob:, about:, which never leave Chrome);
 *   - the host has a dot and is not localhost, *.local, *.internal or
 *     *.localhost (Compose service names are dotless);
 *   - every address the host resolves to is public: no loopback, private,
 *     link-local, CGNAT, multicast, reserved or IPv6 unique-local space.
 *
 * Chrome resolves the name again itself, so a DNS-rebinding host could still
 * flip between our check and its connect; that window is the residual risk.
 */

const LOCAL_SCHEMES = new Set(['data:', 'blob:', 'about:']);

function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
}

/** True for any address a public bank site would never resolve to. */
export function isBlockedAddress(address: string): boolean {
  let ip = address.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (ip.startsWith('::ffff:')) ip = ip.slice(7); // IPv4-mapped IPv6
  const v4 = ipv4Parts(ip);
  if (v4) {
    const [a, b] = v4 as [number, number, number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast and reserved
    );
  }
  if (isIP(ip) === 6) {
    return (
      ip === '::' ||
      ip === '::1' ||
      ip.startsWith('fc') ||
      ip.startsWith('fd') || // unique local
      /^fe[89ab]/.test(ip) || // link-local
      ip.startsWith('ff') || // multicast
      ip.startsWith('64:ff9b:') // NAT64 can reach IPv4 private space
    );
  }
  return true; // not an address we understand
}

/** A host name that can only mean something inside our network. */
export function isInternalHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return !h.includes('.') || h === 'localhost' || /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(h);
}

export type Resolver = (host: string) => Promise<string[]>;

const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);

const cache = new Map<string, { ok: boolean; at: number }>();
const CACHE_MS = 60_000;

/**
 * Whether the cloud browser may fetch `rawUrl`. Returns the reason when it
 * may not. Results are cached per host for a minute, so a page with 200
 * subresources costs one lookup.
 */
export async function checkUrl(rawUrl: string, resolve: Resolver = defaultResolver): Promise<{ ok: true } | { ok: false; reason: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'not a URL' };
  }
  if (LOCAL_SCHEMES.has(url.protocol)) return { ok: true };
  if (url.protocol !== 'https:' && url.protocol !== 'wss:') return { ok: false, reason: `${url.protocol} is not allowed` };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return isBlockedAddress(host) ? { ok: false, reason: 'private address' } : { ok: true };
  if (isInternalHostname(host)) return { ok: false, reason: 'internal host name' };

  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ok ? { ok: true } : { ok: false, reason: 'resolves to a private address' };
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return { ok: false, reason: 'host does not resolve' };
  }
  const ok = addresses.length > 0 && addresses.every((address) => !isBlockedAddress(address));
  cache.set(host, { ok, at: Date.now() });
  return ok ? { ok: true } : { ok: false, reason: 'resolves to a private address' };
}

/** Test hook. */
export function clearGuardCache(): void {
  cache.clear();
}

type CdpLike = {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<Record<string, unknown>>;
  on(listener: (event: { method: string; params: Record<string, unknown>; sessionId?: string }) => void): () => void;
};

/**
 * Fence every target of a browser. Call before the first navigation: it
 * auto-attaches to each new target (paused until fenced), enables Fetch
 * interception there, and answers each paused request.
 * `onTarget` hears every attached session, so callers can follow popups.
 */
export async function installRequestGuard(
  cdp: CdpLike,
  { resolve = defaultResolver, onBlocked = () => {}, onTarget = () => {}, check = (url: string) => checkUrl(url, resolve) }: {
    resolve?: Resolver;
    /** Test seam: replaces the URL check. */
    check?: (url: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
    onBlocked?: (url: string, reason: string) => void;
    onTarget?: (info: { sessionId: string; targetId: string; type: string; url: string }) => void;
  } = {},
): Promise<() => void> {
  const autoAttach = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true };
  const fence = async (sessionId: string) => {
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, sessionId).catch(() => undefined);
    await cdp.send('Target.setAutoAttach', autoAttach, sessionId).catch(() => undefined);
    await cdp.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => undefined);
  };

  const stop = cdp.on(({ method, params, sessionId }) => {
    if (method === 'Target.attachedToTarget') {
      const info = params.targetInfo as { targetId: string; type: string; url?: string };
      const child = String(params.sessionId);
      void fence(child).then(() => onTarget({ sessionId: child, targetId: info.targetId, type: info.type, url: info.url ?? '' }));
      return;
    }
    if (method === 'Fetch.requestPaused' && sessionId) {
      const requestId = String(params.requestId);
      const url = String((params.request as { url?: string } | undefined)?.url ?? '');
      void check(url).then((verdict) => {
        if (verdict.ok) return cdp.send('Fetch.continueRequest', { requestId }, sessionId);
        onBlocked(url, verdict.reason);
        return cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }, sessionId);
      }).catch(() => undefined);
    }
  });

  await cdp.send('Target.setAutoAttach', autoAttach);
  // Targets that already exist (the first tab) were not auto-attached.
  const { targetInfos } = (await cdp.send('Target.getTargets')) as { targetInfos: { targetId: string; type: string; url?: string; attached: boolean }[] };
  for (const target of targetInfos) {
    if (target.type !== 'page') continue;
    const { sessionId } = (await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })) as { sessionId: string };
    await fence(sessionId);
    onTarget({ sessionId, targetId: target.targetId, type: target.type, url: target.url ?? '' });
  }
  return stop;
}
