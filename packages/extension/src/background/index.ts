/**
 * Background service worker (MV3) — the only context that holds seed material.
 *
 * Responsibilities in this Phase-1 slice:
 *   - Wire `WalletService` to `browser.storage.local` (encrypted vault) and
 *     `browser.storage.session` (unlocked seed).
 *   - Route popup requests (create / import / unlock / lock / getState).
 *   - Idle auto-lock via `alarms` (PRD P0-3, default 15 min).
 *
 * `chrome.*` is used directly here; it exists in Chromium and Firefox MV3 for
 * the storage/alarms/runtime APIs used below. A `webextension-polyfill` layer
 * (per PRD §9) can be swapped in without touching the core modules.
 */

import { WalletService } from '../core/wallet.js';
import { WebExtStorage, type WebExtStorageArea } from '../core/storage.js';
import type { WalletRequest, WalletResponse } from '../messages.js';

const AUTO_LOCK_ALARM = 'coinpay-auto-lock';
const DEFAULT_IDLE_MINUTES = 15;

// chrome.storage promise API — cast to our minimal area interface.
const local = new WebExtStorage(chrome.storage.local as unknown as WebExtStorageArea);
const session = new WebExtStorage(chrome.storage.session as unknown as WebExtStorageArea);
const wallet = new WalletService(local, session);

function scheduleAutoLock(minutes = DEFAULT_IDLE_MINUTES): void {
  chrome.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: minutes });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) void wallet.lock();
});

async function handle(req: WalletRequest): Promise<WalletResponse> {
  try {
    switch (req.type) {
      case 'getState':
        return { ok: true, state: { initialized: await wallet.isInitialized(), unlocked: await wallet.isUnlocked() } };
      case 'create': {
        const { mnemonic, accounts } = await wallet.create(req.password, req.words ?? 12);
        scheduleAutoLock();
        return { ok: true, mnemonic, accounts };
      }
      case 'import': {
        const accounts = await wallet.import(req.mnemonic, req.password);
        scheduleAutoLock();
        return { ok: true, accounts };
      }
      case 'unlock': {
        const accounts = await wallet.unlock(req.password);
        scheduleAutoLock();
        return { ok: true, accounts };
      }
      case 'lock':
        await wallet.lock();
        return { ok: true, state: { initialized: await wallet.isInitialized(), unlocked: false } };
      case 'getAccounts':
        return { ok: true, accounts: await wallet.getAccounts() };
      default:
        return { ok: false, error: 'Unknown request' };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

chrome.runtime.onMessage.addListener((req: WalletRequest, _sender, sendResponse) => {
  handle(req).then(sendResponse);
  return true; // keep the message channel open for the async response
});
