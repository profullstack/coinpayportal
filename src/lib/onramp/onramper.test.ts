import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OnramperProvider, parseQuote } from './onramper';
import type { OnrampQuoteParams } from './types';

global.fetch = vi.fn();

const params: OnrampQuoteParams = {
  fiatCurrency: 'USD',
  fiatAmount: 500,
  cryptoAsset: 'BTC',
};

describe('parseQuote', () => {
  it('maps a well-formed Onramper entry', () => {
    const quote = parseQuote(
      {
        ramp: 'moonpay',
        payout: 0.00512,
        rate: 97_000,
        networkFee: 1.5,
        transactionFee: 4.99,
        paymentMethod: 'creditcard',
      },
      params
    );

    expect(quote).not.toBeNull();
    expect(quote!.provider).toBe('moonpay');
    expect(quote!.providerLabel).toBe('Moonpay');
    expect(quote!.source).toBe('onramper');
    expect(quote!.paymentMethod).toBe('card');
    expect(quote!.receiveAmount).toBe(0.00512);
    expect(quote!.fees).toEqual({ provider: 4.99, network: 1.5, payment: 0, total: 6.49 });
    expect(quote!.quotedRate).toBe(97_000);
  });

  it('drops the error entries Onramper mixes in with real quotes', () => {
    // A ramp that cannot serve the country still gets a slot in the array.
    // Rendering it as a zero-payout option would be worse than omitting it.
    expect(
      parseQuote(
        { ramp: 'banxa', errors: [{ message: 'Country not supported', type: 'country' }] },
        params
      )
    ).toBeNull();

    expect(parseQuote({ ramp: 'banxa', payout: 0 }, params)).toBeNull();
    expect(parseQuote({ ramp: 'banxa', payout: -1 }, params)).toBeNull();
  });

  it('carries provider warnings onto a quote that is still usable', () => {
    const quote = parseQuote(
      {
        ramp: 'banxa',
        payout: 0.005,
        errors: [{ message: 'Limits may apply' }],
      },
      params
    );

    expect(quote!.warnings).toEqual(['Limits may apply']);
  });

  it('accepts numeric strings, which the API mixes with numbers', () => {
    const quote = parseQuote(
      { ramp: 'guardarian', payout: '0.0049', transactionFee: '5.50', networkFee: '2' },
      params
    );

    expect(quote!.receiveAmount).toBe(0.0049);
    expect(quote!.fees.total).toBe(7.5);
  });

  it('does not invent fees that were not reported', () => {
    const quote = parseQuote({ ramp: 'someramp', payout: 0.005 }, params);

    expect(quote!.fees).toEqual({ provider: 0, network: 0, payment: 0, total: 0 });
    // With no disclosed fee at all, the router's spread figure becomes the
    // entire cost — which is the correct reading, not a missing value.
    expect(quote!.quotedRate).toBeNull();
  });

  it('normalises every bank rail onto one payment method', () => {
    // Interac included: it is how Canadians pay, and without it a
    // bank_transfer filter drops the only rail a Canadian buyer would use.
    for (const id of [
      'banktransfer',
      'sepabanktransfer',
      'fasterpayments',
      'ach',
      'interac',
      'interacetransfer',
    ]) {
      const quote = parseQuote({ ramp: 'r', payout: 1, paymentMethod: id }, params);
      expect(quote!.paymentMethod).toBe('bank_transfer');
    }
  });

  it('quotes a Canadian buyer in CAD', () => {
    // The route puts no allowlist on fiat, so a CAD purchase needs no special
    // casing — this pins that it stays true.
    const quote = parseQuote(
      { ramp: 'moonpay', payout: 0.004, paymentMethod: 'interac' },
      { ...params, fiatCurrency: 'CAD' }
    );

    expect(quote!.fiatCurrency).toBe('CAD');
    expect(quote!.paymentMethod).toBe('bank_transfer');
  });

  it('falls back to "other" for an unrecognised rail rather than guessing', () => {
    const quote = parseQuote({ ramp: 'r', payout: 1, paymentMethod: 'carrier_billing' }, params);
    expect(quote!.paymentMethod).toBe('other');
  });
});

describe('OnramperProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv, ONRAMPER_API_KEY: 'test-key' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('is unconfigured without a key', () => {
    process.env = { ...originalEnv };
    delete process.env.ONRAMPER_API_KEY;
    expect(new OnramperProvider().isConfigured()).toBe(false);
  });

  it('addresses tokens by network and native assets by bare ticker', async () => {
    const provider = new OnramperProvider();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [],
    } as unknown as Response);

    await provider.quote({ ...params, cryptoAsset: 'USDC_POL' });
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('/quotes/usd/usdc_polygon');

    await provider.quote({ ...params, cryptoAsset: 'BTC' });
    expect(vi.mocked(fetch).mock.calls[1][0]).toContain('/quotes/usd/btc');
  });

  it('accepts both the bare array and the message-wrapped response', async () => {
    const provider = new OnramperProvider();
    const entry = { ramp: 'moonpay', payout: 0.005 };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => [entry],
    } as unknown as Response);
    expect(await provider.quote(params)).toHaveLength(1);

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: [entry] }),
    } as unknown as Response);
    expect(await provider.quote(params)).toHaveLength(1);
  });

  it('surfaces an API error rather than returning an empty ranking', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorised',
    } as unknown as Response);

    await expect(new OnramperProvider().quote(params)).rejects.toThrow('Onramper API error 401');
  });

  it('builds a widget hand-off that delivers to the user address', async () => {
    const session = await new OnramperProvider().createSession({
      fiatCurrency: 'USD',
      fiatAmount: 500,
      cryptoAsset: 'USDC_POL',
      walletAddress: '0x1111111111111111111111111111111111111111',
      provider: 'moonpay',
      externalId: 'order-1',
    });

    const url = new URL(session.url);
    expect(url.origin).toBe('https://buy.onramper.com');
    expect(url.searchParams.get('mode')).toBe('buy');
    expect(url.searchParams.get('defaultAmount')).toBe('500');
    expect(url.searchParams.get('onlyOnramps')).toBe('moonpay');
    expect(url.searchParams.get('partnerContext')).toBe('order-1');
    // The destination is the user's own address — we never take custody.
    expect(url.searchParams.get('wallets')).toBe(
      'usdc_polygon:0x1111111111111111111111111111111111111111'
    );
  });

  it('refuses to build a session without a key', async () => {
    process.env = { ...originalEnv };
    delete process.env.ONRAMPER_API_KEY;

    await expect(
      new OnramperProvider().createSession({
        fiatCurrency: 'USD',
        fiatAmount: 100,
        cryptoAsset: 'BTC',
        walletAddress: 'bc1qtest',
      })
    ).rejects.toThrow('not configured');
  });
});
