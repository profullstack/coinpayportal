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
const CHANNEL_ACK = 'coinpay:page-ack';

/**
 * How long to wait for the content script to acknowledge a request.
 *
 * This provider object lives in the page's world, so it outlives the content
 * script that injected it: installing, updating or reloading the extension
 * orphans the content script in tabs that are already open, while
 * `window.coinpay` stays put. Every call then posts into the void. Without this
 * timeout the promise simply never settles — a site sits on "waiting for your
 * wallet" forever with no error to show, which is indistinguishable from the
 * user being slow to approve.
 *
 * It bounds only the acknowledgement. Once the content script answers, the
 * request runs untimed, because a legitimate `payBatch` can take many minutes.
 */
const ACK_TIMEOUT_MS = 3000;

const RELOAD_HINT =
  'The CoinPay extension is not responding. This usually means it was updated or reloaded while this page was open — reload the page and try again.';

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

type Pending = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  ackTimer?: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, Pending>();
const progressListeners = new Set<(progress: CoinPayProgress) => void>();
let counter = 0;

/** Stop waiting for an acknowledgement — it arrived, or the request is over. */
function clearAck(entry: Pending): void {
  if (entry.ackTimer === undefined) return;
  clearTimeout(entry.ackTimer);
  entry.ackTimer = undefined;
}

function send<T>(payload: Record<string, unknown>): Promise<T> {
  const requestId = `cp-${Date.now()}-${++counter}`;
  return new Promise<T>((resolve, reject) => {
    const entry: Pending = { resolve, reject };
    entry.ackTimer = setTimeout(() => {
      // Nothing on the other end. Fail loudly rather than hanging forever.
      if (!pending.delete(requestId)) return;
      reject(new Error(RELOAD_HINT));
    }, ACK_TIMEOUT_MS);
    pending.set(requestId, entry);
    window.postMessage({ channel: CHANNEL_REQUEST, requestId, payload }, window.location.origin);
  });
}

window.addEventListener('message', (event: MessageEvent) => {
  // Only trust messages this window posted to itself (i.e. from our own content
  // script), never anything arriving from a frame or another origin.
  if (event.source !== window) return;
  const data = event.data as Record<string, any> | null;
  if (!data) return;

  // The content script is alive and has taken the request. Everything past
  // this point is the user's own pace, so stop timing it.
  if (data.channel === CHANNEL_ACK) {
    const entry = pending.get(data.requestId);
    if (entry) clearAck(entry);
    return;
  }

  if (data.channel === CHANNEL_RESPONSE) {
    const entry = pending.get(data.requestId);
    if (!entry) return;
    clearAck(entry);
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
    options: {
      onProgress?: (progress: CoinPayProgress) => void;
      /**
       * Which of the wallet's addresses funds the run. A wallet can hold
       * several per chain, and without this the batch always spent the first —
       * so a site had no way to pay from the account that actually holds the
       * money. Omit to keep that first-address default.
       */
      from?: string;
    } = {},
  ): Promise<{ results: CoinPayPaymentResult[] }> {
    if (options.onProgress) progressListeners.add(options.onProgress);
    try {
      return await send({ type: 'site:payBatch', payments, from: options.from });
    } finally {
      if (options.onProgress) progressListeners.delete(options.onProgress);
    }
  },

  /**
   * Pay an x402 invoice and return the `X-PAYMENT` header to retry with.
   *
   * Takes the body of a `402 Payment Required` response and returns a base64
   * header value; the caller sets it on `X-PAYMENT` and repeats the request.
   * Rejects if the user declines or if none of the offered options is one this
   * wallet can sign.
   *
   * Nothing is broadcast and no gas is spent. The `exact` scheme is an EIP-3009
   * authorization — the signature IS the payment, and the facilitator submits
   * it — so this works with an account holding no native currency.
   *
   * @example
   *   const res = await fetch(url);
   *   if (res.status === 402) {
   *     const header = await window.coinpay.payX402(await res.json());
   *     return fetch(url, { headers: { 'X-PAYMENT': header } });
   *   }
   */
  payX402(paymentRequired: unknown, options: { from?: string } = {}): Promise<string> {
    return send({ type: 'site:payX402', paymentRequired, from: options.from });
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
