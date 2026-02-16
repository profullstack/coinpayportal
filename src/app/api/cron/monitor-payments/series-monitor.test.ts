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

function mockSupabase(seriesRows: any[] = [], updateFn?: ReturnType<typeof vi.fn>) {
  const _update = updateFn || vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) });

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

    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
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
