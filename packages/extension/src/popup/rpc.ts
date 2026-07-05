/** Typed wrapper around runtime messaging to the background service worker. */

import type { WalletRequest, WalletResponse } from '../messages.js';

export function send(req: WalletRequest): Promise<WalletResponse> {
  return chrome.runtime.sendMessage(req) as Promise<WalletResponse>;
}

/** Send and throw on `{ ok: false }`, returning the success payload. */
export async function call<T extends WalletResponse = WalletResponse>(req: WalletRequest): Promise<T> {
  const res = await send(req);
  if (!res.ok) throw new Error(res.error);
  return res as T;
}
