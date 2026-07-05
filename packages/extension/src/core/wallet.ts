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
const SESSION_SEED = 'seed';
const SESSION_PENDING = 'pendingMnemonic';

export interface WalletMeta {
  createdAt: number;
  chains: NativeChain[];
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
    return (await this.local.get<DerivedAddress[]>(LOCAL_ACCOUNTS)) ?? [];
  }

  /** Drop the in-session seed. Vault + public accounts remain persisted. */
  async lock(): Promise<void> {
    await this.session.remove(SESSION_SEED);
  }

  async getAccounts(): Promise<DerivedAddress[]> {
    return (await this.local.get<DerivedAddress[]>(LOCAL_ACCOUNTS)) ?? [];
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
    const accounts = deriveAllAddresses(seed, this.chains);
    const vault = await encryptSeed(seed, password);
    await this.local.set(LOCAL_VAULT, vault);
    await this.local.set(LOCAL_ACCOUNTS, accounts);
    await this.local.set(LOCAL_META, { createdAt: Date.now(), chains: [...this.chains] } satisfies WalletMeta);
    // Newly created/imported wallet starts unlocked for the session.
    await this.session.set(SESSION_SEED, bytesToB64(seed));
    return accounts;
  }
}
