import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseAdmin: () => ({ rpc }),
}));

import {
  getAdminUserStats,
  getAdminPlatformStats,
  parseSortKey,
  parseSortDirection,
} from './admin-user-stats';

describe('parseSortKey', () => {
  it('accepts every documented sort key', () => {
    expect(parseSortKey('total_volume_usd')).toBe('total_volume_usd');
    expect(parseSortKey('email')).toBe('email');
  });

  it('rejects anything else so a column name cannot be smuggled through', () => {
    expect(parseSortKey('password_hash')).toBe('last_activity_at');
    expect(parseSortKey('')).toBe('last_activity_at');
    expect(parseSortKey(null)).toBe('last_activity_at');
    expect(parseSortKey(undefined)).toBe('last_activity_at');
  });
});

describe('parseSortDirection', () => {
  it('only asc turns the sort around', () => {
    expect(parseSortDirection('asc')).toBe('asc');
    expect(parseSortDirection('ASC')).toBe('asc');
    expect(parseSortDirection('desc')).toBe('desc');
    expect(parseSortDirection('nonsense')).toBe('desc');
    expect(parseSortDirection(null)).toBe('desc');
  });
});

describe('getAdminUserStats', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps snake_case columns and coerces numeric strings', async () => {
    rpc.mockResolvedValue({
      data: {
        total: '285',
        limit: 50,
        offset: '0',
        rows: [
          {
            id: 'user-1',
            email: 'a@example.com',
            name: 'Acme',
            is_admin: false,
            auth_provider: 'self',
            subscription_plan_id: 'starter',
            subscription_status: 'active',
            created_at: '2026-07-05T00:00:00Z',
            last_login_at: null,
            last_activity_at: '2026-08-10T00:00:00Z',
            businesses_count: 2,
            active_businesses_count: 2,
            payments_total: 479,
            payments_settled: 240,
            // Postgres sends numeric over the wire as a string.
            settled_volume_usd: '14644.50',
            invoices_total: 47,
            invoices_paid: 25,
            invoices_paid_usd: '2908.08',
            invoice_fees_usd: '29.08080000',
            escrows_total: 0,
            escrows_settled: 0,
            escrow_volume_usd: 0,
            stripe_total: 793,
            stripe_completed: 493,
            stripe_volume_usd: '29024.580000000000',
            total_volume_usd: '46577.160000000000',
          },
        ],
      },
      error: null,
    });

    const page = await getAdminUserStats({ search: '  acme  ', sort: 'email', direction: 'asc' });

    expect(page.total).toBe(285);
    const [row] = page.rows;
    expect(row.settledVolumeUsd).toBe(14644.5);
    expect(row.stripeVolumeUsd).toBeCloseTo(29024.58, 2);
    expect(row.totalVolumeUsd).toBeCloseTo(46577.16, 2);
    expect(row.isAdmin).toBe(false);
    expect(row.lastLoginAt).toBeNull();
    expect(row.subscriptionPlanId).toBe('starter');
  });

  it('trims the search term and sends null for a blank one', async () => {
    rpc.mockResolvedValue({ data: { total: 0, rows: [] }, error: null });

    await getAdminUserStats({ search: '   ' });

    expect(rpc).toHaveBeenCalledWith('admin_user_stats', expect.objectContaining({ p_search: null }));
  });

  it('forwards paging and sort arguments to the function', async () => {
    rpc.mockResolvedValue({ data: { total: 0, rows: [] }, error: null });

    await getAdminUserStats({ sort: 'created_at', direction: 'asc', limit: 25, offset: 75 });

    expect(rpc).toHaveBeenCalledWith('admin_user_stats', {
      p_search: null,
      p_sort: 'created_at',
      p_dir: 'asc',
      p_limit: 25,
      p_offset: 75,
    });
  });

  it('tolerates a response with no rows array', async () => {
    rpc.mockResolvedValue({ data: { total: 0 }, error: null });

    await expect(getAdminUserStats()).resolves.toEqual({ rows: [], total: 0, limit: 0, offset: 0 });
  });

  it('throws instead of reporting zero users when the query fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });

    await expect(getAdminUserStats()).rejects.toThrow(/permission denied/);
  });
});

describe('getAdminPlatformStats', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps the platform totals', async () => {
    rpc.mockResolvedValue({
      data: {
        users_total: 285,
        users_new_7d: 19,
        users_new_30d: 81,
        users_active_30d: 13,
        businesses_total: 108,
        businesses_active: 108,
        payments_total: 2212,
        payments_settled: 752,
        payments_volume_usd: '24163.83',
        invoices_total: 105,
        invoices_paid: 27,
        invoices_paid_usd: '3036.78',
        escrows_total: 39,
        escrows_settled: 5,
        escrow_volume_usd: '102.98',
        stripe_completed: 646,
        stripe_volume_usd: '37493.280000000000',
      },
      error: null,
    });

    const stats = await getAdminPlatformStats();

    expect(stats.usersTotal).toBe(285);
    expect(stats.usersNew7d).toBe(19);
    expect(stats.paymentsVolumeUsd).toBe(24163.83);
    expect(stats.stripeVolumeUsd).toBeCloseTo(37493.28, 2);
  });

  it('throws when the function is unreachable', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } });

    await expect(getAdminPlatformStats()).rejects.toThrow(/function does not exist/);
  });
});
