import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { YellowCardProvider, parseQuote, signRequest } from './yellowcard';
import type { RemittanceQuoteParams } from './types';

global.fetch = vi.fn();

const params: RemittanceQuoteParams = {
  sendAsset: 'USDC',
  sendAmount: 500,
  destinationCountry: 'NG',
};

describe('parseQuote', () => {
  it('maps a documented Yellow Card quote', () => {
    const quote = parseQuote(
      {
        data: {
          localAmount: 690_000,
          currency: 'NGN',
          rate: 1_400,
          fee: 4.5,
          networkFee: 0.5,
          channel: 'bank',
        },
      },
      params
    );

    expect(quote!.provider).toBe('yellowcard');
    expect(quote!.corridor).toBe('US-NG');
    expect(quote!.receiveAmount).toBe(690_000);
    expect(quote!.payoutCurrency).toBe('NGN');
    expect(quote!.payoutMethod).toBe('bank');
    expect(quote!.payoutNetwork).toBe('nip');
    expect(quote!.fees.total).toBe(5);
    expect(quote!.quotedFxRate).toBe(1_400);
  });

  it('accepts either field name for the payout and the fee', () => {
    const quote = parseQuote({ data: { receiveAmount: 500_000, totalFee: 3 } }, params);

    expect(quote!.receiveAmount).toBe(500_000);
    expect(quote!.fees.provider).toBe(3);
  });

  it('maps mobile money onto the e-wallet method', () => {
    // OPay and PalmPay are NIP endpoints rather than separate rails, but they
    // present to the recipient as wallets.
    const quote = parseQuote(
      { data: { localAmount: 1, channel: 'mobile_money' } },
      { ...params, payoutNetwork: 'opay' }
    );

    expect(quote!.payoutMethod).toBe('ewallet');
    expect(quote!.payoutNetwork).toBe('opay');
  });

  it('returns null when there is no deliverable payout', () => {
    expect(parseQuote({}, params)).toBeNull();
    expect(parseQuote({ data: {} }, params)).toBeNull();
    expect(parseQuote({ data: { localAmount: 0 } }, params)).toBeNull();
  });
});

describe('YellowCardProvider', () => {
  const originalEnv = process.env;
  const provider = new YellowCardProvider();

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = {
      ...originalEnv,
      YELLOWCARD_API_KEY: 'test-key',
      YELLOWCARD_API_SECRET: 'test-secret',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('is unconfigured without a key', () => {
    process.env = { ...originalEnv };
    delete process.env.YELLOWCARD_API_KEY;
    expect(provider.isConfigured()).toBe(false);
  });

  it('needs the secret as well as the key', () => {
    // Signing needs both. A key on its own would report Nigeria as available
    // and then fail every quote against it.
    expect(provider.isConfigured()).toBe(true);

    delete process.env.YELLOWCARD_API_SECRET;
    expect(provider.isConfigured()).toBe(false);
  });

  it('authenticates with YcHmacV1 and a timestamp, never a bearer token', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { localAmount: 1 } }),
    } as unknown as Response);

    await provider.quote(params);

    const init = vi.mocked(fetch).mock.calls[0][1];
    const headers = init!.headers as Record<string, string>;

    expect(headers.Authorization).toMatch(/^YcHmacV1 test-key:/);
    expect(headers.Authorization).not.toContain('Bearer');
    // ISO8601, which is what their spec asks for rather than a Unix epoch.
    expect(headers['X-YC-Timestamp']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('serves only Nigeria', () => {
    expect(provider.corridors).toEqual(['US-NG']);
  });

  it('asks for NGN in Nigeria', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { localAmount: 1 } }),
    } as unknown as Response);

    await provider.quote(params);

    const url = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(url).toContain('currency=NGN');
    expect(url).toContain('country=NG');
  });

  it('surfaces an API error rather than returning an empty ranking', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorised',
    } as unknown as Response);

    await expect(provider.quote(params)).rejects.toThrow('Yellow Card API error 401');
  });
});

describe('signRequest', () => {
  it('is deterministic for the same request', () => {
    const a = signRequest('k', 's', 'GET', '/business/quotes', '2026-09-06T00:00:00.000Z');
    const b = signRequest('k', 's', 'GET', '/business/quotes', '2026-09-06T00:00:00.000Z');

    expect(a.Authorization).toBe(b.Authorization);
  });

  it('changes when the path changes', () => {
    const a = signRequest('k', 's', 'GET', '/business/quotes', '2026-09-06T00:00:00.000Z');
    const b = signRequest('k', 's', 'GET', '/business/payments', '2026-09-06T00:00:00.000Z');

    expect(a.Authorization).not.toBe(b.Authorization);
  });
});
