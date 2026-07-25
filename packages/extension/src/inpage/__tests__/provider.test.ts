/**
 * @vitest-environment jsdom
 *
 * `window.coinpay` is the API integrators code against, so its contract has to
 * hold: requests correlate to their own responses, rejections surface as thrown
 * errors, progress reaches subscribers, and the object cannot be tampered with
 * by other page scripts.
 *
 * The provider installs itself once per window with `configurable: false` (so a
 * page script cannot swap in a look-alike that redirects payments). That is
 * exactly why this file imports it ONCE and shares it across tests — a
 * per-test reload would be impossible, which is the property being defended.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

const CHANNEL_REQUEST = 'coinpay:page-request';
const CHANNEL_RESPONSE = 'coinpay:page-response';
const CHANNEL_EVENT = 'coinpay:page-event';

let posted: any[] = [];
let coinpay: any;
let sawInitEvent = false;

beforeAll(async () => {
  // Must be listening before the module evaluates to catch its ready signal.
  window.addEventListener('coinpay#initialized', () => {
    sawInitEvent = true;
  });
  vi.spyOn(window, 'postMessage').mockImplementation((message: any) => {
    posted.push(message);
  });

  await import('../provider.js');
  coinpay = (window as any).coinpay;
});

afterAll(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  posted = [];
});

/** Answer the most recent outbound request as the content script would. */
function respond(result: unknown, error?: string): void {
  respondTo(posted.at(-1).requestId, result, error);
}

function respondTo(requestId: string, result: unknown, error?: string): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { channel: CHANNEL_RESPONSE, requestId, result, error },
      source: window,
    }),
  );
}

function emitProgress(progress: unknown): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { channel: CHANNEL_EVENT, event: { type: 'coinpay:progress', progress } },
      source: window,
    }),
  );
}

describe('provider surface', () => {
  it('advertises itself so pages can feature-detect', () => {
    expect(coinpay.isCoinPay).toBe(true);
    expect(typeof coinpay.version).toBe('string');
  });

  it('announces readiness for pages that loaded before the extension', () => {
    expect(sawInitEvent).toBe(true);
  });

  it('is frozen and non-configurable so page scripts cannot swap it out', () => {
    // A replaceable provider could silently redirect every payment.
    expect(Object.isFrozen(coinpay)).toBe(true);
    expect(() => {
      (window as any).coinpay = { isCoinPay: true, payBatch: () => {} };
    }).toThrow();
    expect(() => delete (window as any).coinpay).toThrow();
    expect((window as any).coinpay).toBe(coinpay);
  });

  it('cannot have its methods replaced', () => {
    expect(() => {
      coinpay.payBatch = () => Promise.resolve({ results: [] });
    }).toThrow();
  });
});

describe('request/response', () => {
  it('sends a typed request on the page-request channel', async () => {
    const promise = coinpay.getState();

    expect(posted.at(-1)).toMatchObject({
      channel: CHANNEL_REQUEST,
      payload: { type: 'site:getState' },
    });
    expect(typeof posted.at(-1).requestId).toBe('string');

    respond({});
    await promise;
  });

  it('resolves with the relayed result', async () => {
    const promise = coinpay.connect();
    respond({ accounts: [{ chain: 'ETH', address: '0xabc', tokens: ['USDC'] }] });

    await expect(promise).resolves.toEqual({
      accounts: [{ chain: 'ETH', address: '0xabc', tokens: ['USDC'] }],
    });
  });

  it('rejects with the relayed error', async () => {
    const promise = coinpay.connect();
    respond(undefined, 'Connection rejected');

    await expect(promise).rejects.toThrow('Connection rejected');
  });

  it('correlates concurrent requests to their own responses', async () => {
    const first = coinpay.getState();
    const firstId = posted.at(-1).requestId;
    const second = coinpay.getAccounts();
    const secondId = posted.at(-1).requestId;

    expect(firstId).not.toBe(secondId);

    // Answer out of order — a mix-up would resolve the wrong promise.
    respondTo(secondId, { accounts: [] });
    respondTo(firstId, { connected: true });

    await expect(second).resolves.toEqual({ accounts: [] });
    await expect(first).resolves.toEqual({ connected: true });
  });

  it('ignores responses from another window', async () => {
    const promise = coinpay.getState();
    const requestId = posted.at(-1).requestId;
    const settled = vi.fn();
    promise.then(settled, settled);

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { channel: CHANNEL_RESPONSE, requestId, result: {} },
        source: null, // not this window
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(settled).not.toHaveBeenCalled();
    respondTo(requestId, {}); // clean up the pending promise
    await promise;
  });

  it('ignores an unknown requestId without crashing', () => {
    expect(() => respondTo('never-sent', {})).not.toThrow();
  });

  it('ignores malformed and unrelated messages', () => {
    expect(() => {
      window.dispatchEvent(new MessageEvent('message', { data: null, source: window }));
      window.dispatchEvent(
        new MessageEvent('message', { data: { channel: 'other' }, source: window }),
      );
    }).not.toThrow();
  });
});

describe('payBatch', () => {
  const payments = [{ id: 'inv-1', chain: 'usdc_pol', to: '0xabc', amount: '10' }];

  it('sends the payments through and resolves with per-item results', async () => {
    const promise = coinpay.payBatch(payments);

    expect(posted.at(-1).payload).toEqual({ type: 'site:payBatch', payments });

    respond({ results: [{ id: 'inv-1', status: 'sent', txHash: '0xhash' }] });
    await expect(promise).resolves.toEqual({
      results: [{ id: 'inv-1', status: 'sent', txHash: '0xhash' }],
    });
  });

  it('resolves — not rejects — when some payments failed', async () => {
    // Partial success is the documented contract; rejecting here would make
    // callers discard the successful transactions.
    const promise = coinpay.payBatch(payments);
    respond({
      results: [
        { id: 'inv-1', status: 'sent', txHash: '0x1' },
        { id: 'inv-2', status: 'failed', error: 'Insufficient funds' },
      ],
    });

    const { results } = await promise;
    expect(results.map((r: any) => r.status)).toEqual(['sent', 'failed']);
  });

  it('delivers progress to the onProgress callback', async () => {
    const onProgress = vi.fn();
    const promise = coinpay.payBatch(payments, { onProgress });

    emitProgress({ id: 'inv-1', stage: 'broadcasting', completed: 0, total: 1 });
    emitProgress({ id: 'inv-1', stage: 'sent', completed: 1, total: 1 });

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ stage: 'sent', completed: 1 }),
    );

    respond({ results: [] });
    await promise;
  });

  it('unsubscribes onProgress once the batch settles', async () => {
    const onProgress = vi.fn();
    const promise = coinpay.payBatch(payments, { onProgress });
    respond({ results: [] });
    await promise;
    onProgress.mockClear();

    emitProgress({ id: 'inv-1', stage: 'sent', completed: 1, total: 1 });
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('unsubscribes onProgress even when the batch is rejected', async () => {
    const onProgress = vi.fn();
    const promise = coinpay.payBatch(payments, { onProgress });
    respond(undefined, 'Payment request rejected');
    await expect(promise).rejects.toThrow();
    onProgress.mockClear();

    emitProgress({ id: 'inv-1', stage: 'sent', completed: 1, total: 1 });
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('does not let a throwing listener break delivery to the others', async () => {
    const good = vi.fn();
    const offBad = coinpay.onProgress(() => {
      throw new Error('page bug');
    });
    const offGood = coinpay.onProgress(good);

    expect(() => emitProgress({ id: 'inv-1', stage: 'sent', completed: 1, total: 1 })).not.toThrow();
    expect(good).toHaveBeenCalled();

    offBad();
    offGood();
  });
});

describe('onProgress subscription', () => {
  it('returns an unsubscribe function', () => {
    const listener = vi.fn();
    const off = coinpay.onProgress(listener);

    emitProgress({ id: 'a', stage: 'sent', completed: 1, total: 1 });
    expect(listener).toHaveBeenCalledTimes(1);

    off();
    emitProgress({ id: 'a', stage: 'sent', completed: 1, total: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
