/**
 * Per-origin site permissions.
 *
 * A page can only see addresses or request payments after the user has
 * explicitly connected that ORIGIN (scheme + host + port — never a bare
 * hostname, so `http://` and a look-alike port can't inherit a grant made to
 * `https://ugig.net`).
 *
 * Connecting is not an allowance: it grants read access to public addresses and
 * the right to *ask*. Every payment still needs its own approval, so a
 * compromised connected page cannot move funds on its own.
 */

import type { KeyValueStore } from './storage.js';

const CONNECTIONS_KEY = 'connections';

export interface SiteConnection {
  origin: string;
  connectedAt: number;
  /** Bumped whenever the site makes an authorized request; shown in the UI. */
  lastUsedAt: number;
}

/** Normalize to scheme://host[:port], or null if not a usable web origin. */
export function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export class ConnectionStore {
  constructor(private store: KeyValueStore) {}

  async #all(): Promise<Record<string, SiteConnection>> {
    return (await this.store.get<Record<string, SiteConnection>>(CONNECTIONS_KEY)) ?? {};
  }

  async list(): Promise<SiteConnection[]> {
    const all = await this.#all();
    return Object.values(all).sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }

  async isConnected(origin: string | null): Promise<boolean> {
    if (!origin) return false;
    const all = await this.#all();
    return Boolean(all[origin]);
  }

  async connect(origin: string): Promise<SiteConnection> {
    const all = await this.#all();
    const now = Date.now();
    const connection: SiteConnection = all[origin]
      ? { ...all[origin]!, lastUsedAt: now }
      : { origin, connectedAt: now, lastUsedAt: now };
    all[origin] = connection;
    await this.store.set(CONNECTIONS_KEY, all);
    return connection;
  }

  async touch(origin: string): Promise<void> {
    const all = await this.#all();
    const existing = all[origin];
    if (!existing) return;
    all[origin] = { ...existing, lastUsedAt: Date.now() };
    await this.store.set(CONNECTIONS_KEY, all);
  }

  async disconnect(origin: string): Promise<void> {
    const all = await this.#all();
    delete all[origin];
    await this.store.set(CONNECTIONS_KEY, all);
  }
}
