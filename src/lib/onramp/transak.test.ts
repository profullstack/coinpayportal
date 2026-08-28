import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TransakProvider, parseQuote } from './transak';
import type { OnrampQuoteParams } from './types';

global.fetch = vi.fn();

const params: OnrampQuoteParams = {
  fiatCurrency: 'USD',
  fiatAmount: 500,
  cryptoAsset: 'BTC',
};

describe('parseQuote', () => {
  it('itemises the fee breakdown Transak provides', () => {
    const quote = parseQuote(
      {
        response: {
          cryptoAmount: 0.00501,
          fiatAmount: 500,
          totalFee: 12.5,
          conversionPrice: 97_000,
          marketConversionPrice: 97_000,
          paymentMethod: 'credit_debit_card',
          feeBreakdown: [
            { id: 'transak_fee', name: 'Transak fee', value: 9 },
            { id: 'network_fee', name: 'Network fee', value: 1.5 },
            { id: 'payment_processor_fee', name: 'Card fee', value: 2 },
          ],
        },
      },
      params
    );

    expect(quote!.receiveAmount).toBe(0.00501);
    expect(quote!.fees.network).toBe(1.5);
    expect(quote!.fees.payment).toBe(2);
    expect(quote!.fees.provider).toBe(9);
    expect(quote!.fees.total).toBe(12.5);
    expect(quote!.paymentMethod).toBe('card');
  });

  it('reconciles a breakdown that does not add up to the stated total', () => {
    // Losing the unexplained remainder would understate the cost, so it is
    // attributed to the provider rather than dropped.
    const quote = parseQuote(
      {
        response: {
          cryptoAmount: 0.005,
          totalFee: 20,
          feeBreakdown: [{ id: 'network_fee', value: 1.5 }],
        },
      },
      params
    );

    expect(quote!.fees.network).toBe(1.5);
    expect(quote!.fees.provider).toBe(18.5);
    expect(quote!.fees.total).toBe(20);
  });

  it('warns when the conversion price is materially below market', () => {
    // Transak is unusual in disclosing its own spread. A rate 2% below market
    // that is not in totalFee is exactly the hidden cost worth flagging.
    const quote = parseQuote(
      {
        response: {
          cryptoAmount: 0.005,
          totalFee: 5,
          conversionPrice: 98_000,
          marketConversionPrice: 100_000,
        },
      },
      params
    );

    expect(quote!.warnings).toHaveLength(1);
    expect(quote!.warnings[0]).toContain('2.00% below market');
  });

  it('stays quiet when the rate tracks market', () => {
    const quote = parseQuote(
      {
        response: {
          cryptoAmount: 0.005,
          totalFee: 5,
          conversionPrice: 99_900,
          marketConversionPrice: 100_000,
        },
      },
      params
    );

    expect(quote!.warnings).toEqual([]);
  });

  it('returns null for a response with no deliverable amount', () => {
    expect(parseQuote({}, params)).toBeNull();
    expect(parseQuote({ response: {} }, params)).toBeNull();
    expect(parseQuote({ response: { cryptoAmount: 0 } }, params)).toBeNull();
  });

  it('never reports a negative provider fee', () => {
    const quote = parseQuote(
      {
        response: {
          cryptoAmount: 0.005,
          totalFee: 1,
          feeBreakdown: [{ id: 'network_fee', value: 5 }],
        },
      },
      params
    );

    expect(quote!.fees.provider).toBe(0);
  });
});

describe('TransakProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv, TRANSAK_API_KEY: 'test-key' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('is unconfigured without a key', () => {
    process.env = { ...originalEnv };
    delete process.env.TRANSAK_API_KEY;
    expect(new TransakProvider().isConfigured()).toBe(false);
  });

  it('maps our asset symbols onto Transak code and network', async () => {
    const provider = new TransakProvider();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ response: null }),
    } as unknown as Response);

    await provider.quote({ ...params, cryptoAsset: 'USDC_POL' });
    const url = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(url).toContain('cryptoCurrency=USDC');
    expect(url).toContain('network=polygon');

    // Bitcoin-family chains are all "mainnet" to Transak.
    await provider.quote({ ...params, cryptoAsset: 'BTC' });
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain('network=mainnet');
  });

  it('builds a widget hand-off with the address form locked', async () => {
    const session = await new TransakProvider().createSession({
      fiatCurrency: 'USD',
      fiatAmount: 250,
      cryptoAsset: 'BTC',
      walletAddress: 'bc1qexample',
      externalId: 'order-9',
    });

    const url = new URL(session.url);
    expect(url.origin).toBe('https://global.transak.com');
    expect(url.searchParams.get('walletAddress')).toBe('bc1qexample');
    // The user must not be able to retype the destination on the provider's
    // screen — we validated the one we sent.
    expect(url.searchParams.get('disableWalletAddressForm')).toBe('true');
    expect(url.searchParams.get('partnerOrderId')).toBe('order-9');
  });
});
