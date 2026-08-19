import { describe, it, expect, vi, beforeEach } from 'vitest';
import { monitorSeries } from './series-monitor';

// Mock createEscrow
vi.mock('@/lib/escrow', () => ({
  createEscrow: vi.fn(),
}));

// Mock entitlements
vi.mock('@/lib/entitlements/service', () => ({
  isBusinessPaidTier: vi.fn().mockResolvedValue(false),
}));

import { createEscrow } from '@/lib/escrow';

/**
 * H-R-04: the period is now claimed with a compare-and-swap before anything is
 * created for it, so the update chain is `.eq(id).eq(periods_completed)
 * .eq(next_charge_at).select()` rather than a single `.eq(id)`. The default
 * mock answers a successful claim (one row).
 *
 * The old shape stopped at one `.eq`, which is exactly the missing condition
 * the finding is about: two overlapping runs both read the same
 * periods_completed, both created an escrow for it, and both wrote the same
 * next period — the subscriber billed twice, the counter advanced once.
 */
function claimChain(rows: any[] = [{ id: 'claimed' }]) {
  const chain: any = {};
  chain.eq = vi.fn(() => chain);
  chain.select = vi.fn().mockResolvedValue({ data: rows, error: null });
  // Terminal await for the non-claiming updates (status: 'completed', revert).
  chain.then = (resolve: any) => resolve({ data: rows, error: null });
  return chain;
}

function mockSupabase(seriesRows: any[] = [], updateFn?: ReturnType<typeof vi.fn>) {
  const _update = updateFn || vi.fn(() => claimChain());

  const supabase: any = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: seriesRows, error: null }),
          }),
        }),
      }),
      update: _update,
    }),
  };
  return { supabase, _update };
}

describe('monitorSeries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not charge a period another run already claimed (H-R-04)', async () => {
    // The finding: `periods_completed`/`next_charge_at` were written with only
    // `.eq('id', ...)`, after the escrow had already been created. Two
    // overlapping cron runs both read the same period, both created an escrow
    // for it, and both wrote the same next period — the subscriber is billed
    // twice and the counter advances once, so nothing downstream records that
    // it happened. A slow run overlapping the next tick is all it takes.
    //
    // Zero rows updated means another run got there first.
    const series = {
      id: 'ser_race',
      status: 'active',
      payment_method: 'crypto',
      coin: 'USDC_POL',
      amount: 25,
      interval: 'monthly',
      max_periods: null,
      periods_completed: 2,
      merchant_id: 'biz_1',
      depositor_address: '0xdep',
      beneficiary_address: '0xben',
      next_charge_at: '2026-01-01T00:00:00Z',
    };

    const lostClaim = vi.fn(() => claimChain([]));
    const { supabase } = mockSupabase([series], lostClaim);

    const stats = await monitorSeries(supabase, new Date('2026-01-02'));

    // The important assertion: nothing was created for the contested period.
    expect(createEscrow).not.toHaveBeenCalled();
    expect(stats.created).toBe(0);
  });

  it('claims the period before creating the escrow (H-R-04)', async () => {
    // Ordering matters as much as the condition: claiming afterwards means the
    // duplicate escrow already exists by the time the race is detected.
    const series = {
      id: 'ser_order',
      status: 'active',
      payment_method: 'crypto',
      coin: 'USDC_POL',
      amount: 25,
      interval: 'monthly',
      max_periods: null,
      periods_completed: 4,
      merchant_id: 'biz_1',
      depositor_address: '0xdep',
      beneficiary_address: '0xben',
      next_charge_at: '2026-01-01T00:00:00Z',
    };

    const order: string[] = [];
    const claimingUpdate = vi.fn(() => {
      order.push('claim');
      return claimChain();
    });
    vi.mocked(createEscrow).mockImplementation(async () => {
      order.push('createEscrow');
      return { success: true, escrow: { id: 'esc_1' } } as any;
    });

    const { supabase } = mockSupabase([series], claimingUpdate);
    await monitorSeries(supabase, new Date('2026-01-02'));

    expect(order[0]).toBe('claim');
    expect(order).toContain('createEscrow');
  });

  it('returns zero stats when no series are due', async () => {
    const { supabase } = mockSupabase([]);
    const stats = await monitorSeries(supabase, new Date());
    expect(stats).toEqual({ checked: 0, created: 0, completed: 0, errors: 0 });
  });

  it('creates next escrow for active due series', async () => {
    const series = {
      id: 'ser_1',
      status: 'active',
      payment_method: 'crypto',
      coin: 'USDC_POL',
      amount: 100,
      interval: 'weekly',
      max_periods: 4,
      periods_completed: 1,
      merchant_id: 'biz_1',
      depositor_address: '0xdep',
      beneficiary_address: '0xben',
      next_charge_at: '2026-01-01T00:00:00Z',
      description: 'test',
    };

    const { supabase } = mockSupabase([series]);
    (createEscrow as any).mockResolvedValue({ success: true, escrow: { id: 'esc_new' } });

    const stats = await monitorSeries(supabase, new Date('2026-01-02'));
    expect(stats.checked).toBe(1);
    expect(stats.created).toBe(1);
    expect(createEscrow).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        chain: 'USDC_POL',
        amount: 100,
        series_id: 'ser_1',
        depositor_address: '0xdep',
        beneficiary_address: '0xben',
      }),
      false,
    );
  });

  it('marks series completed when max_periods reached', async () => {
    const series = {
      id: 'ser_2',
      status: 'active',
      payment_method: 'crypto',
      coin: 'BTC',
      amount: 0.01,
      interval: 'monthly',
      max_periods: 3,
      periods_completed: 3,
      merchant_id: 'biz_1',
      depositor_address: '0xdep',
      beneficiary_address: '0xben',
      next_charge_at: '2026-01-01T00:00:00Z',
    };

    const updateMock = vi.fn(() => claimChain());
    const { supabase } = mockSupabase([series], updateMock);

    const stats = await monitorSeries(supabase, new Date('2026-01-02'));
    expect(stats.completed).toBe(1);
    expect(stats.created).toBe(0);
    expect(createEscrow).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' }),
    );
  });

  it('skips series with missing addresses', async () => {
    const series = {
      id: 'ser_3',
      status: 'active',
      payment_method: 'crypto',
      coin: 'BTC',
      amount: 50,
      interval: 'monthly',
      max_periods: null,
      periods_completed: 0,
      merchant_id: 'biz_1',
      depositor_address: null,
      beneficiary_address: null,
      next_charge_at: '2026-01-01T00:00:00Z',
    };

    const { supabase } = mockSupabase([series]);
    const stats = await monitorSeries(supabase, new Date('2026-01-02'));
    expect(stats.checked).toBe(1);
    expect(stats.created).toBe(0);
    expect(createEscrow).not.toHaveBeenCalled();
  });

  it('counts errors when createEscrow fails', async () => {
    const series = {
      id: 'ser_4',
      status: 'active',
      payment_method: 'crypto',
      coin: 'ETH',
      amount: 1,
      interval: 'biweekly',
      max_periods: 10,
      periods_completed: 2,
      merchant_id: 'biz_1',
      depositor_address: '0xdep',
      beneficiary_address: '0xben',
      next_charge_at: '2026-01-01T00:00:00Z',
    };

    const { supabase } = mockSupabase([series]);
    (createEscrow as any).mockResolvedValue({ success: false, error: 'wallet gen failed' });

    const stats = await monitorSeries(supabase, new Date('2026-01-02'));
    expect(stats.errors).toBe(1);
    expect(stats.created).toBe(0);
  });
});
