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

import { confirmAndForwardPayment, rescanLateDeposits } from './payment-monitor';
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

function mockSupabase(
  expiredRows: any[],
  opts: { isEscrow?: boolean; claimed?: boolean; heldCount?: number; heldError?: boolean } = {},
) {
  // The confirm write is a compare-and-swap:
  //   .update({status:'confirmed'}).eq('id', …).eq('status', observed).select()
  // `claimed: false` models another worker having won the race.
  const claimedRows = opts.claimed === false ? [] : [{ id: 'pay_late' }];
  const paymentsUpdateSelect = vi.fn().mockResolvedValue({ data: claimedRows, error: null });
  const paymentsUpdateStatusEq = vi.fn().mockReturnValue({ select: paymentsUpdateSelect });
  const paymentsUpdateEq = vi.fn().mockReturnValue({
    eq: paymentsUpdateStatusEq,
    // Non-CAS callers (the plain 'expired' write) await the first .eq() directly.
    then: (resolve: any) => resolve({ data: null, error: null }),
  });
  const paymentsUpdate = vi.fn().mockReturnValue({ eq: paymentsUpdateEq });
  const queueDeleteEq = vi.fn().mockResolvedValue({ data: null, error: null });

  const statusFilter = vi.fn();
  const rescanChain = {
    select: vi.fn().mockImplementation((_columns: string, options?: { head?: boolean }) => options?.head ? {
      in: vi.fn().mockReturnValue({ lte: vi.fn().mockResolvedValue({
        count: opts.heldCount ?? 0, error: opts.heldError ? new Error('synthetic count failure') : null,
      }) }),
    } : {
      in: statusFilter.mockReturnValue({
        not: vi.fn().mockReturnValue({
          neq: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              lte: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: expiredRows, error: null }),
                }),
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

  return { supabase, paymentsUpdate, paymentsUpdateEq, paymentsUpdateStatusEq, statusFilter };
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

  it('refuses a deposit that is short, even slightly', async () => {
    // ~0.3% short. This used to confirm under a 1% tolerance, which unlocked
    // the goods and then left the forwarder trying to send 100% out of an
    // address holding 99.7% — so the forward failed and the funds stranded.
    vi.mocked(checkBalance).mockResolvedValue(1.3552 as any);
    const { supabase, paymentsUpdate } = mockSupabase([expiredPayment()]);

    await rescanLateDeposits(supabase, now, stats);

    expect(stats.confirmed).toBe(0);
    expect(paymentsUpdate).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not forward when another worker already claimed the payment', async () => {
    vi.mocked(checkBalance).mockResolvedValue(1.35938662 as any);
    const { supabase } = mockSupabase([expiredPayment()], { claimed: false });

    await rescanLateDeposits(supabase, now, stats);

    // The CAS lost, so this worker must not send on-chain — otherwise three
    // schedulers plus the balance-check endpoint each pay the merchant.
    expect(stats.confirmed).toBe(0);
    expect(stats.errors).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(sendWebhook).not.toHaveBeenCalled();
  });

  it('never auto-forwards an escrow-held address', async () => {
    vi.mocked(checkBalance).mockResolvedValue(1.35938662 as any);
    const { supabase } = mockSupabase([expiredPayment()], { isEscrow: true });

    await rescanLateDeposits(supabase, now, stats);

    expect(stats.confirmed).toBe(1); // still confirmed…
    expect(fetch).not.toHaveBeenCalled(); // …but settlement stays manual
  });

  it('excludes held forwarding claims from the limited database scan', async () => {
    vi.mocked(checkBalance).mockResolvedValue(0 as any);
    const { supabase, statusFilter } = mockSupabase([]);

    await rescanLateDeposits(supabase, now, stats);

    const [, statuses] = statusFilter.mock.calls[0];
    expect(statuses).toEqual(['expired', 'confirmed']);
  });

  it('does not re-drive a legacy failure even when funds still appear present', async () => {
    vi.mocked(checkBalance).mockResolvedValue(1.35938662 as any);
    const { supabase, paymentsUpdate } = mockSupabase([expiredPayment({ status: 'forwarding_failed' })]);

    await rescanLateDeposits(supabase, now, stats);

    expect(stats.confirmed).toBe(0);
    expect(stats.checked).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(checkBalance).not.toHaveBeenCalled();
    expect(paymentsUpdate).not.toHaveBeenCalled();
  });

  it('reports the excluded backlog count without touching payment rows', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { supabase, paymentsUpdate } = mockSupabase([], { heldCount: 51 });
      await rescanLateDeposits(supabase, now, stats);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('need reconciliation'), expect.objectContaining({ count: 51 }));
      expect(paymentsUpdate).not.toHaveBeenCalled();
      expect(checkBalance).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });

  it('reports an unavailable backlog count instead of treating it as zero', async () => {
    const { supabase } = mockSupabase([], { heldError: true });
    await rescanLateDeposits(supabase, now, stats);
    expect(stats.errors).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('blocks direct confirmation of a legacy forwarding failure', async () => {
    const { supabase, paymentsUpdate } = mockSupabase([]);
    expect(await confirmAndForwardPayment(supabase, expiredPayment({ status: 'forwarding_failed' }) as any, 2, now)).toBe(false);
    expect(paymentsUpdate).not.toHaveBeenCalled();
    expect(sendWebhook).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('will not re-drive a stuck forward once the funds have left', async () => {
    // Balance gone ⇒ an earlier forward did land; re-driving would double-send.
    vi.mocked(checkBalance).mockResolvedValue(0 as any);
    const { supabase } = mockSupabase([expiredPayment({ status: 'forwarding' })]);

    await rescanLateDeposits(supabase, now, stats);

    expect(stats.confirmed).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [null, '2026-08-13T23:59:59Z'],
    [null, '2026-07-31T00:00:00Z'],
    ['synthetic-inflight-hash', '2026-08-13T23:59:59Z'],
    ['synthetic-inflight-hash', '2026-07-31T00:00:00Z'],
    [null, 'invalid-date'],
  ])('never reopens forwarding with hash %s and updated time %s', async (forward_tx_hash, updated_at) => {
    vi.mocked(checkBalance).mockResolvedValue(1.35938662 as any);
    const { supabase, paymentsUpdate } = mockSupabase([
      expiredPayment({ status: 'forwarding', forward_tx_hash, updated_at }),
    ]);
    await rescanLateDeposits(supabase, now, stats);
    expect(stats.confirmed).toBe(0);
    expect(stats.checked).toBe(0);
    expect(paymentsUpdate).not.toHaveBeenCalled();
    expect(checkBalance).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(sendWebhook).not.toHaveBeenCalled();
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

  it('direct confirmation cannot reopen a forwarding claim either', async () => {
    const { supabase, paymentsUpdate } = mockSupabase([]);
    const payment = expiredPayment({ status: 'forwarding' });
    expect(await confirmAndForwardPayment(supabase, payment as any, 1.35938662, now)).toBe(false);
    expect(paymentsUpdate).not.toHaveBeenCalled();
    expect(checkBalance).not.toHaveBeenCalled();
    expect(sendWebhook).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
