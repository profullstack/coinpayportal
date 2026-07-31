import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/payments/payee', () => ({
  resolvePayee: vi.fn(),
  assertPayee: vi.fn(),
}));

import { resolvePayee } from '@/lib/payments/payee';
import { resolveRevisionPayee, assertCounterable, generateAccessToken } from './service';

const supabase = {} as never;
const ETH_ADDRESS = '0x' + 'a'.repeat(40);
const NEW_ADDRESS = '0x' + 'c'.repeat(40);

const proposal = { business_id: 'biz-1', user_id: 'owner-1' };

describe('resolveRevisionPayee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves a payee for a merchant offer that names a coin', async () => {
    vi.mocked(resolvePayee).mockResolvedValue({
      ok: true,
      address: ETH_ADDRESS,
      source: 'business',
    });

    const result = await resolveRevisionPayee(supabase, {
      proposal,
      party: 'merchant',
      cryptoCurrency: 'ETH',
      requestedAddress: null,
    });

    expect(result).toMatchObject({ ok: true, address: ETH_ADDRESS, source: 'business' });
  });

  it('blocks a merchant offer whose payee cannot be determined', async () => {
    vi.mocked(resolvePayee).mockResolvedValue({
      ok: false,
      code: 'PAYEE_REQUIRED',
      error: 'enter an address',
      status: 400,
    });

    const result = await resolveRevisionPayee(supabase, {
      proposal,
      party: 'merchant',
      cryptoCurrency: 'ETH',
      requestedAddress: null,
    });

    expect(result).toMatchObject({ ok: false, code: 'PAYEE_REQUIRED' });
  });

  it('carries the standing payee into a client counter that keeps the same coin', async () => {
    const result = await resolveRevisionPayee(supabase, {
      proposal,
      party: 'client',
      cryptoCurrency: 'ETH',
      requestedAddress: null,
      previousRevision: { crypto_currency: 'ETH', merchant_wallet_address: ETH_ADDRESS },
    });

    expect(result).toMatchObject({ ok: true, address: ETH_ADDRESS, source: 'inherited' });
    expect(resolvePayee).not.toHaveBeenCalled();
  });

  it('leaves the payee unset when a client counter switches coins', async () => {
    const result = await resolveRevisionPayee(supabase, {
      proposal,
      party: 'client',
      cryptoCurrency: 'BTC',
      requestedAddress: null,
      previousRevision: { crypto_currency: 'ETH', merchant_wallet_address: ETH_ADDRESS },
    });

    // The merchant must supply a BTC payee before this can be accepted.
    expect(result).toMatchObject({ ok: true, address: null, source: null });
  });

  it('ignores a payee address the client tries to set', async () => {
    const result = await resolveRevisionPayee(supabase, {
      proposal,
      party: 'client',
      cryptoCurrency: 'ETH',
      requestedAddress: NEW_ADDRESS,
      previousRevision: { crypto_currency: 'ETH', merchant_wallet_address: ETH_ADDRESS },
    });

    // Where the merchant gets paid is never the client's to choose.
    expect(result).toMatchObject({ ok: true, address: ETH_ADDRESS });
  });

  it('skips resolution entirely when no coin is named yet', async () => {
    const result = await resolveRevisionPayee(supabase, {
      proposal,
      party: 'merchant',
      cryptoCurrency: null,
      requestedAddress: null,
    });

    expect(result).toMatchObject({ ok: true, address: null, source: null });
    expect(resolvePayee).not.toHaveBeenCalled();
  });

  it('re-resolves rather than inheriting when the merchant switches coins', async () => {
    vi.mocked(resolvePayee).mockResolvedValue({
      ok: true,
      address: 'bc1qexampleaddressvalue000000000000000000',
      source: 'merchant_global',
    });

    await resolveRevisionPayee(supabase, {
      proposal,
      party: 'merchant',
      cryptoCurrency: 'BTC',
      requestedAddress: null,
      previousRevision: { crypto_currency: 'ETH', merchant_wallet_address: ETH_ADDRESS },
    });

    // The stale ETH address must not be offered up as the BTC payee.
    expect(resolvePayee).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ cryptocurrency: 'BTC', requestedAddress: null }),
    );
  });
});

describe('assertCounterable', () => {
  it('allows both sides to counter a live proposal', () => {
    expect(assertCounterable('sent', 'client')).toBeNull();
    expect(assertCounterable('countered', 'merchant')).toBeNull();
  });

  it('blocks the client from countering a draft', () => {
    expect(assertCounterable('draft', 'client')).toMatchObject({
      ok: false,
      code: 'NOT_COUNTERABLE',
      status: 409,
    });
  });

  it('blocks countering a settled proposal', () => {
    for (const status of ['accepted', 'rejected', 'withdrawn', 'expired'] as const) {
      expect(assertCounterable(status, 'merchant')).toMatchObject({ code: 'NOT_COUNTERABLE' });
    }
  });
});

describe('generateAccessToken', () => {
  it('produces a long, url-safe, non-repeating token', () => {
    const a = generateAccessToken();
    const b = generateAccessToken();

    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
