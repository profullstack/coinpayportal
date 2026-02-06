import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSettings, updateSettings, checkTransactionAllowed } from './settings';

// ──────────────────────────────────────────────
// getSettings
// ──────────────────────────────────────────────

describe('getSettings', () => {
  it('should return existing settings', async () => {
    const singleFn = vi.fn().mockResolvedValue({
      data: {
        wallet_id: 'w1',
        daily_spend_limit: 100,
        whitelist_addresses: ['0xabc'],
        whitelist_enabled: true,
        require_confirmation: false,
        confirmation_delay_seconds: 0,
      },
      error: null,
    });
    const eqFn = vi.fn().mockReturnValue({ single: singleFn });
    const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
    const supabase = { from: vi.fn().mockReturnValue({ select: selectFn }) } as any;

    const result = await getSettings(supabase, 'w1');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.wallet_id).toBe('w1');
      expect(result.data.daily_spend_limit).toBe(100);
      expect(result.data.whitelist_addresses).toEqual(['0xabc']);
      expect(result.data.whitelist_enabled).toBe(true);
    }
  });

  it('should create default settings if none exist', async () => {
    // First query returns PGRST116
    const singleSelect = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST116' },
    });
    const eqSelect = vi.fn().mockReturnValue({ single: singleSelect });
    const selectFn = vi.fn().mockReturnValue({ eq: eqSelect });

    // Insert returns default
    const singleInsert = vi.fn().mockResolvedValue({
      data: {
        wallet_id: 'w1',
        daily_spend_limit: null,
        whitelist_addresses: [],
        whitelist_enabled: false,
        require_confirmation: false,
        confirmation_delay_seconds: 0,
      },
      error: null,
    });
    const selectInsert = vi.fn().mockReturnValue({ single: singleInsert });
    const insertFn = vi.fn().mockReturnValue({ select: selectInsert });

    const supabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'wallet_settings') {
          // Return different objects for select vs insert
          return {
            select: selectFn,
            insert: insertFn,
          };
        }
        return {};
      }),
    } as any;

    const result = await getSettings(supabase, 'w1');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.daily_spend_limit).toBeNull();
      expect(result.data.whitelist_addresses).toEqual([]);
      expect(result.data.whitelist_enabled).toBe(false);
    }
  });

  it('should handle DB error', async () => {
    const singleFn = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'DB error' },
    });
    const eqFn = vi.fn().mockReturnValue({ single: singleFn });
    const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
    const supabase = { from: vi.fn().mockReturnValue({ select: selectFn }) } as any;

    const result = await getSettings(supabase, 'w1');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('DB_ERROR');
  });
});

// ──────────────────────────────────────────────
// updateSettings
// ──────────────────────────────────────────────

describe('updateSettings', () => {
  it('should update spend limit', async () => {
    const singleFn = vi.fn().mockResolvedValue({
      data: {
        wallet_id: 'w1',
        daily_spend_limit: 50,
        whitelist_addresses: [],
        whitelist_enabled: false,
        require_confirmation: false,
        confirmation_delay_seconds: 0,
      },
      error: null,
    });
    const selectFn = vi.fn().mockReturnValue({ single: singleFn });
    const upsertFn = vi.fn().mockReturnValue({ select: selectFn });
    const supabase = { from: vi.fn().mockReturnValue({ upsert: upsertFn }) } as any;

    const result = await updateSettings(supabase, 'w1', { daily_spend_limit: 50 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.daily_spend_limit).toBe(50);
    }
  });

  it('should update whitelist', async () => {
    const singleFn = vi.fn().mockResolvedValue({
      data: {
        wallet_id: 'w1',
        daily_spend_limit: null,
        whitelist_addresses: ['0xabc', '0xdef'],
        whitelist_enabled: true,
        require_confirmation: false,
        confirmation_delay_seconds: 0,
      },
      error: null,
    });
    const selectFn = vi.fn().mockReturnValue({ single: singleFn });
    const upsertFn = vi.fn().mockReturnValue({ select: selectFn });
    const supabase = { from: vi.fn().mockReturnValue({ upsert: upsertFn }) } as any;

    const result = await updateSettings(supabase, 'w1', {
      whitelist_addresses: ['0xabc', '0xdef'],
      whitelist_enabled: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.whitelist_addresses).toEqual(['0xabc', '0xdef']);
      expect(result.data.whitelist_enabled).toBe(true);
    }
  });

  it('should reject negative spend limit', async () => {
    const supabase = {} as any;
    const result = await updateSettings(supabase, 'w1', { daily_spend_limit: -10 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('INVALID_LIMIT');
  });

  it('should reject non-number spend limit', async () => {
    const supabase = {} as any;
    const result = await updateSettings(supabase, 'w1', { daily_spend_limit: 'abc' as any });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('INVALID_LIMIT');
  });

  it('should reject negative confirmation delay', async () => {
    const supabase = {} as any;
    const result = await updateSettings(supabase, 'w1', { confirmation_delay_seconds: -5 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('INVALID_DELAY');
  });

  it('should reject empty update', async () => {
    const supabase = {} as any;
    const result = await updateSettings(supabase, 'w1', {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('NO_CHANGES');
  });

  it('should allow null spend limit (disable)', async () => {
    const singleFn = vi.fn().mockResolvedValue({
      data: {
        wallet_id: 'w1',
        daily_spend_limit: null,
        whitelist_addresses: [],
        whitelist_enabled: false,
        require_confirmation: false,
        confirmation_delay_seconds: 0,
      },
      error: null,
    });
    const selectFn = vi.fn().mockReturnValue({ single: singleFn });
    const upsertFn = vi.fn().mockReturnValue({ select: selectFn });
    const supabase = { from: vi.fn().mockReturnValue({ upsert: upsertFn }) } as any;

    const result = await updateSettings(supabase, 'w1', { daily_spend_limit: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.daily_spend_limit).toBeNull();
    }
  });

  it('should handle DB error on upsert', async () => {
    const singleFn = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'DB error' },
    });
    const selectFn = vi.fn().mockReturnValue({ single: singleFn });
    const upsertFn = vi.fn().mockReturnValue({ select: selectFn });
    const supabase = { from: vi.fn().mockReturnValue({ upsert: upsertFn }) } as any;

    const result = await updateSettings(supabase, 'w1', { daily_spend_limit: 100 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('DB_ERROR');
  });
});

// ──────────────────────────────────────────────
// checkTransactionAllowed
// ──────────────────────────────────────────────

describe('checkTransactionAllowed', () => {
  it('should allow transaction when no restrictions set', async () => {
    const singleFn = vi.fn().mockResolvedValue({
      data: {
        wallet_id: 'w1',
        daily_spend_limit: null,
        whitelist_addresses: [],
        whitelist_enabled: false,
        require_confirmation: false,
        confirmation_delay_seconds: 0,
      },
      error: null,
    });
    const eqFn = vi.fn().mockReturnValue({ single: singleFn });
    const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
    const supabase = { from: vi.fn().mockReturnValue({ select: selectFn }) } as any;

    const result = await checkTransactionAllowed(supabase, 'w1', '0xrecipient', 1, 'ETH');
    expect(result.allowed).toBe(true);
  });

  it('should block non-whitelisted address', async () => {
    const singleFn = vi.fn().mockResolvedValue({
      data: {
        wallet_id: 'w1',
        daily_spend_limit: null,
        whitelist_addresses: ['0xapproved'],
        whitelist_enabled: true,
        require_confirmation: false,
        confirmation_delay_seconds: 0,
      },
      error: null,
    });
    const eqFn = vi.fn().mockReturnValue({ single: singleFn });
    const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
    const supabase = { from: vi.fn().mockReturnValue({ select: selectFn }) } as any;

    const result = await checkTransactionAllowed(supabase, 'w1', '0xunknown', 1, 'ETH');
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain('whitelist');
    }
  });

  it('should allow whitelisted address (case insensitive)', async () => {
    const singleFn = vi.fn().mockResolvedValue({
      data: {
        wallet_id: 'w1',
        daily_spend_limit: null,
        whitelist_addresses: ['0xApproved'],
        whitelist_enabled: true,
        require_confirmation: false,
        confirmation_delay_seconds: 0,
      },
      error: null,
    });
    const eqFn = vi.fn().mockReturnValue({ single: singleFn });
    const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
    const supabase = { from: vi.fn().mockReturnValue({ select: selectFn }) } as any;

    const result = await checkTransactionAllowed(supabase, 'w1', '0xapproved', 1, 'ETH');
    expect(result.allowed).toBe(true);
  });

  it('should block if daily spend limit exceeded', async () => {
    // Settings with 1 BTC daily limit
    const singleFn = vi.fn().mockResolvedValue({
      data: {
        wallet_id: 'w1',
        daily_spend_limit: 1,
        whitelist_addresses: [],
        whitelist_enabled: false,
        require_confirmation: false,
        confirmation_delay_seconds: 0,
      },
      error: null,
    });
    const eqFn = vi.fn().mockReturnValue({ single: singleFn });
    const selectFn = vi.fn().mockReturnValue({ eq: eqFn });

    // Today's transactions: already spent 0.8
    const gteResult = vi.fn().mockResolvedValue({
      data: [{ amount: '0.5' }, { amount: '0.3' }],
      error: null,
    });
    const inFn = vi.fn().mockReturnValue({ gte: gteResult });
    const eqDir = vi.fn().mockReturnValue({ in: inFn });
    const eqWalletTx = vi.fn().mockReturnValue({ eq: eqDir });
    const selectTx = vi.fn().mockReturnValue({ eq: eqWalletTx });

    const supabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'wallet_settings') return { select: selectFn };
        if (table === 'wallet_transactions') return { select: selectTx };
        return {};
      }),
    } as any;

    // Try to spend 0.5 more (total would be 1.3 > limit of 1)
    const result = await checkTransactionAllowed(supabase, 'w1', '0xrecipient', 0.5, 'ETH');
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain('Daily spend limit');
    }
  });

  it('should allow if within daily spend limit', async () => {
    const singleFn = vi.fn().mockResolvedValue({
      data: {
        wallet_id: 'w1',
        daily_spend_limit: 10,
        whitelist_addresses: [],
        whitelist_enabled: false,
        require_confirmation: false,
        confirmation_delay_seconds: 0,
      },
      error: null,
    });
    const eqFn = vi.fn().mockReturnValue({ single: singleFn });
    const selectFn = vi.fn().mockReturnValue({ eq: eqFn });

    const gteResult = vi.fn().mockResolvedValue({
      data: [{ amount: '1' }],
      error: null,
    });
    const inFn = vi.fn().mockReturnValue({ gte: gteResult });
    const eqDir = vi.fn().mockReturnValue({ in: inFn });
    const eqWalletTx = vi.fn().mockReturnValue({ eq: eqDir });
    const selectTx = vi.fn().mockReturnValue({ eq: eqWalletTx });

    const supabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'wallet_settings') return { select: selectFn };
        if (table === 'wallet_transactions') return { select: selectTx };
        return {};
      }),
    } as any;

    // Spent 1, trying to spend 2 more (total 3 < limit of 10)
    const result = await checkTransactionAllowed(supabase, 'w1', '0xrecipient', 2, 'ETH');
    expect(result.allowed).toBe(true);
  });

  it('should allow if settings fail to load (fail open)', async () => {
    const singleFn = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'DB error' },
    });
    const eqFn = vi.fn().mockReturnValue({ single: singleFn });
    const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
    const supabase = { from: vi.fn().mockReturnValue({ select: selectFn }) } as any;

    const result = await checkTransactionAllowed(supabase, 'w1', '0xrecipient', 1, 'ETH');
    expect(result.allowed).toBe(true);
  });
});
