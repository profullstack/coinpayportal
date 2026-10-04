import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CybridProvider, parseQuote } from './cybrid';
import type { RemittanceQuoteParams } from './types';

global.fetch = vi.fn();

const params: RemittanceQuoteParams = {
  sendAsset: 'USDC',
  sendAmount: 500,
  destinationCountry: 'CA',
};

describe('parseQuote', () => {
  it('scales base units into currency', () => {
    // Cybrid denominates CAD in cents. Reading 68_250 as dollars rather than
    // cents would overstate the payout a hundredfold.
    const quote = parseQuote(
      { receive_amount: 68_250, fee: 300, network_fee: 50, asset: 'CAD', rate: 1.37 },
      params
    );

    expect(quote!.receiveAmount).toBe(682.5);
    expect(quote!.fees.provider).toBe(3);
    expect(quote!.fees.network).toBe(0.5);
    expect(quote!.fees.total).toBe(3.5);
    expect(quote!.quotedFxRate).toBe(1.37);
  });

  it('defaults to the Interac rail', () => {
    const quote = parseQuote({ receive_amount: 100 }, params);
    expect(quote!.payoutMethod).toBe('bank');
    expect(quote!.payoutNetwork).toBe('interac');
    expect(quote!.corridor).toBe('US-CA');
  });

  it('honours an explicit EFT choice', () => {
    const quote = parseQuote({ receive_amount: 100 }, { ...params, payoutNetwork: 'eft' });
    expect(quote!.payoutNetwork).toBe('eft');
  });

  it('accepts either amount field', () => {
    expect(parseQuote({ deliver_amount: 5_000 }, params)!.receiveAmount).toBe(50);
  });

  it('returns null when there is no deliverable payout', () => {
    expect(parseQuote({}, params)).toBeNull();
    expect(parseQuote({ receive_amount: 0 }, params)).toBeNull();
  });
});

describe('CybridProvider', () => {
  const originalEnv = process.env;
  const provider = new CybridProvider();

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv, CYBRID_API_KEY: 'test-key' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('is unconfigured without a key', () => {
    process.env = { ...originalEnv };
    delete process.env.CYBRID_API_KEY;
    expect(provider.isConfigured()).toBe(false);
  });

  it('serves only Canada', () => {
    expect(provider.corridors).toEqual(['US-CA']);
  });

  it('sends the amount in base units', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ receive_amount: 100 }),
    } as unknown as Response);

    await provider.quote(params);

    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.deliver_amount).toBe(50_000);
    expect(body.symbol).toBe('USDC-CAD');
  });

  it('strips the chain suffix from the symbol', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ receive_amount: 100 }),
    } as unknown as Response);

    await provider.quote({ ...params, sendAsset: 'USDC_POL' });

    const body = JSON.parse(String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body));
    expect(body.symbol).toBe('USDC-CAD');
  });

  it('surfaces an API error rather than returning an empty ranking', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorised',
    } as unknown as Response);

    await expect(provider.quote(params)).rejects.toThrow('Cybrid API error 401');
  });
});
