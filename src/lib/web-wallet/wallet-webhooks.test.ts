import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerWebhook,
  listWebhooks,
  deleteWebhook,
  deliverWebhook,
  VALID_WEBHOOK_EVENTS,
} from './wallet-webhooks';

// ── Mock Supabase ──

function mockChain(returnData: any = null, returnError: any = null, count: number | null = null) {
  const chain: any = {
    _data: returnData,
    _error: returnError,
    _count: count,
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: returnData, error: returnError }),
  };
  // For head queries (count)
  chain.select.mockImplementation((_cols: string, opts?: any) => {
    if (opts?.head) {
      return { ...chain, then: undefined, eq: vi.fn().mockResolvedValue({ count, error: null }) };
    }
    return chain;
  });
  return chain;
}

function createMockSupabase(chains: Record<string, any> = {}) {
  return {
    from: vi.fn((table: string) => {
      if (chains[table]) return chains[table];
      return mockChain();
    }),
  } as any;
}

// ── Mock fetch ──

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Wallet Webhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('registerWebhook', () => {
    it('should reject non-HTTPS URLs', async () => {
      const supabase = createMockSupabase();
      const result = await registerWebhook(supabase, 'w1', {
        url: 'http://example.com/webhook',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('INVALID_URL');
      }
    });

    it('should reject invalid event types', async () => {
      const supabase = createMockSupabase();
      const result = await registerWebhook(supabase, 'w1', {
        url: 'https://example.com/webhook',
        events: ['invalid.event' as any],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('INVALID_EVENT');
      }
    });

    it('should register a webhook with default events', async () => {
      const insertedData = {
        id: 'wh-1',
        wallet_id: 'w1',
        url: 'https://example.com/webhook',
        events: VALID_WEBHOOK_EVENTS,
        secret: 'generated-secret',
        is_active: true,
        last_delivered_at: null,
        last_error: null,
        consecutive_failures: 0,
        created_at: '2024-01-01T00:00:00Z',
      };

      const chain: any = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        eq: vi.fn(),
        single: vi.fn().mockResolvedValue({ data: insertedData, error: null }),
      };

      // Count query returns 0
      chain.select.mockImplementation((_cols: string, opts?: any) => {
        if (opts?.head) {
          return { eq: vi.fn().mockResolvedValue({ count: 0, error: null }) };
        }
        return chain;
      });

      // Insert chain
      chain.insert.mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: insertedData, error: null }) }) });

      const supabase = createMockSupabase({ wallet_webhooks: chain });

      const result = await registerWebhook(supabase, 'w1', {
        url: 'https://example.com/webhook',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.url).toBe('https://example.com/webhook');
        expect(result.data.events).toEqual(VALID_WEBHOOK_EVENTS);
        expect(result.data.secret).toBeTruthy();
      }
    });

    it('should reject duplicate URLs', async () => {
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        eq: vi.fn(),
        single: vi.fn(),
      };

      chain.select.mockImplementation((_cols: string, opts?: any) => {
        if (opts?.head) {
          return { eq: vi.fn().mockResolvedValue({ count: 1, error: null }) };
        }
        return chain;
      });

      chain.insert.mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'duplicate' },
          }),
        }),
      });

      const supabase = createMockSupabase({ wallet_webhooks: chain });

      const result = await registerWebhook(supabase, 'w1', {
        url: 'https://example.com/webhook',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('DUPLICATE_URL');
      }
    });

    it('should enforce max 5 webhooks per wallet', async () => {
      const chain: any = {
        select: vi.fn().mockImplementation((_cols: string, opts?: any) => {
          if (opts?.head) {
            return { eq: vi.fn().mockResolvedValue({ count: 5, error: null }) };
          }
          return chain;
        }),
      };

      const supabase = createMockSupabase({ wallet_webhooks: chain });

      const result = await registerWebhook(supabase, 'w1', {
        url: 'https://example.com/webhook',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('WEBHOOK_LIMIT');
      }
    });
  });

  describe('listWebhooks', () => {
    it('should return all webhooks for a wallet', async () => {
      const webhooks = [
        {
          id: 'wh-1',
          wallet_id: 'w1',
          url: 'https://example.com/hook1',
          events: ['transaction.incoming'],
          is_active: true,
          last_delivered_at: null,
          last_error: null,
          consecutive_failures: 0,
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'wh-2',
          wallet_id: 'w1',
          url: 'https://example.com/hook2',
          events: ['balance.changed'],
          is_active: true,
          last_delivered_at: null,
          last_error: null,
          consecutive_failures: 0,
          created_at: '2024-01-02T00:00:00Z',
        },
      ];

      const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: webhooks, error: null }),
      };

      const supabase = createMockSupabase({ wallet_webhooks: chain });

      const result = await listWebhooks(supabase, 'w1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
        expect(result.data[0].url).toBe('https://example.com/hook1');
        expect(result.data[1].url).toBe('https://example.com/hook2');
      }
    });

    it('should return empty array when no webhooks', async () => {
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      };

      const supabase = createMockSupabase({ wallet_webhooks: chain });

      const result = await listWebhooks(supabase, 'w1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(0);
      }
    });
  });

  describe('deleteWebhook', () => {
    it('should delete a webhook', async () => {
      const chain: any = {
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
      // Last eq call returns the result
      let eqCallCount = 0;
      chain.eq.mockImplementation(() => {
        eqCallCount++;
        if (eqCallCount >= 2) {
          return Promise.resolve({ error: null, count: 1 });
        }
        return chain;
      });

      const supabase = createMockSupabase({ wallet_webhooks: chain });

      const result = await deleteWebhook(supabase, 'w1', 'wh-1');

      expect(result.success).toBe(true);
    });

    it('should return error when webhook not found', async () => {
      const chain: any = {
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
      let eqCallCount = 0;
      chain.eq.mockImplementation(() => {
        eqCallCount++;
        if (eqCallCount >= 2) {
          return Promise.resolve({ error: null, count: 0 });
        }
        return chain;
      });

      const supabase = createMockSupabase({ wallet_webhooks: chain });

      const result = await deleteWebhook(supabase, 'w1', 'wh-missing');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('WEBHOOK_NOT_FOUND');
      }
    });
  });

  describe('deliverWebhook', () => {
    it('should deliver payload to matching webhooks', async () => {
      const webhooks = [
        {
          id: 'wh-1',
          wallet_id: 'w1',
          url: 'https://example.com/hook',
          events: ['transaction.incoming'],
          secret: 'secret123',
          is_active: true,
          consecutive_failures: 0,
        },
      ];

      const chain: any = {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };

      // select -> eq(wallet_id) -> eq(is_active) returns webhooks
      let selectEqCount = 0;
      chain.eq.mockImplementation(() => {
        selectEqCount++;
        if (selectEqCount === 2) {
          return Promise.resolve({ data: webhooks, error: null });
        }
        // For update calls, chain continues
        return chain;
      });

      const supabase = createMockSupabase({ wallet_webhooks: chain });

      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const result = await deliverWebhook(supabase, 'w1', 'transaction.incoming', {
        transaction: { id: 'tx-1' },
      });

      expect(result.delivered).toBe(1);
      expect(result.failed).toBe(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://example.com/hook');
      expect(opts.method).toBe('POST');
      expect(opts.headers['X-Webhook-Signature']).toBeTruthy();
      expect(opts.headers['X-Webhook-Event']).toBe('transaction.incoming');
    });

    it('should skip webhooks not subscribed to the event', async () => {
      const webhooks = [
        {
          id: 'wh-1',
          wallet_id: 'w1',
          url: 'https://example.com/hook',
          events: ['balance.changed'],
          secret: 'secret123',
          is_active: true,
          consecutive_failures: 0,
        },
      ];

      const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
      let eqCount = 0;
      chain.eq.mockImplementation(() => {
        eqCount++;
        if (eqCount === 2) {
          return Promise.resolve({ data: webhooks, error: null });
        }
        return chain;
      });

      const supabase = createMockSupabase({ wallet_webhooks: chain });

      const result = await deliverWebhook(supabase, 'w1', 'transaction.incoming', {});

      expect(result.delivered).toBe(0);
      expect(result.failed).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should track failures and disable after 10 consecutive', async () => {
      const webhooks = [
        {
          id: 'wh-1',
          wallet_id: 'w1',
          url: 'https://example.com/hook',
          events: ['transaction.incoming'],
          secret: 'secret123',
          is_active: true,
          consecutive_failures: 9,
        },
      ];

      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      const chain: any = {
        select: vi.fn().mockReturnThis(),
        update: updateMock,
        eq: vi.fn().mockReturnThis(),
      };
      let eqCount = 0;
      chain.eq.mockImplementation(() => {
        eqCount++;
        if (eqCount === 2) {
          return Promise.resolve({ data: webhooks, error: null });
        }
        return chain;
      });

      const supabase = createMockSupabase({ wallet_webhooks: chain });

      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await deliverWebhook(supabase, 'w1', 'transaction.incoming', {});

      expect(result.failed).toBe(1);
      // Should disable (failures = 10 >= 10)
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          consecutive_failures: 10,
          is_active: false,
        })
      );
    });

    it('should return 0/0 when no webhooks exist', async () => {
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
      let eqCount = 0;
      chain.eq.mockImplementation(() => {
        eqCount++;
        if (eqCount === 2) {
          return Promise.resolve({ data: [], error: null });
        }
        return chain;
      });

      const supabase = createMockSupabase({ wallet_webhooks: chain });

      const result = await deliverWebhook(supabase, 'w1', 'transaction.incoming', {});

      expect(result.delivered).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  describe('VALID_WEBHOOK_EVENTS', () => {
    it('should contain all three event types', () => {
      expect(VALID_WEBHOOK_EVENTS).toContain('transaction.incoming');
      expect(VALID_WEBHOOK_EVENTS).toContain('transaction.confirmed');
      expect(VALID_WEBHOOK_EVENTS).toContain('balance.changed');
      expect(VALID_WEBHOOK_EVENTS).toHaveLength(3);
    });
  });
});
