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
/** Superseded by the per-chain book; read once by the migration. */
const LOCAL_ACCOUNTS = 'accounts';
/** `{ [chain]: [{ index, address }] }` — the web wallet's model. */
const LOCAL_CHAIN_ADDRESSES = 'chainAddresses';
const LOCAL_META = 'meta';
const LOCAL_ACCOUNT_LIST = 'accountList';
const LOCAL_ACTIVE_ACCOUNT = 'activeAccount';
const SESSION_SEED = 'seed';
const SESSION_PENDING = 'pendingMnemonic';

export interface WalletMeta {
  createdAt: number;
  chains: NativeChain[];
}

/** One derived address of one chain. */
export interface ChainAddress {
  /** BIP-44 index within its chain. */
  index: number;
  address: string;
  /** Tokens that ride on this address (e.g. USDC on ETH). */
  tokens: readonly string[];
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

  /**
   * One address per chain — each chain's first — for callers that just need
   * somewhere to receive or a sender to sign with (site connections, previews).
   */
  async getAccounts(): Promise<DerivedAddress[]> {
    const book = await this.addresses();
    return Object.entries(book).flatMap(([chain, entries]) => {
      const first = entries[0];
      return first
        ? [{ chain: chain as NativeChain, address: first.address, tokens: first.tokens }]
        : [];
    });
  }

  /* ---------- addresses ----------
     The CoinPay web wallet has no notion of "accounts": a wallet holds one or
     more ADDRESSES PER CHAIN, each at its own derivation index, and each chain
     advances independently (BTC can be at index 2 while POL is still at 0).

     The old model here grouped index N of every chain into "Account N+1",
     which described nothing the portal actually has and hid funds behind a
     switcher. Same derivation, same keys — only the grouping changed. */

  /** Every derived address, grouped by chain, in derivation order. */
  async addresses(): Promise<Record<string, ChainAddress[]>> {
    await this.#migrateAccountsToChains();
    const stored = await this.local.get<Record<string, ChainAddress[]>>(LOCAL_CHAIN_ADDRESSES);
    if (stored && Object.keys(stored).length) return stored;

    // A wallet from before this layout, or one whose book was never written.
    const seed = await this.requireSeed();
    const book: Record<string, ChainAddress[]> = {};
    for (const derived of deriveAllAddresses(seed, this.chains, 0)) {
      book[derived.chain] = [{ index: 0, address: derived.address, tokens: derived.tokens }];
    }
    await this.local.set(LOCAL_CHAIN_ADDRESSES, book);
    return book;
  }

  /** Flattened view: one entry per derived address. */
  async addressList(): Promise<(ChainAddress & { chain: NativeChain })[]> {
    const book = await this.addresses();
    return Object.entries(book).flatMap(([chain, entries]) =>
      entries.map((entry) => ({ ...entry, chain: chain as NativeChain })),
    );
  }

  /** The address a chain receives on by default — its first derived one. */
  async primaryAddress(chain: NativeChain): Promise<ChainAddress | undefined> {
    return (await this.addresses())[chain]?.[0];
  }

  /**
   * Derive one more address for a chain, at the next unused index for THAT
   * chain — matching how the web wallet hands out receiving addresses.
   */
  async addAddress(chain: NativeChain): Promise<ChainAddress> {
    const seed = await this.requireSeed();
    const book = await this.addresses();
    const existing = book[chain] ?? [];
    // Never reuse an index: a returning address would collect funds the user
    // believes are going somewhere new.
    const index = existing.reduce((max, entry) => Math.max(max, entry.index), -1) + 1;
    const [derived] = deriveAllAddresses(seed, [chain], index);
    if (!derived) throw new Error(`Cannot derive an address for ${chain}`);

    const entry: ChainAddress = { index, address: derived.address, tokens: derived.tokens };
    book[chain] = [...existing, entry];
    await this.local.set(LOCAL_CHAIN_ADDRESSES, book);
    return entry;
  }

  /** The derivation index behind an address, for signing. */
  async indexOf(chain: NativeChain, address: string): Promise<number | undefined> {
    const entries = (await this.addresses())[chain] ?? [];
    return entries.find((e) => e.address.toLowerCase() === address.toLowerCase())?.index;
  }

  /**
   * Fold the old `{ accountIndex: DerivedAddress[] }` book into per-chain
   * lists. Account 2 held index 1 of every chain, so each of those becomes
   * that chain's index-1 address — nothing is derived differently and nothing
   * is lost, including addresses that already hold funds.
   */
  async #migrateAccountsToChains(): Promise<void> {
    const stored = await this.local.get<DerivedAddress[] | Record<string, DerivedAddress[]>>(
      LOCAL_ACCOUNTS,
    );
    if (!stored) return;
    // The very first layout stored a bare array — index 0 of every chain.
    const legacy: Record<string, DerivedAddress[]> = Array.isArray(stored) ? { 0: stored } : stored;

    const book = (await this.local.get<Record<string, ChainAddress[]>>(LOCAL_CHAIN_ADDRESSES)) ?? {};
    for (const [rawIndex, derived] of Object.entries(legacy)) {
      const index = Number(rawIndex);
      if (!Number.isFinite(index) || !Array.isArray(derived)) continue;
      for (const entry of derived) {
        const list = book[entry.chain] ?? [];
        if (list.some((e) => e.index === index)) continue;
        list.push({ index, address: entry.address, tokens: entry.tokens });
        book[entry.chain] = list;
      }
    }
    for (const chain of Object.keys(book)) {
      book[chain]!.sort((a, b) => a.index - b.index);
    }

    await this.local.set(LOCAL_CHAIN_ADDRESSES, book);
    await this.local.remove(LOCAL_ACCOUNTS);
    await this.local.remove(LOCAL_ACCOUNT_LIST);
    await this.local.remove(LOCAL_ACTIVE_ACCOUNT);
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

  /**
   * Forget this device's wallet entirely, so a different recovery phrase can be
   * imported.
   *
   * Irreversible here and unrecoverable without the phrase: the vault is the
   * only copy of the seed on this machine. Everything goes — vault, addresses,
   * account list, settings, site connections, portal wallet ids — because a
   * wallet from a different seed must not inherit any of the previous one's
   * state.
   */
  async reset(): Promise<void> {
    await this.session.clear();
    await this.local.clear();
  }

  async #persistNewWallet(mnemonic: string, password: string): Promise<DerivedAddress[]> {
    const seed = seedFromMnemonic(mnemonic);
    const accounts = deriveAllAddresses(seed, this.chains, 0);
    const vault = await encryptSeed(seed, password);
    await this.local.set(LOCAL_VAULT, vault);
    await this.local.set(
      LOCAL_CHAIN_ADDRESSES,
      Object.fromEntries(
        accounts.map((a) => [a.chain, [{ index: 0, address: a.address, tokens: a.tokens }]]),
      ),
    );
    await this.local.set(LOCAL_META, { createdAt: Date.now(), chains: [...this.chains] } satisfies WalletMeta);
    // Newly created/imported wallet starts unlocked for the session.
    await this.session.set(SESSION_SEED, bytesToB64(seed));
    return accounts;
  }
}
