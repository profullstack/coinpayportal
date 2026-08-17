/**
 * The local approval page the CLI opens.
 *
 * It is a server that can authorise spending money, so the cover here is as
 * much about what it refuses as about what it serves.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { startPaymentServer } from '../src/x402-pay-server.js';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const paymentRequired = {
  x402Version: 2,
  accepts: [
    {
      scheme: 'exact',
      network: 'eip155:8453',
      amount: '10000',
      asset: USDC_BASE,
      payTo: '0x1111111111111111111111111111111111111111',
      extra: { name: 'USD Coin', version: '2' },
    },
  ],
};

let servers = [];

async function start() {
  const server = await startPaymentServer({
    paymentRequired,
    resourceUrl: 'https://api.example.com/premium',
  });
  servers.push(server);
  return server;
}

/** The single-use token from the served URL. */
function tokenOf(server) {
  return new URL(server.url).searchParams.get('t');
}

function origin(server) {
  const url = new URL(server.url);
  return `http://${url.host}`;
}

afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

describe('binding and addressing', () => {
  it('binds loopback only, never a routable interface', async () => {
    const server = await start();
    // A pay-me button reachable from the LAN would be a different product.
    expect(new URL(server.url).hostname).toBe('127.0.0.1');
  });

  it('picks a free port by default', async () => {
    const server = await start();
    expect(Number(new URL(server.url).port)).toBeGreaterThan(0);
  });

  it('mints a distinct token per session', async () => {
    const a = await start();
    const b = await start();
    expect(tokenOf(a)).not.toBe(tokenOf(b));
    expect(tokenOf(a)).toMatch(/^[0-9a-f]{48}$/);
  });
});

describe('serving the page', () => {
  it('serves the approval page', async () => {
    const server = await start();
    const res = await fetch(server.url);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(html).toContain('Approve payment');
  });

  it('refuses to be framed, since it can authorise a payment', async () => {
    const server = await start();
    const res = await fetch(server.url);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('is never cached', async () => {
    const server = await start();
    const res = await fetch(server.url);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('serves the SDK modules the page imports', async () => {
    const server = await start();

    for (const path of ['/x402-browser.js', '/x402-v2.js']) {
      const res = await fetch(`${origin(server)}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/javascript/);
      expect(await res.text()).toContain('export');
    }
  });

  it('404s an unknown path', async () => {
    const server = await start();
    const res = await fetch(`${origin(server)}/nope?t=${tokenOf(server)}`);
    expect(res.status).toBe(404);
  });
});

describe('the single-use token', () => {
  it('serves the invoice to a request carrying it', async () => {
    const server = await start();
    const res = await fetch(`${origin(server)}/invoice?t=${tokenOf(server)}`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.paymentRequired).toEqual(paymentRequired);
    expect(body.resourceUrl).toBe('https://api.example.com/premium');
  });

  it('refuses the invoice without it, so other local processes cannot read it', async () => {
    const server = await start();
    expect((await fetch(`${origin(server)}/invoice`)).status).toBe(403);
    expect((await fetch(`${origin(server)}/invoice?t=wrong`)).status).toBe(403);
  });

  it('refuses a payment posted without it', async () => {
    const server = await start();
    const res = await fetch(`${origin(server)}/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ header: 'injected' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('receiving the payment', () => {
  it('resolves waitForPayment with the posted header', async () => {
    const server = await start();
    const pending = server.waitForPayment();

    const res = await fetch(`${origin(server)}/payment?t=${tokenOf(server)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ header: 'eyJ4NDAyVmVyc2lvbiI6Mn0=', wallet: 'CoinPay Wallet' }),
    });

    expect(res.status).toBe(200);
    await expect(pending).resolves.toBe('eyJ4NDAyVmVyc2lvbiI6Mn0=');
  });

  it('rejects a post with no header rather than resolving with nothing', async () => {
    const server = await start();
    const res = await fetch(`${origin(server)}/payment?t=${tokenOf(server)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'MetaMask' }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no payment header/i);
  });

  it('rejects a malformed body', async () => {
    const server = await start();
    const res = await fetch(`${origin(server)}/payment?t=${tokenOf(server)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('times out rather than waiting forever', async () => {
    const server = await start();
    await expect(server.waitForPayment(30)).rejects.toThrow(/timed out/i);
  });
});

describe('shutdown', () => {
  it('stops serving once closed', async () => {
    const server = await start();
    const url = server.url;
    await server.close();

    await expect(fetch(url)).rejects.toThrow();
  });
});
