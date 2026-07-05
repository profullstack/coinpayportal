/**
 * Storage abstraction over `browser.storage` (PRD P0-3).
 *
 * `local`   → persistent, survives browser restart (holds the ENCRYPTED vault
 *             + public metadata; never plaintext key material).
 * `session` → cleared on browser close, in-memory (holds the unlocked seed
 *             while the wallet is unlocked, so a service-worker restart within
 *             a session does not force re-login).
 *
 * The real `browser.storage.*` areas are injected in the extension context via
 * `WebExtStorage`. `MemoryStorage` is a drop-in used by unit tests and any
 * non-extension context.
 */

export interface KeyValueStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

/** In-memory store for tests / non-extension contexts. */
export class MemoryStorage implements KeyValueStore {
  #map = new Map<string, unknown>();

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.#map.get(key) as T | undefined;
  }
  async set(key: string, value: unknown): Promise<void> {
    // Round-trip through JSON to mirror structured-clone-ish persistence and to
    // catch accidental non-serializable values early.
    this.#map.set(key, JSON.parse(JSON.stringify(value)));
  }
  async remove(key: string): Promise<void> {
    this.#map.delete(key);
  }
  async clear(): Promise<void> {
    this.#map.clear();
  }
  /** Test helper: raw snapshot of persisted values. */
  snapshot(): Record<string, unknown> {
    return Object.fromEntries(this.#map.entries());
  }
}

/** Minimal shape of a `browser.storage` area (webextension-polyfill). */
export interface WebExtStorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
}

/** Wraps a real `browser.storage.local` / `.session` area. */
export class WebExtStorage implements KeyValueStore {
  constructor(private area: WebExtStorageArea) {}

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const res = await this.area.get(key);
    return res[key] as T | undefined;
  }
  async set(key: string, value: unknown): Promise<void> {
    await this.area.set({ [key]: value });
  }
  async remove(key: string): Promise<void> {
    await this.area.remove(key);
  }
  async clear(): Promise<void> {
    await this.area.clear();
  }
}
