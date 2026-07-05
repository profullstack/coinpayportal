/**
 * Popup entry — Phase-1 read-only view. Talks to the background service worker
 * over runtime messaging; it never touches seed material itself.
 *
 * Onboarding (create/import) and send/x402 approval UIs are subsequent phases;
 * this renders wallet state + derived addresses to prove the messaging + core
 * pipeline end to end.
 */

import type { WalletRequest, WalletResponse } from '../messages.js';

function send(req: WalletRequest): Promise<WalletResponse> {
  return chrome.runtime.sendMessage(req) as Promise<WalletResponse>;
}

function shorten(addr: string): string {
  return addr.length > 18 ? `${addr.slice(0, 10)}…${addr.slice(-6)}` : addr;
}

async function render(): Promise<void> {
  const statusEl = document.getElementById('status')!;
  const accountsEl = document.getElementById('accounts')!;

  const stateRes = await send({ type: 'getState' });
  if (!stateRes.ok || !('state' in stateRes)) {
    statusEl.textContent = 'Unavailable';
    return;
  }

  const { initialized, unlocked } = stateRes.state;
  if (!initialized) {
    statusEl.textContent = 'No wallet yet — create or import to get started.';
    return;
  }
  if (!unlocked) {
    statusEl.textContent = 'Locked — unlock to view balances.';
    return;
  }

  statusEl.textContent = 'Unlocked';
  const accRes = await send({ type: 'getAccounts' });
  if (accRes.ok && 'accounts' in accRes) {
    accountsEl.innerHTML = accRes.accounts
      .map(
        (a) =>
          `<div class="row"><span class="chain">${a.chain}</span><span class="addr">${shorten(a.address)}</span></div>`,
      )
      .join('');
  }
}

void render();
