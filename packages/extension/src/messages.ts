/**
 * Message protocol between the popup / content / approval contexts and the
 * background service worker. All signing/seed access happens in the background
 * only (PRD §9); no other context touches key material directly.
 *
 * Three families, distinguished by prefix:
 *   (none)     — popup ↔ background wallet lifecycle. Trusted context.
 *   `site:`    — web page ↔ background, relayed by the content script. UNTRUSTED:
 *                the background stamps the real origin from `sender` and never
 *                takes the page's word for it.
 *   `approval:`— the approval window ↔ background, resolving a pending request.
 */

import type { DerivedAddress } from './core/derivation.js';
import type { BatchPaymentRequest, BatchItemResult, BatchProgress } from './core/batch.js';
import type { SiteConnection } from './core/connections.js';
import type { FiatCurrency } from './core/fiat.js';
import type { RateQuote } from './core/rates.js';
import type { WalletTransaction } from './core/api.js';

export type { WalletTransaction };

export type WalletRequest =
  // ── popup: wallet lifecycle ──
  | { type: 'getState' }
  | { type: 'beginCreate'; words?: 12 | 24 }
  | { type: 'confirmCreate'; password: string }
  | { type: 'cancelCreate' }
  | { type: 'import'; mnemonic: string; password: string }
  | { type: 'unlock'; password: string }
  | { type: 'lock' }
  | { type: 'getAccounts' }
  | { type: 'listConnections' }
  | { type: 'disconnectSite'; origin: string }
  // ── popup: wallets (each its own recovery phrase) ──
  | { type: 'listWallets' }
  | { type: 'selectWallet'; id: string }
  | { type: 'renameWallet'; id: string; label: string }
  | { type: 'removeWallet'; id: string }
  /** Begin a second wallet: the next create/import lands in a fresh vault. */
  | { type: 'addWallet'; label?: string }
  // ── popup: addresses (per chain, each at its own derivation index) ──
  | { type: 'listAddresses' }
  | { type: 'addAddress'; chain: string }
  // ── popup: user-initiated send ──
  /** `from` picks which of a chain's addresses pays; omit for its first. */
  | { type: 'send'; chain: string; to: string; amount: string; from?: string }
  // Which accounts the portal knows about, and registering one on demand.
  | { type: 'getPortalStatus' }
  /** Balances for the active account, from the portal's cached view. */
  | { type: 'getBalances' }
  /** Recent transactions — whole wallet, or one asset when `chain` is given. */
  | { type: 'getTransactions'; chain?: string }
  | { type: 'registerAccount'; index: number }
  /** Wipe this device's wallet so a different phrase can be imported. */
  | { type: 'resetWallet' }
  | { type: 'getSettings' }
  | { type: 'setAutoLockMinutes'; minutes: number }
  | { type: 'setFiatCurrency'; currency: string }
  // Quote a coin in fiat. `fiat` defaults to the user's display currency.
  | { type: 'getRate'; coin: string; fiat?: string }
  // ── page (via content script) ──
  | { type: 'site:getState' }
  | { type: 'site:connect' }
  | { type: 'site:getAccounts' }
  /** `from` picks which of a chain's addresses pays, as for `send`. */
  | { type: 'site:payBatch'; payments: BatchPaymentRequest[]; from?: string }
  // ── approval window ──
  | { type: 'approval:get'; requestId: string }
  | { type: 'approval:approve'; requestId: string; password?: string }
  | { type: 'approval:reject'; requestId: string }
  | { type: 'approval:cancel'; requestId: string };

export interface WalletState {
  initialized: boolean;
  unlocked: boolean;
}

/** One wallet — a distinct recovery phrase held by this extension. */
export interface WalletSummary {
  id: string;
  label: string;
  /** False until a phrase has been created or imported into it. */
  initialized: boolean;
}

/** One derived address: which chain, which index, and where. */
export interface WalletAddress {
  /** Native chain the address belongs to (its key signs for it). */
  chain: string;
  index: number;
  address: string;
  tokens: readonly string[];
}

/** A confirmed on-chain balance for one of the wallet's addresses. */
export interface AddressBalance {
  chain: string;
  address: string;
  /** Decimal string in the chain's display units. */
  balance: string;
  updatedAt?: string;
  /**
   * True when this extension derived the address from the seed itself. False
   * for addresses known only from the portal's wallet record — shown so the
   * user sees their whole wallet, but not presented as verified.
   */
  derived?: boolean;
}

/** What the portal knows about one account. */
export interface PortalAccountStatus {
  index: number;
  label: string;
  /** Portal wallet id, or null when this account has not been registered. */
  walletId: string | null;
}

export interface WalletSettings {
  autoLockMinutes: number;
  /** Fiat the wallet prices amounts in. Defaults to USD. */
  fiatCurrency: FiatCurrency;
}

/** What a page may learn about the wallet before connecting. */
export interface SiteState extends WalletState {
  connected: boolean;
}

/** A request parked while the approval window is open. */
export type PendingApproval =
  | {
      kind: 'connect';
      requestId: string;
      origin: string;
      /** True when the wallet must be unlocked before approving. */
      needsUnlock: boolean;
    }
  | {
      kind: 'payBatch';
      requestId: string;
      origin: string;
      needsUnlock: boolean;
      payments: BatchPaymentRequest[];
      summary: { chain: string; count: number; total: string; totalUsd: number }[];
    };

export type WalletResponse =
  | { ok: true; state: WalletState }
  | { ok: true; siteState: SiteState }
  | { ok: true; accounts: DerivedAddress[] }
  | { ok: true; mnemonic: string; accounts: DerivedAddress[] }
  | { ok: true; connections: SiteConnection[] }
  | { ok: true; approval: PendingApproval }
  | { ok: true; results: BatchItemResult[] }
  | { ok: true; addresses: WalletAddress[] }
  | { ok: true; address: WalletAddress; addresses: WalletAddress[] }
  | { ok: true; wallets: WalletSummary[]; activeWallet: string }
  | { ok: true; sent: BatchItemResult }
  | { ok: true; settings: WalletSettings }
  | { ok: true; quote: RateQuote }
  | { ok: true; portal: PortalAccountStatus[] }
  | { ok: true; balances: AddressBalance[] }
  | { ok: true; transactions: WalletTransaction[] }
  | { ok: true }
  | { ok: false; error: string };

/**
 * Background → other contexts, pushed rather than requested.
 * `coinpay:progress` also reaches the page: the content script forwards it so a
 * 62-payment run can render live instead of blocking on one long promise.
 */
export type WalletEvent =
  | { type: 'coinpay:progress'; requestId: string; origin: string; progress: BatchProgress }
  | { type: 'coinpay:approvalResolved'; requestId: string };
