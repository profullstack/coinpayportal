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
