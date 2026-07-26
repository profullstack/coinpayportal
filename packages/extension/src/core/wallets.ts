/**
 * Several wallets side by side, each with its own recovery phrase.
 *
 * An "account" is a BIP-44 index of ONE phrase. A second CoinPay wallet is a
 * different phrase entirely, so it needs its own vault, address book, account
 * list and portal registration — none of which can be shared.
 *
 * Rather than teach `WalletService` about namespaces, every wallet gets its own
 * key space via `PrefixedStore`. The service stores exactly what it always did;
 * it simply cannot see another wallet's keys.
 *
 * Storage layout:
 *   walletList          [{ id, label }]        — global
 *   activeWallet        id                     — global
 *   w:<id>:vault        encrypted seed         — per wallet
 *   w:<id>:accounts     address book           — per wallet
 *   w:<id>:portalWallet portal registration    — per wallet
 *   …
 */

import type { KeyValueStore } from './storage.js';

export interface WalletEntry {
  id: string;
  label: string;
}

const LOCAL_WALLET_LIST = 'walletList';
const LOCAL_ACTIVE_WALLET = 'activeWallet';
/**
 * Highest wallet number ever issued. Held separately from the list because the
 * list shrinks on removal — deriving the next id from it would hand a new
 * wallet the key space of a deleted one, and any leftover value under that
 * prefix would surface as if it belonged to the new phrase.
 */
const LOCAL_WALLET_SEQ = 'walletSeq';

/**
 * The id given to a wallet that predates multi-wallet support. Its keys are
 * moved under this namespace on first run so the existing wallet keeps working.
 */
export const FIRST_WALLET_ID = 'w1';

/** Keys `WalletService` owns, which the migration relocates. */
const MIGRATED_KEYS = ['vault', 'accounts', 'chainAddresses', 'meta', 'accountList', 'activeAccount'] as const;

/** Wallet-scoped keys owned by the background worker. */
const BACKGROUND_KEYS = ['portalWallet', 'portalWalletId', 'portalWalletIds'] as const;

export function walletPrefix(id: string): string {
  return `w:${id}:`;
}

/** A view of a store limited to one wallet's keys. */
export class PrefixedStore implements KeyValueStore {
  constructor(
    private readonly inner: KeyValueStore,
    private readonly prefix: string,
  ) {}

  get<T = unknown>(key: string): Promise<T | undefined> {
    return this.inner.get<T>(this.prefix + key);
  }
  set(key: string, value: unknown): Promise<void> {
    return this.inner.set(this.prefix + key, value);
  }
  remove(key: string): Promise<void> {
    return this.inner.remove(this.prefix + key);
  }
  /**
   * Removing only what this wallet owns. A blanket `clear()` would take the
   * other wallets with it, which is the opposite of what a per-wallet reset
   * means — so the keys are enumerated rather than wildcarded.
   */
  async clear(): Promise<void> {
    for (const key of [...MIGRATED_KEYS, ...BACKGROUND_KEYS, 'seed', 'pendingMnemonic']) {
      await this.inner.remove(this.prefix + key);
    }
  }
}

export class WalletRegistry {
  constructor(private readonly local: KeyValueStore) {}

  async list(): Promise<WalletEntry[]> {
    const stored = await this.local.get<WalletEntry[]>(LOCAL_WALLET_LIST);
    if (stored?.length) return stored;
    return [{ id: FIRST_WALLET_ID, label: 'Wallet 1' }];
  }

  async activeId(): Promise<string> {
    const active = await this.local.get<string>(LOCAL_ACTIVE_WALLET);
    if (active && (await this.list()).some((w) => w.id === active)) return active;
    return (await this.list())[0]!.id;
  }

  async select(id: string): Promise<void> {
    if (!(await this.list()).some((w) => w.id === id)) throw new Error(`No such wallet: ${id}`);
    await this.local.set(LOCAL_ACTIVE_WALLET, id);
  }

  /**
   * Register a new wallet and make it active. Allocates an id above every one
   * ever issued, so a removed wallet's key space is never reused by a new one.
   */
  async add(label?: string): Promise<WalletEntry> {
    const wallets = await this.list();
    const stored = await this.local.get<number>(LOCAL_WALLET_SEQ);
    // Fall back to the live list only for installs predating the counter.
    const highest = Math.max(
      typeof stored === 'number' ? stored : 0,
      ...wallets.map((w) => {
        const n = Number.parseInt(w.id.replace(/^w/, ''), 10);
        return Number.isFinite(n) ? n : 0;
      }),
    );
    const next = highest + 1;
    const entry: WalletEntry = {
      id: `w${next}`,
      label: label?.trim() || `Wallet ${wallets.length + 1}`,
    };
    await this.local.set(LOCAL_WALLET_SEQ, next);
    await this.local.set(LOCAL_WALLET_LIST, [...wallets, entry]);
    await this.local.set(LOCAL_ACTIVE_WALLET, entry.id);
    return entry;
  }

  async rename(id: string, label: string): Promise<WalletEntry[]> {
    const trimmed = label.trim();
    if (!trimmed) throw new Error('Wallet name cannot be empty');
    const wallets = await this.list();
    if (!wallets.some((w) => w.id === id)) throw new Error(`No such wallet: ${id}`);
    const next = wallets.map((w) => (w.id === id ? { ...w, label: trimmed } : w));
    await this.local.set(LOCAL_WALLET_LIST, next);
    return next;
  }

  /**
   * Forget a wallet and everything under it. Refuses the last one: removing it
   * would leave the extension with no wallet and no way back except import,
   * which is what the reset action is for.
   */
  async remove(id: string): Promise<{ wallets: WalletEntry[]; activeId: string }> {
    const wallets = await this.list();
    if (!wallets.some((w) => w.id === id)) throw new Error(`No such wallet: ${id}`);
    const remaining = wallets.filter((w) => w.id !== id);
    if (!remaining.length) throw new Error('Cannot remove your only wallet');

    await new PrefixedStore(this.local, walletPrefix(id)).clear();
    await this.local.set(LOCAL_WALLET_LIST, remaining);

    let active = await this.activeId();
    if (active === id) {
      active = remaining[0]!.id;
      await this.local.set(LOCAL_ACTIVE_WALLET, active);
    }
    return { wallets: remaining, activeId: active };
  }

  /**
   * Move a pre-multi-wallet install into the new layout.
   *
   * Detected by an unprefixed `vault`: that can only be the single wallet the
   * extension used to support. Its keys are copied under `w1` and the originals
   * removed, so nothing is lost and nothing is left to confuse a later read.
   */
  async migrateLegacy(): Promise<boolean> {
    const legacyVault = await this.local.get(MIGRATED_KEYS[0]);
    if (legacyVault === undefined) return false;

    const target = new PrefixedStore(this.local, walletPrefix(FIRST_WALLET_ID));
    for (const key of [...MIGRATED_KEYS, ...BACKGROUND_KEYS]) {
      const value = await this.local.get(key);
      if (value === undefined) continue;
      await target.set(key, value);
      await this.local.remove(key);
    }

    await this.local.set(LOCAL_WALLET_LIST, [{ id: FIRST_WALLET_ID, label: 'Wallet 1' }]);
    await this.local.set(LOCAL_ACTIVE_WALLET, FIRST_WALLET_ID);
    return true;
  }
}
