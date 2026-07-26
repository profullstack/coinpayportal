/**
 * Wallet lifecycle service (PRD P0-2 / P0-3): create, import, lock, unlock.
 *
 * Non-custodial invariants:
 *   - The mnemonic/seed is NEVER persisted in plaintext. `storage.local` holds
 *     only the encrypted vault + public metadata (addresses).
 *   - While unlocked, the seed lives in `storage.session` (cleared on browser
 *     close) so a service-worker restart mid-session doesn't force re-login.
 *   - The mnemonic is returned from `create()` exactly once for the backup
 *     screen and then discarded by the caller.
 */

// generateMnemonic / validateMnemonic come from the SDK's ./wallet subpath.
import { generateMnemonic, validateMnemonic } from '@profullstack/coinpay/wallet';

import { deriveAllAddresses, seedFromMnemonic, type DerivedAddress } from './derivation.js';
import { DEFAULT_CHAINS, type NativeChain } from './chains.js';
import { encryptSeed, decryptSeed, type EncryptedVault } from './vault.js';
import { bytesToB64, b64ToBytes } from './b64.js';
import type { KeyValueStore } from './storage.js';

const LOCAL_VAULT = 'vault';
const LOCAL_ACCOUNTS = 'accounts';
const LOCAL_META = 'meta';
const LOCAL_ACCOUNT_LIST = 'accountList';
const LOCAL_ACTIVE_ACCOUNT = 'activeAccount';
const SESSION_SEED = 'seed';
const SESSION_PENDING = 'pendingMnemonic';

export interface WalletMeta {
  createdAt: number;
  chains: NativeChain[];
}

/** A derived account: an index into the seed, plus a name the user chose. */
export interface WalletAccount {
  index: number;
  label: string;
  /**
   * Removed from the wallet UI. The record is kept rather than deleted so the
   * index is never handed out again — reusing it would silently resurrect an
   * address the user believed they were done with, and any funds sent there in
   * the meantime would appear in a "new" account.
   */
  hidden?: boolean;
}

export interface CreateResult {
  /** Show once on the backup screen, then discard. Never persisted. */
  mnemonic: string;
  accounts: DerivedAddress[];
}

export class WalletService {
  constructor(
    private local: KeyValueStore,
    private session: KeyValueStore,
    private chains: readonly NativeChain[] = DEFAULT_CHAINS,
  ) {}

  /** True once a wallet has been created/imported (an encrypted vault exists). */
  async isInitialized(): Promise<boolean> {
    return (await this.local.get<EncryptedVault>(LOCAL_VAULT)) !== undefined;
  }

  /** True while the seed is available in the session (wallet unlocked). */
  async isUnlocked(): Promise<boolean> {
    return (await this.session.get<string>(SESSION_SEED)) !== undefined;
  }

  /**
   * Begin wallet creation: generate a mnemonic and derive a preview of the
   * addresses, but DO NOT persist anything yet. The mnemonic is held in the
   * session so the UI can show the backup + confirmation screens. The wallet
   * is not usable until `confirmCreate()` (PRD P0-2).
   */
  async beginCreate(words: 12 | 24 = 12): Promise<CreateResult> {
    if (await this.isInitialized()) {
      throw new Error('A wallet already exists; import/overwrite is a separate flow');
    }
    const mnemonic: string = generateMnemonic(words);
    const accounts = deriveAllAddresses(seedFromMnemonic(mnemonic), this.chains);
    await this.session.set(SESSION_PENDING, mnemonic);
    return { mnemonic, accounts };
  }

  /** Finalize a pending creation once the user has confirmed their backup. */
  async confirmCreate(password: string): Promise<DerivedAddress[]> {
    const mnemonic = await this.session.get<string>(SESSION_PENDING);
    if (!mnemonic) throw new Error('No pending wallet to confirm');
    const accounts = await this.#persistNewWallet(mnemonic, password);
    await this.session.remove(SESSION_PENDING);
    return accounts;
  }

  /** Discard an in-progress creation. */
  async cancelCreate(): Promise<void> {
    await this.session.remove(SESSION_PENDING);
  }

  /**
   * Create a wallet in one step (begin + confirm). Convenience for programmatic
   * use / tests; the UI uses the two-step begin/confirm flow so the backup is
   * confirmed before the wallet is persisted.
   */
  async create(password: string, words: 12 | 24 = 12): Promise<CreateResult> {
    const result = await this.beginCreate(words);
    await this.confirmCreate(password);
    return result;
  }

  /** Import an existing BIP-39 mnemonic. */
  async import(mnemonic: string, password: string): Promise<DerivedAddress[]> {
    const trimmed = mnemonic.trim().replace(/\s+/g, ' ');
    if (!validateMnemonic(trimmed)) {
      throw new Error('Invalid recovery phrase');
    }
    return this.#persistNewWallet(trimmed, password);
  }

  /** Decrypt the vault with the password and hold the seed for the session. */
  async unlock(password: string): Promise<DerivedAddress[]> {
    const vault = await this.local.get<EncryptedVault>(LOCAL_VAULT);
    if (!vault) throw new Error('No wallet to unlock');
    const seed = await decryptSeed(vault, password); // throws on wrong password
    await this.session.set(SESSION_SEED, bytesToB64(seed));
    return this.getAccounts();
  }

  /** Drop the in-session seed. Vault + public accounts remain persisted. */
  async lock(): Promise<void> {
    await this.session.remove(SESSION_SEED);
  }

  /** Addresses for the active account. */
  async getAccounts(): Promise<DerivedAddress[]> {
    const byIndex = await this.#addressBook();
    return byIndex[await this.getActiveAccount()] ?? byIndex[0] ?? [];
  }

  /* ---------- multiple accounts ----------
     One recovery phrase backs an unlimited number of BIP-44 accounts, so
     "add account" is derivation, not a second wallet — the same phrase still
     restores everything. */

  /** Every account the user has added and not removed, in creation order. */
  async listAccounts(): Promise<WalletAccount[]> {
    return (await this.#allAccounts()).filter((a) => !a.hidden);
  }

  /**
   * Including removed ones. Used for index allocation and validation — a
   * removed account still owns its index forever.
   */
  async #allAccounts(): Promise<WalletAccount[]> {
    const stored = await this.local.get<WalletAccount[]>(LOCAL_ACCOUNT_LIST);
    if (stored?.length) return stored;
    // Wallets created before multi-account have exactly one, at index 0.
    return [{ index: 0, label: 'Account 1' }];
  }

  async getActiveAccount(): Promise<number> {
    return (await this.local.get<number>(LOCAL_ACTIVE_ACCOUNT)) ?? 0;
  }

  /** Switch which account the popup and site-facing APIs act as. */
  async selectAccount(index: number): Promise<DerivedAddress[]> {
    const accounts = await this.listAccounts();
    if (!accounts.some((a) => a.index === index)) {
      throw new Error(`No such account: ${index}`);
    }
    await this.local.set(LOCAL_ACTIVE_ACCOUNT, index);
    return this.getAccounts();
  }

  /**
   * Derive the next account from the same seed and make it active. Requires an
   * unlocked wallet — the addresses can only come from the seed.
   */
  async addAccount(label?: string): Promise<WalletAccount> {
    const seed = await this.requireSeed();
    // Allocate above every index ever issued, removed ones included.
    const accounts = await this.#allAccounts();
    const index = accounts.reduce((max, a) => Math.max(max, a.index), -1) + 1;
    const account: WalletAccount = { index, label: label?.trim() || `Account ${index + 1}` };

    const book = await this.#addressBook();
    book[index] = deriveAllAddresses(seed, this.chains, index);

    await this.local.set(LOCAL_ACCOUNTS, book);
    await this.local.set(LOCAL_ACCOUNT_LIST, [...accounts, account]);
    await this.local.set(LOCAL_ACTIVE_ACCOUNT, index);
    return account;
  }

  /** Rename an account. Cosmetic only — the index is what derives addresses. */
  async renameAccount(index: number, label: string): Promise<WalletAccount[]> {
    const trimmed = label.trim();
    if (!trimmed) throw new Error('Account name cannot be empty');
    const accounts = await this.#allAccounts();
    if (!accounts.some((a) => a.index === index && !a.hidden)) {
      throw new Error(`No such account: ${index}`);
    }
    const next = accounts.map((a) => (a.index === index ? { ...a, label: trimmed } : a));
    await this.local.set(LOCAL_ACCOUNT_LIST, next);
    return next.filter((a) => !a.hidden);
  }

  /**
   * Remove an account from the wallet.
   *
   * This hides it; it does not destroy anything. The account is a derivation of
   * the recovery phrase, so any funds at its addresses remain spendable by
   * anyone holding that phrase — removing it here only stops this wallet from
   * showing or using it. The index is retired, never reissued.
   *
   * Refuses to remove the last remaining account: a wallet with no account has
   * no addresses to show and no way back except re-import.
   */
  async removeAccount(index: number): Promise<{ accounts: WalletAccount[]; activeAccount: number }> {
    const all = await this.#allAccounts();
    if (!all.some((a) => a.index === index && !a.hidden)) {
      throw new Error(`No such account: ${index}`);
    }
    const remaining = all.filter((a) => !a.hidden && a.index !== index);
    if (!remaining.length) throw new Error('Cannot remove your only account');

    const next = all.map((a) => (a.index === index ? { ...a, hidden: true } : a));
    await this.local.set(LOCAL_ACCOUNT_LIST, next);

    // Drop the cached addresses; they are re-derivable and keeping them would
    // leave a removed account's addresses sitting in storage.
    const book = await this.#addressBook();
    if (book[index]) {
      delete book[index];
      await this.local.set(LOCAL_ACCOUNTS, book);
    }

    // Never leave the wallet pointing at an account it no longer shows.
    let active = await this.getActiveAccount();
    if (active === index) {
      active = remaining[0]!.index;
      await this.local.set(LOCAL_ACTIVE_ACCOUNT, active);
    }

    return { accounts: remaining, activeAccount: active };
  }

  /** Addresses for a specific account index (derives on demand when unlocked). */
  async addressesFor(index: number): Promise<DerivedAddress[]> {
    const book = await this.#addressBook();
    if (book[index]) return book[index];
    const seed = await this.requireSeed();
    book[index] = deriveAllAddresses(seed, this.chains, index);
    await this.local.set(LOCAL_ACCOUNTS, book);
    return book[index];
  }

  /**
   * Addresses keyed by account index. Pre-multi-account installs stored a bare
   * array for index 0, so coerce that shape rather than losing their addresses.
   */
  async #addressBook(): Promise<Record<number, DerivedAddress[]>> {
    const stored = await this.local.get<DerivedAddress[] | Record<number, DerivedAddress[]>>(LOCAL_ACCOUNTS);
    if (!stored) return {};
    return Array.isArray(stored) ? { 0: stored } : { ...stored };
  }

  async getMeta(): Promise<WalletMeta | undefined> {
    return this.local.get<WalletMeta>(LOCAL_META);
  }

  /**
   * Return the unlocked seed bytes for signing. Throws if locked.
   * Intended for the background context only (Phase 2 send / signing).
   */
  async requireSeed(): Promise<Uint8Array> {
    const b64 = await this.session.get<string>(SESSION_SEED);
    if (!b64) throw new Error('Wallet is locked');
    return b64ToBytes(b64);
  }

  async #persistNewWallet(mnemonic: string, password: string): Promise<DerivedAddress[]> {
    const seed = seedFromMnemonic(mnemonic);
    const accounts = deriveAllAddresses(seed, this.chains, 0);
    const vault = await encryptSeed(seed, password);
    await this.local.set(LOCAL_VAULT, vault);
    await this.local.set(LOCAL_ACCOUNTS, { 0: accounts });
    await this.local.set(LOCAL_ACCOUNT_LIST, [{ index: 0, label: 'Account 1' }]);
    await this.local.set(LOCAL_ACTIVE_ACCOUNT, 0);
    await this.local.set(LOCAL_META, { createdAt: Date.now(), chains: [...this.chains] } satisfies WalletMeta);
    // Newly created/imported wallet starts unlocked for the session.
    await this.session.set(SESSION_SEED, bytesToB64(seed));
    return accounts;
  }
}
