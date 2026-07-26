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
  // ── popup: accounts (one seed, many BIP-44 indexes) ──
  | { type: 'listAccounts' }
  | { type: 'addAccount'; label?: string }
  | { type: 'selectAccount'; index: number }
  | { type: 'renameAccount'; index: number; label: string }
  | { type: 'removeAccount'; index: number }
  // ── popup: user-initiated send ──
  | { type: 'send'; chain: string; to: string; amount: string }
  | { type: 'getSettings' }
  | { type: 'setAutoLockMinutes'; minutes: number }
  | { type: 'setFiatCurrency'; currency: string }
  // Quote a coin in fiat. `fiat` defaults to the user's display currency.
  | { type: 'getRate'; coin: string; fiat?: string }
  // ── page (via content script) ──
  | { type: 'site:getState' }
  | { type: 'site:connect' }
  | { type: 'site:getAccounts' }
  | { type: 'site:payBatch'; payments: BatchPaymentRequest[] }
  // ── approval window ──
  | { type: 'approval:get'; requestId: string }
  | { type: 'approval:approve'; requestId: string; password?: string }
  | { type: 'approval:reject'; requestId: string }
  | { type: 'approval:cancel'; requestId: string };

export interface WalletState {
  initialized: boolean;
  unlocked: boolean;
  /** Active BIP-44 account index, and every account the user has added. */
  activeAccount?: number;
  accountList?: WalletAccountSummary[];
}

export interface WalletAccountSummary {
  index: number;
  label: string;
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
      /** BIP-44 account that will pay, pinned when the request was made. */
      accountIndex: number;
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
  | { ok: true; walletAccounts: WalletAccountSummary[]; activeAccount: number }
  | { ok: true; sent: BatchItemResult }
  | { ok: true; settings: WalletSettings }
  | { ok: true; quote: RateQuote }
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
