import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mocked before importing the module under test.
vi.mock('./balance-checkers', () => ({
  checkBalance: vi.fn(),
}));
vi.mock('./webhook', () => ({
  sendWebhook: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/payments/business-collection', () => ({
  processConfirmedBusinessCollectionPayment: vi.fn(),
}));
vi.mock('@/lib/subscriptions/service', () => ({
  handleSubscriptionPaymentConfirmed: vi.fn(),
}));

import { rescanLateDeposits } from './payment-monitor';
import { checkBalance } from './balance-checkers';
import { sendWebhook } from './webhook';

/**
 * A payment that expired before its deposit arrived. This is the exact shape
 * that stranded INV-001: the 15-minute window closed, the customer paid ~5
 * minutes later, and nothing ever looked at the address again.
 */
function expiredPayment(overrides: Record<string, any> = {}) {
  return {
    id: 'pay_late',
    business_id: 'biz_1',
    blockchain: 'SOL',
    crypto_amount: 1.35938562,
    status: 'expired',
    payment_address: 'SoLaDdReSs',
    created_at: '2026-07-31T11:07:40Z',
    expires_at: '2026-07-31T11:22:40Z',
    merchant_wallet_address: 'MerchantWallet',
    ...overrides,
  };
}

function mockSupabase(expiredRows: any[], opts: { isEscrow?: boolean } = {}) {
  const paymentsUpdateEq = vi.fn().mockResolvedValue({ data: null, error: null });
  const paymentsUpdate = vi.fn().mockReturnValue({ eq: paymentsUpdateEq });
  const queueDeleteEq = vi.fn().mockResolvedValue({ data: null, error: null });

  const rescanChain = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        not: vi.fn().mockReturnValue({
          neq: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: expiredRows, error: null }),
              }),
            }),
          }),
        }),
      }),
    }),
    update: paymentsUpdate,
  };

  const supabase: any = {
    from: vi.fn((table: string) => {
      if (table === 'payments') return rescanChain;
      if (table === 'payment_addresses') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { is_escrow: opts.isEscrow ?? false },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'payment_forwarding_queue') {
        return {
          delete: vi.fn().mockReturnValue({ eq: queueDeleteEq }),
          upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };

  return { supabase, paymentsUpdate, paymentsUpdateEq };
}

describe('rescanLateDeposits', () => {
  const now = new Date('2026-08-14T00:00:00Z');
  let stats: any;

  beforeEach(() => {
    vi.clearAllMocks();
    stats = { checked: 0, confirmed: 0, expired: 0, errors: 0 };
    process.env.INTERNAL_API_KEY = 'test-key';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '' }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('confirms and forwards a payment funded after its window closed', async () => {
    vi.mocked(checkBalance).mockResolvedValue(1.35938662 as any);
    const { supabase, paymentsUpdate } = mockSupabase([expiredPayment()]);

    await rescanLateDeposits(supabase, now, stats);

    expect(stats.confirmed).toBe(1);
    expect(stats.errors).toBe(0);

    // Status moved off 'expired' so the funds are no longer invisible.
    expect(paymentsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'confirmed' }),
    );

    // And the money was actually pushed out, not just re-labelled.
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/payments/pay_late/forward',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(sendWebhook).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'confirmed' }),
      'payment.confirmed',
      expect.anything(),
    );
  });

  it('leaves a genuinely unfunded expired payment alone', async () => {
    vi.mocked(checkBalance).mockResolvedValue(0 as any);
    const { supabase, paymentsUpdate } = mockSupabase([expiredPayment()]);

    await rescanLateDeposits(supabase, now, stats);

    expect(stats.confirmed).toBe(0);
    expect(paymentsUpdate).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts a deposit within the 1% underpayment tolerance', async () => {
    vi.mocked(checkBalance).mockResolvedValue(1.3552 as any); // ~0.3% short
    const { supabase } = mockSupabase([expiredPayment()]);

    await rescanLateDeposits(supabase, now, stats);

    expect(stats.confirmed).toBe(1);
  });

  it('never auto-forwards an escrow-held address', async () => {
    vi.mocked(checkBalance).mockResolvedValue(1.35938662 as any);
    const { supabase } = mockSupabase([expiredPayment()], { isEscrow: true });

    await rescanLateDeposits(supabase, now, stats);

    expect(stats.confirmed).toBe(1); // still confirmed…
    expect(fetch).not.toHaveBeenCalled(); // …but settlement stays manual
  });

  it('keeps going when one address fails to check', async () => {
    vi.mocked(checkBalance)
      .mockRejectedValueOnce(new Error('rpc down'))
      .mockResolvedValueOnce(1.35938662 as any);
    const { supabase } = mockSupabase([
      expiredPayment({ id: 'pay_bad' }),
      expiredPayment({ id: 'pay_good' }),
    ]);

    await rescanLateDeposits(supabase, now, stats);

    expect(stats.errors).toBe(1);
    expect(stats.confirmed).toBe(1);
  });
});
