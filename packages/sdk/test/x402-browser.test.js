// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  discoverEvmWallets,
  hasCoinPayWallet,
  hasOutdatedCoinPayWallet,
  selectWallet,
  signExactEvm,
  createPaymentHeader,
  fetchWithX402,
} from '../src/x402-browser.js';
import { decodePaymentHeader } from '../src/x402-v2.js';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PAYER = '0x9dBA414637c611a16BEa6f0796BFcbcBdc410df8';
const PAYEE = '0x1111111111111111111111111111111111111111';

/** An `accepts` entry shaped exactly like live discovery data. */
function baseEntry(overrides = {}) {
  return {
    scheme: 'exact',
    network: 'eip155:8453',
    amount: '6000',
    asset: USDC_BASE,
    payTo: PAYEE,
    maxTimeoutSeconds: 300,
    extra: { name: 'USD Coin', version: '2' },
    ...overrides,
  };
}

/** A minimal EIP-1193 provider that records what it was asked to do. */
function fakeEvmProvider({ chainId = '0x2105', accounts = [PAYER] } = {}) {
  const calls = [];
  return {
    calls,
    isMetaMask: true,
    async request({ method, params }) {
      calls.push({ method, params });
      switch (method) {
        case 'eth_requestAccounts':
          return accounts;
        case 'eth_chainId':
          return chainId;
        case 'wallet_switchEthereumChain':
          chainId = params[0].chainId;
          return null;
        case 'eth_signTypedData_v4':
          return '0xsignature';
        default:
          throw new Error(`unexpected method ${method}`);
      }
    },
  };
}

function announceWallet({ uuid, name, rdns, provider }) {
  const handler = () => {
    window.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', {
        detail: { info: { uuid, name, rdns, icon: 'data:,' }, provider },
      }),
    );
  };
  window.addEventListener('eip6963:requestProvider', handler);
  return () => window.removeEventListener('eip6963:requestProvider', handler);
}

beforeEach(() => {
  delete window.coinpay;
  delete window.ethereum;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('wallet discovery', () => {
  it('enumerates EIP-6963 wallets', async () => {
    const cleanup = announceWallet({
      uuid: 'u1',
      name: 'MetaMask',
      rdns: 'io.metamask',
      provider: fakeEvmProvider(),
    });

    const wallets = await discoverEvmWallets({ timeoutMs: 10 });
    cleanup();

    expect(wallets).toHaveLength(1);
    expect(wallets[0]).toMatchObject({ id: 'io.metamask', name: 'MetaMask' });
  });

  it('enumerates several wallets rather than whichever won window.ethereum', async () => {
    const a = announceWallet({ uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask', provider: fakeEvmProvider() });
    const b = announceWallet({ uuid: 'u2', name: 'Phantom', rdns: 'app.phantom', provider: fakeEvmProvider() });

    const wallets = await discoverEvmWallets({ timeoutMs: 10 });
    a();
    b();

    expect(wallets.map((w) => w.id).sort()).toEqual(['app.phantom', 'io.metamask']);
  });

  it('falls back to window.ethereum when nothing announces', async () => {
    window.ethereum = fakeEvmProvider();
    const wallets = await discoverEvmWallets({ timeoutMs: 10 });

    expect(wallets).toHaveLength(1);
    expect(wallets[0].name).toBe('MetaMask');
  });

  it('does not double-list a wallet that announced AND set window.ethereum', async () => {
    const provider = fakeEvmProvider();
    window.ethereum = provider;
    const cleanup = announceWallet({ uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask', provider });

    const wallets = await discoverEvmWallets({ timeoutMs: 10 });
    cleanup();

    expect(wallets).toHaveLength(1);
  });

  it('reports no wallets when the page has none', async () => {
    expect(await discoverEvmWallets({ timeoutMs: 10 })).toEqual([]);
  });
});

describe('wallet selection', () => {
  it('detects CoinPay Wallet', () => {
    expect(hasCoinPayWallet()).toBe(false);
    window.coinpay = { isCoinPay: true, payX402: () => {} };
    expect(hasCoinPayWallet()).toBe(true);
  });

  it('does not count a CoinPay Wallet too old to pay x402', () => {
    window.coinpay = { isCoinPay: true }; // no payX402
    expect(hasCoinPayWallet()).toBe(false);
    expect(hasOutdatedCoinPayWallet()).toBe(true);
  });

  it('prefers CoinPay Wallet when installed', async () => {
    window.coinpay = { isCoinPay: true, payX402: () => {} };
    window.ethereum = fakeEvmProvider();

    expect(await selectWallet()).toMatchObject({ kind: 'coinpay', name: 'CoinPay Wallet' });
  });

  it('falls back to MetaMask when CoinPay Wallet is too old to pay', async () => {
    window.coinpay = { isCoinPay: true }; // no payX402
    window.ethereum = fakeEvmProvider();

    expect(await selectWallet()).toMatchObject({ kind: 'evm', name: 'MetaMask' });
  });

  it('falls back to an injected EVM wallet when CoinPay is absent', async () => {
    window.ethereum = fakeEvmProvider();
    expect(await selectWallet()).toMatchObject({ kind: 'evm', name: 'MetaMask' });
  });

  it('honours an explicit wallet choice over the CoinPay default', async () => {
    window.coinpay = { isCoinPay: true };
    const cleanup = announceWallet({ uuid: 'u1', name: 'Phantom', rdns: 'app.phantom', provider: fakeEvmProvider() });

    const wallet = await selectWallet({ preferWalletId: 'app.phantom' });
    cleanup();

    expect(wallet).toMatchObject({ kind: 'evm', name: 'Phantom' });
  });

  it('returns null when the page has no wallet at all', async () => {
    expect(await selectWallet()).toBeNull();
  });
});

describe('signing an EIP-3009 authorization', () => {
  it('signs the token domain, not a bespoke x402 domain', async () => {
    const provider = fakeEvmProvider();
    await signExactEvm(provider, baseEntry());

    const sign = provider.calls.find((c) => c.method === 'eth_signTypedData_v4');
    const typedData = JSON.parse(sign.params[1]);

    expect(typedData.primaryType).toBe('TransferWithAuthorization');
    expect(typedData.domain).toEqual({
      name: 'USD Coin',
      version: '2',
      chainId: 8453,
      verifyingContract: USDC_BASE,
    });
    expect(typedData.domain.name).not.toBe('x402');
  });

  it('signs the amount and payee the entry asks for', async () => {
    const provider = fakeEvmProvider();
    const { authorization } = await signExactEvm(provider, baseEntry());

    expect(authorization.to).toBe(PAYEE);
    expect(authorization.value).toBe('6000');
    expect(authorization.from).toBe(PAYER);
  });

  it('switches the wallet to the required chain before signing', async () => {
    // Wallet starts on Ethereum mainnet; entry wants Base.
    const provider = fakeEvmProvider({ chainId: '0x1' });
    await signExactEvm(provider, baseEntry());

    const methods = provider.calls.map((c) => c.method);
    expect(methods).toContain('wallet_switchEthereumChain');
    // The switch must precede the signature, or the domain's chainId and the
    // wallet's active chain disagree and the signature verifies against neither.
    expect(methods.indexOf('wallet_switchEthereumChain')).toBeLessThan(
      methods.indexOf('eth_signTypedData_v4'),
    );
  });

  it('does not switch when already on the right chain', async () => {
    const provider = fakeEvmProvider({ chainId: '0x2105' });
    await signExactEvm(provider, baseEntry());

    expect(provider.calls.map((c) => c.method)).not.toContain('wallet_switchEthereumChain');
  });

  it('explains an unconfigured chain rather than guessing an RPC URL', async () => {
    const provider = fakeEvmProvider({ chainId: '0x1' });
    provider.request = async ({ method }) => {
      if (method === 'eth_requestAccounts') return [PAYER];
      if (method === 'eth_chainId') return '0x1';
      if (method === 'wallet_switchEthereumChain') throw Object.assign(new Error('nope'), { code: 4902 });
      throw new Error('unexpected');
    };

    await expect(signExactEvm(provider, baseEntry())).rejects.toThrow(/does not have chain 8453/i);
  });

  it('refuses an entry missing the token domain metadata', async () => {
    const provider = fakeEvmProvider();
    await expect(signExactEvm(provider, baseEntry({ extra: {} }))).rejects.toThrow(/name and version/i);
  });
});

describe('createPaymentHeader', () => {
  it('produces a decodable v2 payment for an EVM wallet', async () => {
    window.ethereum = fakeEvmProvider();

    const { header, wallet } = await createPaymentHeader({ x402Version: 2, accepts: [baseEntry()] });
    const payment = decodePaymentHeader(header);

    expect(wallet.name).toBe('MetaMask');
    expect(payment.x402Version).toBe(2);
    expect(payment.network).toBe('eip155:8453');
    expect(payment.scheme).toBe('exact');
    expect(payment.payload.signature).toBe('0xsignature');
    expect(payment.payload.authorization.value).toBe('6000');
  });

  it('delegates to CoinPay Wallet when it is installed', async () => {
    const payX402 = vi.fn().mockResolvedValue('coinpay-header');
    window.coinpay = { isCoinPay: true, payX402 };

    const paymentRequired = { x402Version: 2, accepts: [baseEntry()] };
    const { header } = await createPaymentHeader(paymentRequired);

    expect(header).toBe('coinpay-header');
    // The extension chooses among the options itself — it knows which chains
    // hold funds, which the page does not.
    expect(payX402).toHaveBeenCalledWith(paymentRequired);
  });

  it('skips options an EVM wallet cannot pay', async () => {
    window.ethereum = fakeEvmProvider();

    const { header } = await createPaymentHeader({
      x402Version: 2,
      accepts: [baseEntry({ network: 'bitcoin', asset: 'BTC' }), baseEntry()],
    });

    expect(decodePaymentHeader(header).network).toBe('eip155:8453');
  });

  it('names CoinPay Wallet when no offered option is EVM-payable', async () => {
    window.ethereum = fakeEvmProvider();

    await expect(
      createPaymentHeader({ x402Version: 2, accepts: [baseEntry({ network: 'bitcoin', asset: 'BTC' })] }),
    ).rejects.toThrow(/CoinPay Wallet supports Bitcoin/i);
  });

  it('tells the visitor to install a wallet when there is none', async () => {
    await expect(createPaymentHeader({ x402Version: 2, accepts: [baseEntry()] })).rejects.toThrow(
      /Install CoinPay Wallet, MetaMask/i,
    );
  });

  it('rejects a 402 body with no options', async () => {
    await expect(createPaymentHeader({ x402Version: 2, accepts: [] })).rejects.toThrow(/no `accepts`/i);
  });
});

describe('fetchWithX402', () => {
  it('passes a non-402 response straight through without touching a wallet', async () => {
    const ok = new Response('hi', { status: 200 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok));

    expect(await fetchWithX402('https://api.example.com/x')).toBe(ok);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('pays and retries once with the X-PAYMENT header', async () => {
    window.ethereum = fakeEvmProvider();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ x402Version: 2, accepts: [baseEntry()] }), { status: 402 }),
      )
      .mockResolvedValueOnce(new Response('paid', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWithX402('https://api.example.com/premium');

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const retryHeaders = new Headers(fetchMock.mock.calls[1][1].headers);
    expect(decodePaymentHeader(retryHeaders.get('X-PAYMENT')).network).toBe('eip155:8453');
  });

  it('preserves the caller\'s own headers on the paid retry', async () => {
    window.ethereum = fakeEvmProvider();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ x402Version: 2, accepts: [baseEntry()] }), { status: 402 }),
      )
      .mockResolvedValueOnce(new Response('paid', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchWithX402('https://api.example.com/premium', {
      headers: { Accept: 'application/json' },
    });

    const retryHeaders = new Headers(fetchMock.mock.calls[1][1].headers);
    expect(retryHeaders.get('Accept')).toBe('application/json');
  });

  it('does NOT pay a second time when the paid retry is refused', async () => {
    window.ethereum = fakeEvmProvider();

    const body = JSON.stringify({ x402Version: 2, accepts: [baseEntry()] });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(body, { status: 402 }))
      .mockResolvedValueOnce(new Response(body, { status: 402 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchWithX402('https://api.example.com/premium')).rejects.toThrow(/double-paying/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a 402 whose body is not x402 JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 402 })));

    await expect(fetchWithX402('https://api.example.com/premium')).rejects.toThrow(/not valid x402 JSON/i);
  });
});
