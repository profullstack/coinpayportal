import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TransfiProvider, parseQuote } from './transfi';
import type { RemittanceQuoteParams } from './types';

global.fetch = vi.fn();

const params: RemittanceQuoteParams = {
  sendAsset: 'USDC',
  sendAmount: 500,
  destinationCountry: 'PH',
};

describe('parseQuote', () => {
  it('maps a documented payout quote', () => {
    const quote = parseQuote(
      {
        data: {
          receiveAmount: 28_400,
          receiveCurrency: 'PHP',
          exchangeRate: 57.8,
          totalFee: 7.5,
          processingFee: 5,
          networkFee: 0.5,
          payoutFee: 2,
          payoutMethod: 'wallet',
          estimatedTimeSeconds: 300,
        },
      },
      params,
      'US-PH',
      'PHP'
    );

    expect(quote!.receiveAmount).toBe(28_400);
    expect(quote!.payoutCurrency).toBe('PHP');
    expect(quote!.payoutMethod).toBe('ewallet');
    expect(quote!.fees).toEqual({ provider: 5, network: 0.5, payout: 2, total: 7.5 });
    expect(quote!.quotedFxRate).toBe(57.8);
    expect(quote!.etaSeconds).toBe(300);
  });

  it('accepts a bare body as well as a wrapped one', () => {
    // The documented payout and collection endpoints differ on this.
    const bare = parseQuote({ receiveAmount: 100 }, params, 'US-PH', 'PHP');
    expect(bare!.receiveAmount).toBe(100);
  });

  it('accepts either field name for the payout and the rate', () => {
    const quote = parseQuote(
      { data: { payoutAmount: 28_000, fxRate: 56 } },
      params,
      'US-PH',
      'PHP'
    );

    expect(quote!.receiveAmount).toBe(28_000);
    expect(quote!.quotedFxRate).toBe(56);
  });

  it('attributes an unexplained remainder rather than losing it', () => {
    // A breakdown that does not reach the stated total would otherwise
    // understate what the transfer actually cost.
    const quote = parseQuote(
      { data: { receiveAmount: 100, totalFee: 10, networkFee: 1 } },
      params,
      'US-PH',
      'PHP'
    );

    expect(quote!.fees.network).toBe(1);
    expect(quote!.fees.provider).toBe(9);
    expect(quote!.fees.total).toBe(10);
  });

  it('never reports a total smaller than the parts it was shown', () => {
    const quote = parseQuote(
      { data: { receiveAmount: 100, totalFee: 1, processingFee: 5, networkFee: 2 } },
      params,
      'US-PH',
      'PHP'
    );

    expect(quote!.fees.total).toBe(7);
  });

  it('returns null when there is no deliverable payout', () => {
    expect(parseQuote({}, params, 'US-PH', 'PHP')).toBeNull();
    expect(parseQuote({ data: {} }, params, 'US-PH', 'PHP')).toBeNull();
    expect(parseQuote({ data: { receiveAmount: 0 } }, params, 'US-PH', 'PHP')).toBeNull();
  });
});

describe('TransfiProvider', () => {
  const originalEnv = process.env;
  const provider = new TransfiProvider();

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv, TRANSFI_API_KEY: 'test-key' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('is unconfigured without a key', () => {
    process.env = { ...originalEnv };
    delete process.env.TRANSFI_API_KEY;
    expect(provider.isConfigured()).toBe(false);
  });

  it('serves the three corridors it covers', () => {
    // The only partner here reaching the Philippines or Vietnam.
    expect(provider.corridors).toEqual(['US-MX', 'US-PH', 'US-VN']);
  });

  it('asks for the corridor currency and country', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { receiveAmount: 1 } }),
    } as unknown as Response);

    await provider.quote({ ...params, destinationCountry: 'PH', payoutMethod: 'ewallet', payoutNetwork: 'gcash' });

    const url = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(url).toContain('receiveCurrency=PHP');
    expect(url).toContain('receiveCountry=PH');
    expect(url).toContain('payoutMethod=wallet');
    expect(url).toContain('payoutNetwork=gcash');
  });

  it('sends the key as a bearer token', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { receiveAmount: 1 } }),
    } as unknown as Response);

    await provider.quote(params);

    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
  });

  it('surfaces an API error rather than returning an empty ranking', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'forbidden',
    } as unknown as Response);

    await expect(provider.quote(params)).rejects.toThrow('TransFi API error 403');
  });

  it('returns nothing for a destination outside our corridors', async () => {
    expect(await provider.quote({ ...params, destinationCountry: 'FR' })).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
