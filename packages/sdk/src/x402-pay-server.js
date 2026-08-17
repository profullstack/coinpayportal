/**
 * A one-shot local payment page, for paying an x402 invoice from the CLI.
 *
 * A terminal cannot sign with a browser wallet: the extension lives in the
 * browser process and exposes itself only to pages. So the CLI serves a page on
 * loopback, opens it, and waits. The page signs with CoinPay Wallet (or
 * MetaMask, or anything else injected), posts the `X-PAYMENT` header back, and
 * the CLI retries the original request with it.
 *
 * Security posture, because this is a local server that can spend money:
 *   * bound to 127.0.0.1, never a routable interface
 *   * every request must carry a single-use token from the URL, so another
 *     process on the box cannot drive it or read the invoice
 *   * one payment, then the server closes — it is not a standing service
 *   * the private key never comes near this process; it stays in the wallet
 *
 * @module x402-pay-server
 */

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/** SDK modules the page imports. Served from disk so the page can `import` them. */
const MODULES = {
  '/x402-browser.js': join(HERE, 'x402-browser.js'),
  '/x402-v2.js': join(HERE, 'x402-v2.js'),
};

function renderPage() {
  // Kept dependency-free and inline: this page is served from a temporary
  // loopback server, so anything external would simply fail to load.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CoinPay — Approve payment</title>
<style>
  :root { color-scheme: light dark; --bg:#faf9f7; --fg:#1a1a1a; --muted:#6b6b6b; --card:#fff; --line:#e6e3de; --accent:#2f6f4f; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#141414; --fg:#f2f2f2; --muted:#9a9a9a; --card:#1e1e1e; --line:#333; --accent:#5ea37a; }
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px;
         background:var(--bg); color:var(--fg);
         font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
  .card { width:100%; max-width:420px; background:var(--card); border:1px solid var(--line);
          border-radius:14px; padding:28px; }
  h1 { margin:0 0 4px; font-size:19px; }
  .sub { color:var(--muted); font-size:14px; margin:0 0 20px; }
  dl { display:grid; grid-template-columns:auto 1fr; gap:10px 16px; margin:0 0 22px;
       padding:16px 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line); }
  dt { color:var(--muted); font-size:14px; }
  dd { margin:0; text-align:right; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
  .amount { font-size:22px; font-weight:600; }
  button { width:100%; padding:13px; font-size:15px; font-weight:600; border:0; border-radius:9px;
           background:var(--accent); color:#fff; cursor:pointer; }
  button:disabled { opacity:.55; cursor:default; }
  .status { margin-top:16px; font-size:14px; color:var(--muted); min-height:1.5em; text-align:center; overflow-wrap:anywhere; }
  .status.error { color:#b3261e; }
  @media (prefers-color-scheme: dark) { .status.error { color:#f2b8b5; } }
  .status.ok { color:var(--accent); }
  code { font:13px ui-monospace,SFMono-Regular,Menlo,monospace; }
</style>
</head>
<body>
  <main class="card">
    <h1>Approve payment</h1>
    <p class="sub" id="resource"></p>
    <dl>
      <dt>Amount</dt><dd class="amount" id="amount">—</dd>
      <dt>Network</dt><dd id="network">—</dd>
      <dt>To</dt><dd><code id="payTo">—</code></dd>
      <dt>Wallet</dt><dd id="wallet">looking…</dd>
    </dl>
    <button id="pay" disabled>Pay</button>
    <p class="status" id="status"></p>
  </main>

<script type="module">
import { fetchWithX402, createPaymentHeader, selectWallet } from './x402-browser.js';
import { requiredAmount, evmChainId, selectAcceptEntry, toCaip2 } from './x402-v2.js';

const token = new URLSearchParams(location.search).get('t') ?? '';
const $ = (id) => document.getElementById(id);

const setStatus = (text, kind = '') => {
  $('status').textContent = text;
  $('status').className = 'status ' + kind;
};

const CHAIN_NAMES = { 1: 'Ethereum', 137: 'Polygon', 8453: 'Base' };

function scaled(raw, decimals = 6) {
  const value = BigInt(raw);
  const div = 10n ** BigInt(decimals);
  const whole = value / div;
  const frac = (value % div).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? \`\${whole}.\${frac}\` : String(whole);
}

let invoice;

async function init() {
  const res = await fetch(\`/invoice?t=\${token}\`);
  if (!res.ok) return setStatus('This payment link is no longer valid.', 'error');

  const data = await res.json();
  invoice = data.paymentRequired;
  $('resource').textContent = data.resourceUrl;

  // Show the option a browser wallet would actually take.
  const evm = (invoice.accepts ?? [])
    .map((a) => a.network)
    .filter((n) => evmChainId(n) !== null);
  const entry = selectAcceptEntry(invoice.accepts ?? [], evm) ?? invoice.accepts?.[0];

  if (entry) {
    $('amount').textContent = \`\${scaled(requiredAmount(entry))} \${entry.extra?.name ?? ''}\`.trim();
    $('network').textContent = CHAIN_NAMES[evmChainId(entry.network)] ?? toCaip2(entry.network);
    $('payTo').textContent = entry.payTo ?? '—';
  }

  const wallet = await selectWallet();
  if (!wallet) {
    $('wallet').textContent = 'none found';
    return setStatus('No wallet found. Install CoinPay Wallet or MetaMask, then reload.', 'error');
  }
  $('wallet').textContent = wallet.name;
  $('pay').disabled = false;
  setStatus('');
}

$('pay').addEventListener('click', async () => {
  $('pay').disabled = true;
  setStatus('Waiting for your wallet…');
  try {
    const { header, wallet } = await createPaymentHeader(invoice);
    setStatus('Signed. Handing back to the terminal…');
    await fetch(\`/payment?t=\${token}\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ header, wallet: wallet?.name }),
    });
    setStatus('Paid. You can close this tab.', 'ok');
  } catch (err) {
    $('pay').disabled = false;
    setStatus(err?.message ?? String(err), 'error');
  }
});

init().catch((err) => setStatus(err?.message ?? String(err), 'error'));
</script>
</body>
</html>`;
}

/**
 * Serve a one-shot payment page.
 *
 * @param {object} options
 * @param {object} options.paymentRequired  parsed body of the 402 response
 * @param {string} options.resourceUrl      what is being bought, for display
 * @param {number} [options.port=0]         0 lets the OS pick a free port
 * @returns {Promise<{url: string, waitForPayment: () => Promise<string>, close: () => Promise<void>}>}
 */
export async function startPaymentServer({ paymentRequired, resourceUrl, port = 0 }) {
  // A single-use token, so another local process cannot read the invoice or
  // post a payment into this session.
  const token = randomBytes(24).toString('hex');

  let resolvePayment;
  let rejectPayment;
  const payment = new Promise((resolve, reject) => {
    resolvePayment = resolve;
    rejectPayment = reject;
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, {
        'Content-Type': type,
        // The page must not be embeddable or reachable cross-origin: it can
        // authorise a payment.
        'X-Frame-Options': 'DENY',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    };

    if (url.pathname === '/' && req.method === 'GET') {
      // The token is checked on the data routes rather than here, so a
      // mistyped link shows the page and a clear error instead of a bare 403.
      return send(200, renderPage(), 'text/html; charset=utf-8');
    }

    const modulePath = MODULES[url.pathname];
    if (modulePath && req.method === 'GET') {
      try {
        const source = await readFile(modulePath, 'utf-8');
        return send(200, source, 'text/javascript; charset=utf-8');
      } catch {
        return send(404, 'not found');
      }
    }

    if (url.searchParams.get('t') !== token) {
      return send(403, 'forbidden');
    }

    if (url.pathname === '/invoice' && req.method === 'GET') {
      return send(200, JSON.stringify({ paymentRequired, resourceUrl }), 'application/json');
    }

    if (url.pathname === '/payment' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        // A payment header is a few hundred bytes; anything larger is not one.
        if (body.length > 64_000) req.destroy();
      });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (!parsed.header) throw new Error('No payment header supplied');
          send(200, JSON.stringify({ ok: true }), 'application/json');
          resolvePayment(parsed.header);
        } catch (err) {
          send(400, JSON.stringify({ error: err.message }), 'application/json');
        }
      });
      return;
    }

    return send(404, 'not found');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    // Loopback only. Binding 0.0.0.0 would expose a pay-me button to the LAN.
    server.listen(port, '127.0.0.1', resolve);
  });

  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/?t=${token}`;

  const close = () =>
    new Promise((resolve) => {
      server.close(() => resolve());
      // Don't hold the process open on a browser tab that stayed connected.
      server.closeAllConnections?.();
    });

  return {
    url,
    waitForPayment: (timeoutMs = 5 * 60 * 1000) => {
      const timer = setTimeout(
        () => rejectPayment(new Error('Timed out waiting for approval in the browser')),
        timeoutMs,
      );
      return payment.finally(() => clearTimeout(timer));
    },
    close,
  };
}
