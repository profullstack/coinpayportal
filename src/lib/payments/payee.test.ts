import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/wallets/supported-coins', () => ({
  getPaymentReceivingWallet: vi.fn(),
}));

import { getPaymentReceivingWallet } from '@/lib/wallets/supported-coins';
import { resolvePayee, assertPayee, payeeRequiredMessage } from './payee';

const supabase = {} as never;
const ETH_ADDRESS = '0x' + 'a'.repeat(40);
const OTHER_ETH_ADDRESS = '0x' + 'b'.repeat(40);

const base = { businessId: 'biz-1', merchantId: 'merchant-1' };

describe('resolvePayee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefers an explicitly entered address over any account wallet', async () => {
    vi.mocked(getPaymentReceivingWallet).mockResolvedValue({
      walletAddress: OTHER_ETH_ADDRESS,
      source: 'business',
    });

    const result = await resolvePayee(supabase, {
      ...base,
      cryptocurrency: 'ETH',
      requestedAddress: ETH_ADDRESS,
    });

    expect(result).toMatchObject({ ok: true, address: ETH_ADDRESS, source: 'manual' });
    // A manual payee must not even consult the account wallets.
    expect(getPaymentReceivingWallet).not.toHaveBeenCalled();
  });

  it('marks a carried-over address as inherited rather than manual', async () => {
    const result = await resolvePayee(supabase, {
      ...base,
      cryptocurrency: 'ETH',
      requestedAddress: ETH_ADDRESS,
      inherited: true,
    });

    expect(result).toMatchObject({ ok: true, source: 'inherited' });
  });

  it('falls back to the account wallet when no address is supplied', async () => {
    vi.mocked(getPaymentReceivingWallet).mockResolvedValue({
      walletAddress: ETH_ADDRESS,
      source: 'web_wallet',
    });

    const result = await resolvePayee(supabase, { ...base, cryptocurrency: 'ETH' });

    expect(result).toMatchObject({ ok: true, address: ETH_ADDRESS, source: 'web_wallet' });
  });

  it('demands a manual address when nothing can be derived from the account', async () => {
    vi.mocked(getPaymentReceivingWallet).mockResolvedValue({ error: 'no wallet' });

    const result = await resolvePayee(supabase, { ...base, cryptocurrency: 'ETH' });

    expect(result).toMatchObject({ ok: false, code: 'PAYEE_REQUIRED', status: 400 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(payeeRequiredMessage('ETH'));
  });

  it('rejects an address that is malformed for the chain', async () => {
    const result = await resolvePayee(supabase, {
      ...base,
      cryptocurrency: 'ETH',
      requestedAddress: 'not-an-eth-address',
    });

    expect(result).toMatchObject({ ok: false, code: 'PAYEE_INVALID', status: 400 });
  });

  it('trusts an address on a chain that has no format validator', async () => {
    const result = await resolvePayee(supabase, {
      ...base,
      cryptocurrency: 'XRP',
      requestedAddress: 'rSomeXrpAddress123',
    });

    expect(result).toMatchObject({ ok: true, source: 'manual' });
  });

  it('refuses to resolve without a cryptocurrency', async () => {
    const result = await resolvePayee(supabase, { ...base, cryptocurrency: '' });

    expect(result).toMatchObject({ ok: false, code: 'CRYPTO_REQUIRED' });
  });

  it('treats a whitespace-only address as absent, not as a payee', async () => {
    vi.mocked(getPaymentReceivingWallet).mockResolvedValue({ error: 'no wallet' });

    const result = await resolvePayee(supabase, {
      ...base,
      cryptocurrency: 'ETH',
      requestedAddress: '   ',
    });

    expect(result).toMatchObject({ ok: false, code: 'PAYEE_REQUIRED' });
  });
});

describe('assertPayee', () => {
  it('accepts a valid stored payee', () => {
    expect(assertPayee(ETH_ADDRESS, 'ETH')).toMatchObject({ ok: true, address: ETH_ADDRESS });
  });

  it('rejects an empty payee — the bug that routed net funds to the platform wallet', () => {
    expect(assertPayee('', 'ETH')).toMatchObject({ ok: false, code: 'PAYEE_REQUIRED' });
    expect(assertPayee(null, 'ETH')).toMatchObject({ ok: false, code: 'PAYEE_REQUIRED' });
    expect(assertPayee('   ', 'ETH')).toMatchObject({ ok: false, code: 'PAYEE_REQUIRED' });
  });

  it('rejects a payee saved for a different chain', () => {
    expect(assertPayee(ETH_ADDRESS, 'BTC')).toMatchObject({ ok: false, code: 'PAYEE_INVALID' });
  });

  it('requires a cryptocurrency', () => {
    expect(assertPayee(ETH_ADDRESS, null)).toMatchObject({ ok: false, code: 'CRYPTO_REQUIRED' });
  });
});
