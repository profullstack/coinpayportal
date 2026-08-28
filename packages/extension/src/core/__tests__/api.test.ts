/**
 * API client contract tests.
 *
 * The auth signature format is not documented anywhere the extension can
 * import — it is whatever the portal's `verifySecp256k1Signature` accepts. This
 * file pins it down by verifying exactly the way the server does, so a noble
 * upgrade or a refactor that changes prehashing/encoding fails here instead of
 * as a 401 in production.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';

import { CoinPayApi, CoinPayApiError, signAuthMessage, compressedPublicKey } from '../api.js';

const PRIVATE_KEY = new Uint8Array(32).fill(7);

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Byte-for-byte what src/lib/web-wallet/auth.ts does to check a signature. */
function serverVerify(signatureHex: string, message: string, publicKeyHex: string): boolean {
  try {
    return secp256k1.verify(
      hexToBytes(signatureHex),
      new TextEncoder().encode(message),
      hexToBytes(publicKeyHex),
    );
  } catch {
    return false;
  }
}

describe('signAuthMessage', () => {
  it('produces a signature the portal verifier accepts', () => {
    const message = 'POST:/api/web-wallet/abc/prepare-tx:1700000000:{"amount":"1"}';
    const signature = signAuthMessage(message, PRIVATE_KEY);

    expect(serverVerify(signature, message, compressedPublicKey(PRIVATE_KEY))).toBe(true);
  });

  it('emits a 64-byte compact signature as hex', () => {
    // The server hex-decodes with no length negotiation; DER (70-72 bytes)
    // would be rejected.
    expect(signAuthMessage('hello', PRIVATE_KEY)).toMatch(/^[0-9a-f]{128}$/);
  });

  it('does not verify against a different message', () => {
    const signature = signAuthMessage('GET:/a:1:', PRIVATE_KEY);
    expect(serverVerify(signature, 'GET:/b:1:', compressedPublicKey(PRIVATE_KEY))).toBe(false);
  });

  it('does not verify against a different key', () => {
    const signature = signAuthMessage('GET:/a:1:', PRIVATE_KEY);
    const otherKey = new Uint8Array(32).fill(9);
    expect(serverVerify(signature, 'GET:/a:1:', compressedPublicKey(otherKey))).toBe(false);
  });
});

describe('compressedPublicKey', () => {
  it('is 33 bytes starting with 02 or 03, as the portal validates', () => {
    const hex = compressedPublicKey(PRIVATE_KEY);
    expect(hex).toMatch(/^0[23][0-9a-f]{64}$/);
  });
});

describe('CoinPayApi', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function ok(data: unknown) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data, error: null }),
    };
  }

  it('signs authenticated requests over the exact bytes it sends', async () => {
    fetchMock.mockResolvedValue(ok({ tx_id: 't1' }));
    const api = new CoinPayApi('https://coinpayportal.com/api');

    await api.prepareTx('wallet-1', PRIVATE_KEY, {
      from_address: '0xfrom',
      to_address: '0xto',
      chain: 'USDC_POL',
      amount: '10',
    });

    const [, init] = fetchMock.mock.calls[0]!;
    const auth: string = init.headers.Authorization;
    const [walletId, signature, timestamp, nonce] = auth.replace('Wallet ', '').split(':');

    expect(walletId).toBe('wallet-1');
    // The server rebuilds the message from METHOD, its own path, the timestamp,
    // the per-request nonce, and the raw body — reconstruct it the same way.
    const message = `POST:/api/web-wallet/wallet-1/prepare-tx:${timestamp}:${nonce}:${init.body}`;
    expect(serverVerify(signature!, message, compressedPublicKey(PRIVATE_KEY))).toBe(true);
  });

  it('sends a timestamp inside the portal 5-minute window', async () => {
    fetchMock.mockResolvedValue(ok({}));
    await new CoinPayApi().broadcast('w', PRIVATE_KEY, {
      tx_id: 't',
      signed_tx: '0x',
      chain: 'ETH',
    });

    const [, init] = fetchMock.mock.calls[0]!;
    const timestamp = Number(init.headers.Authorization.split(':')[2]);
    expect(Math.abs(Math.floor(Date.now() / 1000) - timestamp)).toBeLessThan(5);
  });

  it('does not attach auth to wallet registration', async () => {
    fetchMock.mockResolvedValue(ok({ wallet_id: 'w1' }));

    await new CoinPayApi().registerWallet({
      publicKeySecp256k1: compressedPublicKey(PRIVATE_KEY),
      addresses: [],
      privateKey: PRIVATE_KEY,
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    // Registration is the bootstrap — there is no wallet id to authenticate as.
    expect(url).toBe('https://coinpayportal.com/api/web-wallet/import');
    expect(init.headers.Authorization).toBeUndefined();

    const body = JSON.parse(init.body);
    expect(
      serverVerify(
        body.proof_of_ownership.signature,
        body.proof_of_ownership.message,
        compressedPublicKey(PRIVATE_KEY),
      ),
    ).toBe(true);
  });

  it('unwraps the portal success envelope', async () => {
    fetchMock.mockResolvedValue(ok({ tx_hash: '0xhash', status: 'pending' }));

    const result = await new CoinPayApi().broadcast('w', PRIVATE_KEY, {
      tx_id: 't',
      signed_tx: '0x',
      chain: 'ETH',
    });

    expect(result).toMatchObject({ tx_hash: '0xhash' });
  });

  it('surfaces the portal error code and message', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        success: false,
        data: null,
        error: { code: 'INSUFFICIENT_FUNDS', message: 'Insufficient funds: need 5000 sats' },
      }),
    });

    await expect(
      new CoinPayApi().prepareTx('w', PRIVATE_KEY, {
        from_address: 'a',
        to_address: 'b',
        chain: 'BTC',
        amount: '1',
      }),
    ).rejects.toMatchObject({
      name: 'CoinPayApiError',
      code: 'INSUFFICIENT_FUNDS',
      status: 400,
    });
  });

  it('reports a 200 body with success:false as an error', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: false, error: { code: 'NOPE', message: 'no' } }),
    });

    await expect(
      new CoinPayApi().broadcast('w', PRIVATE_KEY, { tx_id: 't', signed_tx: '0x', chain: 'ETH' }),
    ).rejects.toBeInstanceOf(CoinPayApiError);
  });

  it('wraps a network failure rather than leaking a raw TypeError', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(
      new CoinPayApi().broadcast('w', PRIVATE_KEY, { tx_id: 't', signed_tx: '0x', chain: 'ETH' }),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  // ── /rates ──────────────────────────────────────────────────────────────
  // Unlike the wallet routes this one answers flat (no `data` envelope) and
  // reports errors as a bare string, so it has its own request path.

  it('quotes a coin in a fiat currency without wallet auth', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, coin: 'BTC', rate: 61234.5, fiat: 'EUR' }),
    });

    const rate = await new CoinPayApi().getRate('BTC', 'EUR');

    expect(rate).toBe(61234.5);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://coinpayportal.com/api/rates?coin=BTC&fiat=EUR');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('passes a token chain through verbatim for the portal to resolve', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, coin: 'USDC_POL', rate: 1, fiat: 'USD' }),
    });

    await new CoinPayApi().getRate('USDC_POL', 'USD');
    expect(fetchMock.mock.calls[0]![0]).toContain('coin=USDC_POL');
  });

  it('rejects a null rate instead of quoting zero', async () => {
    // The route answers 200 with `rate: null` when the feed has no price —
    // treating that as 0 would price a payment at nothing.
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: false, coin: 'BTC', rate: null, error: 'upstream down' }),
    });

    await expect(new CoinPayApi().getRate('BTC', 'USD')).rejects.toMatchObject({
      name: 'CoinPayApiError',
      message: 'upstream down',
    });
  });

  it('surfaces the rate-limit response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ success: false, error: 'Rate limit exceeded. Please try again later.' }),
    });

    await expect(new CoinPayApi().getRate('BTC', 'USD')).rejects.toMatchObject({ status: 429 });
  });

  it('unwraps the balances envelope rather than reading data as an array', async () => {
    // The route answers `data: { balances: [...] }`. Treating `data` as the
    // array throws on the first .filter, which the popup shows as no balances.
    fetchMock.mockResolvedValue(
      ok({ balances: [{ chain: 'ETH', address: '0xabc', balance: '0.0113' }] }),
    );

    const balances = await new CoinPayApi().getBalances('w', PRIVATE_KEY);

    expect(Array.isArray(balances)).toBe(true);
    expect(balances[0]).toMatchObject({ chain: 'ETH', balance: '0.0113' });
  });

  it('returns an empty list when the wallet has no balances', async () => {
    fetchMock.mockResolvedValue(ok({ balances: [] }));
    await expect(new CoinPayApi().getBalances('w', PRIVATE_KEY)).resolves.toEqual([]);
  });

  it('authenticates the balances request', async () => {
    fetchMock.mockResolvedValue(ok({ balances: [] }));
    await new CoinPayApi().getBalances('wallet-9', PRIVATE_KEY);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://coinpayportal.com/api/web-wallet/wallet-9/balances');
    const auth: string = init.headers.Authorization;
    const [, signature, timestamp, nonce] = auth.replace('Wallet ', '').split(':');
    // Server rebuilds `METHOD:path:timestamp:nonce:` with an empty body for GET.
    const message = `GET:/api/web-wallet/wallet-9/balances:${timestamp}:${nonce}:`;
    expect(serverVerify(signature!, message, compressedPublicKey(PRIVATE_KEY))).toBe(true);
  });

  it('trims a trailing slash so signed paths stay canonical', async () => {
    fetchMock.mockResolvedValue(ok({}));
    await new CoinPayApi('https://coinpayportal.com/api/').broadcast('w', PRIVATE_KEY, {
      tx_id: 't',
      signed_tx: '0x',
      chain: 'ETH',
    });

    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://coinpayportal.com/api/web-wallet/w/broadcast',
    );
  });
});
