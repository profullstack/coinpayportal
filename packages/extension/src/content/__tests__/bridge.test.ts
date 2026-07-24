/**
 * @vitest-environment jsdom
 *
 * The content script is the ONLY path between a web page and the wallet, so its
 * job is to be a dumb, tightly-scoped pipe. These tests pin down the two things
 * that make it safe:
 *
 *   1. It forwards only `site:` messages — a page must not be able to invoke
 *      popup or approval requests (e.g. `approval:approve`) by postMessage.
 *   2. It adds no origin claim of its own; the background reads the true origin
 *      from `sender`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const CHANNEL_REQUEST = 'coinpay:page-request';
const CHANNEL_RESPONSE = 'coinpay:page-response';
const CHANNEL_EVENT = 'coinpay:page-event';

const sendMessage = vi.fn();
const onMessageListeners: ((message: unknown) => void)[] = [];

/** Load bridge.ts fresh against the current jsdom window + chrome stub. */
async function loadBridge(): Promise<void> {
  vi.resetModules();
  onMessageListeners.length = 0;
  sendMessage.mockReset();
  sendMessage.mockResolvedValue({ ok: true, results: [] });

  vi.stubGlobal('chrome', {
    runtime: {
      getURL: (path: string) => `chrome-extension://test-id/${path}`,
      sendMessage,
      onMessage: {
        addListener: (listener: (message: unknown) => void) => onMessageListeners.push(listener),
      },
    },
  });

  await import('../bridge.js');
}

/** Post a page message and let the bridge's async relay settle. */
async function postFromPage(data: unknown): Promise<void> {
  window.dispatchEvent(new MessageEvent('message', { data, source: window }));
  await vi.waitFor(() => {});
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function capturePosts(): unknown[] {
  const posted: unknown[] = [];
  vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => {
    posted.push(message);
  });
  return posted;
}

beforeEach(async () => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  await loadBridge();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('provider injection', () => {
  it('injects the in-page provider as a module at document_start', () => {
    const script = document.querySelector('script');
    expect(script?.getAttribute('src')).toBe('chrome-extension://test-id/inpage/provider.js');
    expect(script?.getAttribute('type')).toBe('module');
  });
});

describe('page → background relay', () => {
  it('forwards a site: request and returns the unwrapped payload', async () => {
    const posted = capturePosts();
    sendMessage.mockResolvedValue({ ok: true, results: [{ id: 'inv-1', status: 'sent' }] });

    await postFromPage({
      channel: CHANNEL_REQUEST,
      requestId: 'r1',
      payload: { type: 'site:payBatch', payments: [] },
    });

    expect(sendMessage).toHaveBeenCalledWith({ type: 'site:payBatch', payments: [] });
    expect(posted).toContainEqual({
      channel: CHANNEL_RESPONSE,
      requestId: 'r1',
      result: { results: [{ id: 'inv-1', status: 'sent' }] }, // `ok` envelope stripped
      error: undefined,
    });
  });

  it.each([
    'approval:approve',
    'approval:reject',
    'unlock',
    'getAccounts',
    'import',
    'beginCreate',
  ])('refuses to relay a non-site request: %s', async (type) => {
    // A page reaching `approval:approve` could self-authorize its own batch.
    await postFromPage({ channel: CHANNEL_REQUEST, requestId: 'r1', payload: { type } });

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('ignores messages from another window (e.g. an iframe or opener)', async () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { channel: CHANNEL_REQUEST, requestId: 'r1', payload: { type: 'site:getState' } },
        source: null, // not this window
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('ignores messages on other channels and malformed payloads', async () => {
    await postFromPage({ channel: 'something-else', requestId: 'r1', payload: { type: 'site:x' } });
    await postFromPage({ channel: CHANNEL_REQUEST, requestId: 'r1' });
    await postFromPage({ channel: CHANNEL_REQUEST, requestId: 42, payload: { type: 'site:x' } });
    await postFromPage({ channel: CHANNEL_REQUEST, requestId: 'r1', payload: { type: 42 } });
    await postFromPage(null);

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('adds nothing of its own to the forwarded message', async () => {
    // Anything extra here would be a page-supplied claim the background might
    // trust; the origin must come from `sender` alone.
    await postFromPage({
      channel: CHANNEL_REQUEST,
      requestId: 'r1',
      payload: { type: 'site:connect', origin: 'https://evil.example' },
    });

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'site:connect',
      origin: 'https://evil.example', // relayed verbatim — and ignored downstream
    });
  });

  it('relays a rejection as an error, not a silent success', async () => {
    const posted = capturePosts();
    sendMessage.mockResolvedValue({ ok: false, error: 'Payment request rejected' });

    await postFromPage({
      channel: CHANNEL_REQUEST,
      requestId: 'r1',
      payload: { type: 'site:payBatch', payments: [] },
    });

    expect(posted).toContainEqual(
      expect.objectContaining({ requestId: 'r1', error: 'Payment request rejected' }),
    );
  });

  it('reports an unreachable background instead of hanging the page promise', async () => {
    const posted = capturePosts();
    sendMessage.mockRejectedValue(new Error('Extension context invalidated'));

    await postFromPage({
      channel: CHANNEL_REQUEST,
      requestId: 'r1',
      payload: { type: 'site:getState' },
    });

    expect(posted).toContainEqual(
      expect.objectContaining({ requestId: 'r1', error: 'Extension context invalidated' }),
    );
  });

  it('reports an empty response rather than resolving with undefined', async () => {
    const posted = capturePosts();
    sendMessage.mockResolvedValue(undefined);

    await postFromPage({
      channel: CHANNEL_REQUEST,
      requestId: 'r1',
      payload: { type: 'site:getState' },
    });

    expect(posted).toContainEqual(
      expect.objectContaining({ error: 'No response from the CoinPay extension' }),
    );
  });
});

describe('background → page events', () => {
  it('forwards progress events to the page', () => {
    const posted = capturePosts();
    const event = {
      type: 'coinpay:progress',
      requestId: 'r1',
      progress: { id: 'inv-1', stage: 'sent', completed: 1, total: 2 },
    };

    for (const listener of onMessageListeners) listener(event);

    expect(posted).toContainEqual({ channel: CHANNEL_EVENT, event });
  });

  it('does not forward unrelated runtime messages', () => {
    const posted = capturePosts();

    for (const listener of onMessageListeners) {
      listener({ type: 'coinpay:approvalResolved', requestId: 'r1' });
      listener({ type: 'somethingElse' });
      listener(null);
    }

    expect(posted).toHaveLength(0);
  });
});
