/**
 * Content script — the only path between a web page and the wallet.
 *
 * It runs in an isolated world with access to `chrome.runtime`, and does two
 * things:
 *   1. Injects `inpage/provider.js` into the page so `window.coinpay` exists.
 *   2. Relays page requests to the background worker and pushes progress events
 *      back down.
 *
 * It is deliberately a dumb pipe: it makes no authorization decisions and adds
 * no origin claims of its own. The background reads the true origin from
 * `sender`, so a page cannot lie about who it is by talking to this script.
 */

const CHANNEL_REQUEST = 'coinpay:page-request';
const CHANNEL_RESPONSE = 'coinpay:page-response';
const CHANNEL_EVENT = 'coinpay:page-event';

function injectProvider(): void {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('inpage/provider.js');
  script.type = 'module';
  // Inject as early as possible so `window.coinpay` is there before app code.
  (document.head || document.documentElement).prepend(script);
  script.addEventListener('load', () => script.remove());
}

injectProvider();

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;
  const data = event.data as Record<string, any> | null;
  if (!data || data.channel !== CHANNEL_REQUEST) return;

  const { requestId, payload } = data;
  if (typeof requestId !== 'string' || !payload || typeof payload.type !== 'string') return;
  // Only the page-facing surface is reachable from here; popup and approval
  // messages must never be invocable by a web page.
  if (!payload.type.startsWith('site:')) return;

  const reply = (result: unknown, error?: string): void => {
    window.postMessage(
      { channel: CHANNEL_RESPONSE, requestId, result, error },
      window.location.origin,
    );
  };

  chrome.runtime
    .sendMessage(payload)
    .then((response: any) => {
      if (!response) return reply(undefined, 'No response from the CoinPay extension');
      if (response.ok === false) return reply(undefined, response.error || 'Request failed');
      // Strip the transport envelope; hand the page just the payload fields.
      const { ok, ...rest } = response;
      void ok;
      reply(rest);
    })
    .catch((err: unknown) => {
      reply(undefined, err instanceof Error ? err.message : 'Extension unavailable');
    });
});

chrome.runtime.onMessage.addListener((message: any) => {
  if (message?.type !== 'coinpay:progress') return;
  window.postMessage({ channel: CHANNEL_EVENT, event: message }, window.location.origin);
});
