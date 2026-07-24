/**
 * `window.coinpay` — the page-facing provider.
 *
 * Runs in the PAGE's world, so it is fully untrusted: it holds no keys, no
 * state, and no authority. Everything it does is a postMessage to the content
 * script, which relays to the background worker, which decides. The page cannot
 * spoof its origin (the browser stamps it) and cannot move funds without the
 * user approving in the extension's own window.
 *
 * Usage:
 *   await window.coinpay.connect()
 *   const { results } = await window.coinpay.payBatch(payments, {
 *     onProgress: (p) => render(p),
 *   })
 */

const CHANNEL_REQUEST = 'coinpay:page-request';
const CHANNEL_RESPONSE = 'coinpay:page-response';
const CHANNEL_EVENT = 'coinpay:page-event';

export interface CoinPayPayment {
  /** Your correlation id — echoed back on the matching result. */
  id: string;
  /** BTC | BCH | ETH | POL | SOL | USDC_ETH | USDC_POL | USDC_SOL | USDT_* */
  chain: string;
  to: string;
  /** Decimal string in the chain's display units. */
  amount: string;
  label?: string;
  amountUsd?: number;
}

export interface CoinPayPaymentResult {
  id: string;
  chain: string;
  to: string;
  amount: string;
  status: 'sent' | 'failed' | 'skipped';
  txHash?: string;
  explorerUrl?: string;
  error?: string;
}

export interface CoinPayProgress {
  id: string;
  stage: 'queued' | 'preparing' | 'signing' | 'broadcasting' | 'sent' | 'failed' | 'skipped';
  txHash?: string;
  explorerUrl?: string;
  error?: string;
  completed: number;
  total: number;
}

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void };

const pending = new Map<string, Pending>();
const progressListeners = new Set<(progress: CoinPayProgress) => void>();
let counter = 0;

function send<T>(payload: Record<string, unknown>): Promise<T> {
  const requestId = `cp-${Date.now()}-${++counter}`;
  return new Promise<T>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    window.postMessage({ channel: CHANNEL_REQUEST, requestId, payload }, window.location.origin);
  });
}

window.addEventListener('message', (event: MessageEvent) => {
  // Only trust messages this window posted to itself (i.e. from our own content
  // script), never anything arriving from a frame or another origin.
  if (event.source !== window) return;
  const data = event.data as Record<string, any> | null;
  if (!data) return;

  if (data.channel === CHANNEL_RESPONSE) {
    const entry = pending.get(data.requestId);
    if (!entry) return;
    pending.delete(data.requestId);
    if (data.error) entry.reject(new Error(String(data.error)));
    else entry.resolve(data.result);
    return;
  }

  if (data.channel === CHANNEL_EVENT && data.event?.type === 'coinpay:progress') {
    for (const listener of progressListeners) {
      try {
        listener(data.event.progress as CoinPayProgress);
      } catch {
        // A broken page listener must not break the run.
      }
    }
  }
});

const provider = {
  isCoinPay: true as const,
  version: '0.1.0',

  /** Wallet presence/lock/connection state. Safe to call before connecting. */
  getState(): Promise<{ initialized: boolean; unlocked: boolean; connected: boolean }> {
    return send({ type: 'site:getState' });
  },

  /**
   * Ask the user to connect this site. Resolves with the wallet's public
   * addresses; rejects if the user declines.
   */
  connect(): Promise<{ accounts: { chain: string; address: string; tokens: string[] }[] }> {
    return send({ type: 'site:connect' });
  },

  getAccounts(): Promise<{ accounts: { chain: string; address: string; tokens: string[] }[] }> {
    return send({ type: 'site:getAccounts' });
  },

  /**
   * Request a batch of payments. Opens ONE approval window listing them all.
   *
   * Resolves after every payment reaches a terminal state — including when some
   * fail: inspect `status` per result rather than assuming all-or-nothing.
   * Rejects only if the user declines or the batch never starts.
   */
  async payBatch(
    payments: CoinPayPayment[],
    options: { onProgress?: (progress: CoinPayProgress) => void } = {},
  ): Promise<{ results: CoinPayPaymentResult[] }> {
    if (options.onProgress) progressListeners.add(options.onProgress);
    try {
      return await send({ type: 'site:payBatch', payments });
    } finally {
      if (options.onProgress) progressListeners.delete(options.onProgress);
    }
  },

  /** Subscribe to progress independently of a `payBatch` call. */
  onProgress(listener: (progress: CoinPayProgress) => void): () => void {
    progressListeners.add(listener);
    return () => progressListeners.delete(listener);
  },
};

Object.defineProperty(window, 'coinpay', { value: Object.freeze(provider), configurable: false });

// Let pages that loaded before the extension know the provider is now live.
window.dispatchEvent(new Event('coinpay#initialized'));

export type CoinPayProvider = typeof provider;
