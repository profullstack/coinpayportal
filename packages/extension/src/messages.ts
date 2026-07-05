/**
 * Message protocol between the popup/content contexts and the background
 * service worker. All signing/seed access happens in the background only
 * (PRD §9); the popup never touches key material directly.
 */

import type { DerivedAddress } from './core/derivation.js';

export type WalletRequest =
  | { type: 'getState' }
  | { type: 'create'; password: string; words?: 12 | 24 }
  | { type: 'import'; mnemonic: string; password: string }
  | { type: 'unlock'; password: string }
  | { type: 'lock' }
  | { type: 'getAccounts' };

export interface WalletState {
  initialized: boolean;
  unlocked: boolean;
}

export type WalletResponse =
  | { ok: true; state: WalletState }
  | { ok: true; accounts: DerivedAddress[] }
  | { ok: true; mnemonic: string; accounts: DerivedAddress[] }
  | { ok: false; error: string };
