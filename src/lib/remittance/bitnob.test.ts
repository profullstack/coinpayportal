import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { BitnobProvider, parseQuote, signRequest, buildQuoteBody } from './bitnob';
import type { RemittanceQuoteParams } from './types';

global.fetch = vi.fn();

const params: RemittanceQuoteParams = {
  sendAsset: 'USDC',
  sendAmount: 500,
  destinationCountry: 'NG',
};

describe('signRequest', () => {
  // The scheme is `CLIENT_ID:TIMESTAMP:NONCE:PAYLOAD`, HMAC-SHA256 keyed with
  // the client secret, hex-encoded. Pinned to the exact bytes rather than to
  // "a signature was produced": a subtly wrong canonical string fails as a 401
  // at Bitnob, which the router would report as a partner outage rather than
  // as our own bug.
  it('signs the documented canonical string', () => {
    const headers = signRequest('client-123', 'secret-abc', '{"a":1}', 1_719_236_465, 'deadbeef');
    const expected = createHmac('sha256', 'secret-abc')
      .update('client-123:1719236465:deadbeef:{"a":1}')
      .digest('hex');

    expect(headers['X-Auth-Signature']).toBe(expected);
    expect(headers['X-Auth-Client']).toBe('client-123');
    expect(headers['X-Auth-Timestamp']).toBe('1719236465');
    expect(headers['X-Auth-Nonce']).toBe('deadbeef');
  });

  it('signs an empty payload as the empty string, not as "undefined"', () => {
    const headers = signRequest('c', 's', '', 1_000, 'n');

    expect(headers['X-Auth-Signature']).toBe(
      createHmac('sha256', 's').update('c:1000:n:').digest('hex')
    );
  });

  it('produces a different signature when only the nonce changes', () => {
    const a = signRequest('c', 's', '{}', 1_000, 'nonce-one');
    const b = signRequest('c', 's', '{}', 1_000, 'nonce-two');

    expect(a['X-Auth-Signature']).not.toBe(b['X-Auth-Signature']);
  });
});

describe('buildQuoteBody', () => {
  it('prices the send leg in USD and names the destination', () => {
    expect(buildQuoteBody(params, 'NGN')).toEqual({
      source: { currency: 'USD', amount: 500 },
      destination: { country: 'NG', currency: 'NGN' },
    });
  });

  it('passes a chosen rail through as the channel', () => {
    const body = buildQuoteBody({ ...params, payoutNetwork: 'mpesa' }, 'KES');

    expect(body.destination).toMatchObject({ channel: 'mpesa' });
  });
});

describe('parseQuote', () => {
  it('maps a documented Bitnob quote', () => {
    const quote = parseQuote(
      {
        data: {
          settlementAmount: 690_000,
          settlementCurrency: 'NGN',
          rate: 1_400,
          fee: 4.5,
          networkFee: 0.5,
          channel: 'nip',
        },
      },
      params,
      'US-NG',
      'NGN'
    );

    expect(quote!.provider).toBe('bitnob');
    expect(quote!.corridor).toBe('US-NG');
    expect(quote!.receiveAmount).toBe(690_000);
    expect(quote!.payoutCurrency).toBe('NGN');
    expect(quote!.payoutMethod).toBe('bank');
    expect(quote!.fees.total).toBe(5);
    expect(quote!.quotedFxRate).toBe(1_400);
  });

  it('accepts every documented spelling of the payout amount', () => {
    for (const field of ['settlementAmount', 'receiveAmount', 'localAmount']) {
      const quote = parseQuote({ data: { [field]: 1_234 } }, params, 'US-NG', 'NGN');
      expect(quote!.receiveAmount).toBe(1_234);
    }
  });

  it('maps mobile money to the ewallet method', () => {
    const quote = parseQuote(
      { data: { settlementAmount: 50_000, channel: 'mobile_money' } },
      { ...params, destinationCountry: 'KE' },
      'US-KE',
      'KES'
    );

    expect(quote!.payoutMethod).toBe('ewallet');
  });

  it('falls back to the corridor currency when the partner omits it', () => {
    const quote = parseQuote({ data: { settlementAmount: 900 } }, params, 'US-GH', 'GHS');

    expect(quote!.payoutCurrency).toBe('GHS');
  });

  it('drops a response with no deliverable payout rather than inventing one', () => {
    expect(parseQuote({ data: {} }, params, 'US-NG', 'NGN')).toBeNull();
    expect(parseQuote({ data: { settlementAmount: 0 } }, params, 'US-NG', 'NGN')).toBeNull();
    expect(parseQuote({ data: { settlementAmount: 'not a number' } }, params, 'US-NG', 'NGN')).toBeNull();
  });
});

describe('BitnobProvider', () => {
  let provider: BitnobProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new BitnobProvider();
    process.env.BITNOB_CLIENT_ID = 'client-123';
    process.env.BITNOB_CLIENT_SECRET = 'secret-abc';
  });

  afterEach(() => {
    delete process.env.BITNOB_CLIENT_ID;
    delete process.env.BITNOB_CLIENT_SECRET;
  });

  it('needs both halves of the credential', () => {
    expect(provider.isConfigured()).toBe(true);

    delete process.env.BITNOB_CLIENT_SECRET;
    expect(provider.isConfigured()).toBe(false);
  });

  it('serves the six African corridors', () => {
    expect(provider.corridors).toEqual(['US-NG', 'US-KE', 'US-GH', 'US-ZA', 'US-UG', 'US-TZ']);
  });

  it('returns nothing, and does not call out, for a country it cannot pay into', async () => {
    // Brazil is a corridor we serve, but not one Bitnob is licensed for. The
    // wrong behaviour here would be a BRL request answered with an NGN quote.
    expect(await provider.quote({ ...params, destinationCountry: 'BR' })).toEqual([]);
    expect(await provider.quote({ ...params, destinationCountry: 'JP' })).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('signs the body it actually sends', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { settlementAmount: 690_000, rate: 1_400 } }),
    } as Response);

    await provider.quote(params);

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const headers = init!.headers as Record<string, string>;
    const body = init!.body as string;
    const expected = createHmac('sha256', 'secret-abc')
      .update(
        `client-123:${headers['X-Auth-Timestamp']}:${headers['X-Auth-Nonce']}:${body}`
      )
      .digest('hex');

    expect(headers['X-Auth-Signature']).toBe(expected);
  });

  it('surfaces a partner error rather than swallowing it', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'invalid signature',
    } as Response);

    await expect(provider.quote(params)).rejects.toThrow('Bitnob API error 401');
  });
});
