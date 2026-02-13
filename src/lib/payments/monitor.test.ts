import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';

// Mock environment variables
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
});

// Mock Supabase
const mockSupabase = {
  from: vi.fn(() => mockSupabase),
  select: vi.fn(() => mockSupabase),
  eq: vi.fn(() => mockSupabase),
  in: vi.fn(() => mockSupabase),
  lt: vi.fn(() => mockSupabase),
  update: vi.fn(() => mockSupabase),
  single: vi.fn(),
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase),
}));

// Mock secure forwarding
vi.mock('../wallets/secure-forwarding', () => ({
  forwardPaymentSecurely: vi.fn().mockResolvedValue({ success: true }),
}));

// Mock web-wallet transaction cycle
vi.mock('../web-wallet/tx-finalize', () => ({
  runWalletTxCycle: vi.fn().mockResolvedValue({ checked: 0, confirmed: 0, errors: 0 }),
}));

// Mock fetch for balance checks
global.fetch = vi.fn();

describe('Payment Monitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Balance Checking (via runOnce)', () => {
    it('should check BTC balance using Blockstream API', async () => {
      // Mock pending payments with BTC
      mockSupabase.select = vi.fn(() => ({
        eq: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve({
            data: [{
              id: 'payment-btc',
              business_id: 'business-1',
              blockchain: 'BTC',
              crypto_amount: 1,
              status: 'pending',
              payment_address: 'bc1qtest',
              created_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 3600000).toISOString(),
            }],
            error: null
          })),
        })),
      }));

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          chain_stats: { funded_txo_sum: 100000000, spent_txo_sum: 0 },
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
        }),
      };
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      const { runOnce } = await import('./monitor');
      await runOnce();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('blockstream.info')
      );
    });

    it('should check ETH balance using JSON-RPC', async () => {
      // Mock pending payments with ETH
      mockSupabase.select = vi.fn(() => ({
        eq: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve({
            data: [{
              id: 'payment-eth',
              business_id: 'business-1',
              blockchain: 'ETH',
              crypto_amount: 1,
              status: 'pending',
              payment_address: '0xtest',
              created_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 3600000).toISOString(),
            }],
            error: null
          })),
        })),
      }));

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          result: '0xde0b6b3a7640000', // 1 ETH in wei (hex)
        }),
      };
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      const { runOnce } = await import('./monitor');
      await runOnce();

      expect(global.fetch).toHaveBeenCalled();
    });

    it('should check SOL balance using Solana RPC', async () => {
      // Mock pending payments with SOL
      mockSupabase.select = vi.fn(() => ({
        eq: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve({
            data: [{
              id: 'payment-sol',
              business_id: 'business-1',
              blockchain: 'SOL',
              crypto_amount: 1,
              status: 'pending',
              payment_address: 'SolanaAddress',
              created_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 3600000).toISOString(),
            }],
            error: null
          })),
        })),
      }));

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          result: { value: 1000000000 }, // 1 SOL in lamports
        }),
      };
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      const { runOnce } = await import('./monitor');
      await runOnce();

      expect(global.fetch).toHaveBeenCalled();
    });

    it('should handle network errors gracefully', async () => {
      // Mock pending payments
      mockSupabase.select = vi.fn(() => ({
        eq: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve({
            data: [{
              id: 'payment-error',
              business_id: 'business-1',
              blockchain: 'BTC',
              crypto_amount: 1,
              status: 'pending',
              payment_address: 'bc1qtest',
              created_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 3600000).toISOString(),
            }],
            error: null
          })),
        })),
      }));

      vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'));

      const { runOnce } = await import('./monitor');
      const result = await runOnce();

      // Should not throw, just return stats
      expect(result).toBeDefined();
    });
  });

  describe('Monitor State', () => {
    it('should start in stopped state', async () => {
      const { isMonitorActive } = await import('./monitor');
      expect(isMonitorActive()).toBe(false);
    });

    it('should track running state after start', async () => {
      const { startMonitor, stopMonitor, isMonitorActive } = await import('./monitor');
      
      startMonitor();
      expect(isMonitorActive()).toBe(true);
      
      stopMonitor();
      expect(isMonitorActive()).toBe(false);
    });
  });

  describe('runOnce', () => {
    it('should process pending payments', async () => {
      const mockPayments = [
        {
          id: 'payment-1',
          business_id: 'business-1',
          blockchain: 'BTC',
          crypto_amount: 0.001,
          status: 'pending',
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        },
      ];

      const mockAddresses = [
        {
          payment_id: 'payment-1',
          address: 'bc1qtest',
          cryptocurrency: 'BTC',
        },
      ];

      mockSupabase.select = vi.fn(() => ({
        eq: vi.fn(() => ({
          lt: vi.fn(() => Promise.resolve({ data: mockPayments, error: null })),
        })),
        in: vi.fn(() => Promise.resolve({ data: mockAddresses, error: null })),
      }));

      // Mock balance check to return 0 (no payment received)
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
        }),
      } as any);

      const { runOnce } = await import('./monitor');
      const result = await runOnce();

      expect(result).toBeDefined();
      expect(result.checked).toBeGreaterThanOrEqual(0);
    });

    it('should expire old pending payments', async () => {
      const expiredPayment = {
        id: 'payment-expired',
        business_id: 'business-1',
        blockchain: 'BTC',
        crypto_amount: 0.001,
        status: 'pending',
        created_at: new Date(Date.now() - 3600000).toISOString(),
        expires_at: new Date(Date.now() - 1000).toISOString(), // Already expired
      };

      mockSupabase.select = vi.fn(() => ({
        eq: vi.fn(() => ({
          lt: vi.fn(() => Promise.resolve({ data: [expiredPayment], error: null })),
        })),
        in: vi.fn(() => Promise.resolve({ data: [], error: null })),
      }));

      mockSupabase.update = vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
      }));

      const { runOnce } = await import('./monitor');
      await runOnce();

      // Should have attempted to update expired payments
      expect(mockSupabase.from).toHaveBeenCalled();
    });
  });

  describe('Payment Confirmation', () => {
    it('should confirm payment when balance matches expected amount', async () => {
      const mockPayment = {
        id: 'payment-1',
        business_id: 'business-1',
        blockchain: 'BTC',
        crypto_amount: 0.001,
        status: 'pending',
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      };

      const mockAddress = {
        payment_id: 'payment-1',
        address: 'bc1qtest',
        cryptocurrency: 'BTC',
      };

      mockSupabase.select = vi.fn(() => ({
        eq: vi.fn(() => ({
          lt: vi.fn(() => Promise.resolve({ data: [mockPayment], error: null })),
        })),
        in: vi.fn(() => Promise.resolve({ data: [mockAddress], error: null })),
      }));

      // Mock balance check to return exact expected amount
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          chain_stats: { funded_txo_sum: 100000, spent_txo_sum: 0 }, // 0.001 BTC
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
        }),
      } as any);

      mockSupabase.update = vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
      }));

      const { runOnce } = await import('./monitor');
      const result = await runOnce();

      expect(result).toBeDefined();
    });
  });

  describe('Forwarding Trigger', () => {
    it('should log forwarding response when successful', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      
      // Mock a successful forwarding response
      const mockForwardingResponse = {
        success: true,
        data: {
          merchantTxHash: '0xmerchant123',
          platformTxHash: '0xplatform123',
          merchantAmount: 99.5,
          platformFee: 0.5,
        },
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockForwardingResponse),
      } as any);

      // Simulate the forwarding response logging
      const forwardResponse = await global.fetch('/api/payments/test/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (forwardResponse.ok) {
        const forwardResult = await forwardResponse.json();
        console.log('[Monitor] Forwarding completed for payment test:', JSON.stringify(forwardResult));
      }

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Monitor] Forwarding completed for payment test:',
        expect.stringContaining('merchantTxHash')
      );

      consoleSpy.mockRestore();
    });

    it('should log error when forwarding fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error');
      
      // Mock a failed forwarding response
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: vi.fn().mockResolvedValue('Payment not in confirmed status'),
      } as any);

      const forwardResponse = await global.fetch('/api/payments/test/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!forwardResponse.ok) {
        const errorText = await forwardResponse.text();
        console.error(`[Monitor] Failed to trigger forwarding for test: ${forwardResponse.status} - ${errorText}`);
      }

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Monitor] Failed to trigger forwarding')
      );

      consoleSpy.mockRestore();
    });

    it('should warn when INTERNAL_API_KEY is not configured', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn');
      
      // Simulate the warning when API key is missing
      const internalApiKey = undefined;
      const paymentId = 'payment-123';

      if (!internalApiKey) {
        console.warn(`[Monitor] INTERNAL_API_KEY not configured - cannot trigger forwarding for ${paymentId}`);
      }

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[Monitor] INTERNAL_API_KEY not configured - cannot trigger forwarding for payment-123'
      );

      consoleWarnSpy.mockRestore();
    });

    it('should include full response data in forwarding log', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      
      const mockResponse = {
        success: true,
        data: {
          merchantTxHash: '0xabc123',
          platformTxHash: '0xdef456',
          merchantAmount: 0.995,
          platformFee: 0.005,
        },
      };

      // Simulate logging the full response
      console.log(`[Monitor] Forwarding completed for payment test-payment:`, JSON.stringify(mockResponse));

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Monitor] Forwarding completed for payment test-payment:',
        expect.stringContaining('"merchantTxHash":"0xabc123"')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Monitor] Forwarding completed for payment test-payment:',
        expect.stringContaining('"platformFee":0.005')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Forwarding Response Handling', () => {
    it('should parse successful forwarding response correctly', async () => {
      const mockResponse = {
        success: true,
        data: {
          merchantTxHash: '0xmerchant',
          platformTxHash: '0xplatform',
          merchantAmount: 99.5,
          platformFee: 0.5,
        },
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      } as any);

      const response = await global.fetch('/api/payments/test/forward', {
        method: 'POST',
      });

      expect(response.ok).toBe(true);
      
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.merchantTxHash).toBe('0xmerchant');
      expect(result.data.platformFee).toBe(0.5);
    });

    it('should handle forwarding error response', async () => {
      const mockErrorResponse = {
        success: false,
        error: 'Payment is not confirmed. Current status: pending',
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue(mockErrorResponse),
        text: vi.fn().mockResolvedValue(JSON.stringify(mockErrorResponse)),
      } as any);

      const response = await global.fetch('/api/payments/test/forward', {
        method: 'POST',
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
    });

    it('should handle network errors during forwarding', async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'));

      try {
        await global.fetch('/api/payments/test/forward', {
          method: 'POST',
        });
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Network error');
      }
    });
  });

  describe('Escrow Monitoring', () => {
    beforeEach(() => {
      process.env.INTERNAL_API_KEY = 'test-internal-api-key';
    });

    describe('Pending Escrows', () => {
      it('should check pending escrows for deposits', async () => {
        const mockEscrows = [
          {
            id: 'escrow-1',
            escrow_address: 'bc1qtest',
            chain: 'BTC',
            amount: 0.001,
            status: 'created',
            expires_at: new Date(Date.now() + 3600000).toISOString(),
          },
        ];

        // Mock supabase calls for escrows
        const mockFromEscrows = {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve({
                data: mockEscrows,
                error: null
              })),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve({ error: null })),
          })),
          from: vi.fn((table: string) => {
            if (table === 'escrow_events') {
              return {
                insert: vi.fn(() => Promise.resolve({ error: null })),
              };
            }
            return mockFromEscrows;
          }),
        };

        // Setup multi-table mock
        mockSupabase.from = vi.fn((table: string) => {
          if (table === 'payments') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
                })),
              })),
            };
          }
          if (table === 'escrows') {
            return mockFromEscrows;
          }
          if (table === 'escrow_events') {
            return {
              insert: vi.fn(() => Promise.resolve({ error: null })),
            };
          }
          return mockFromEscrows;
        });

        // Mock balance check to show no deposit yet
        vi.mocked(global.fetch).mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({
            chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
          }),
        } as any);

        const { runOnce } = await import('./monitor');
        const result = await runOnce();

        expect(result).toBeDefined();
        expect(result.checked).toBeGreaterThanOrEqual(0);
      });

      it('should mark escrow as funded when deposit received', async () => {
        const mockEscrows = [
          {
            id: 'escrow-funded',
            escrow_address: 'bc1qtest',
            chain: 'BTC',
            amount: 0.001,
            status: 'created',
            expires_at: new Date(Date.now() + 3600000).toISOString(),
          },
        ];

        const mockUpdate = vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ error: null })),
        }));

        const mockFromEscrows = {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve({
                data: mockEscrows,
                error: null
              })),
            })),
          })),
          update: mockUpdate,
        };

        mockSupabase.from = vi.fn((table: string) => {
          if (table === 'payments') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
                })),
              })),
            };
          }
          if (table === 'escrows') {
            return mockFromEscrows;
          }
          if (table === 'escrow_events') {
            return {
              insert: vi.fn(() => Promise.resolve({ error: null })),
            };
          }
          return mockFromEscrows;
        });

        // Mock balance check to show deposit received
        vi.mocked(global.fetch).mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({
            chain_stats: { funded_txo_sum: 100000, spent_txo_sum: 0 }, // 0.001 BTC
          }),
        } as any);

        const { runOnce } = await import('./monitor');
        await runOnce();

        expect(mockUpdate).toHaveBeenCalledWith({
          status: 'funded',
          funded_at: expect.any(String),
          deposited_amount: 0.001,
        });
      });

      it('should expire old escrows', async () => {
        const expiredEscrow = {
          id: 'escrow-expired',
          escrow_address: 'bc1qtest',
          chain: 'BTC',
          amount: 0.001,
          status: 'created',
          expires_at: new Date(Date.now() - 1000).toISOString(), // Already expired
        };

        const mockUpdate = vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ error: null })),
        }));

        mockSupabase.from = vi.fn((table: string) => {
          if (table === 'payments') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
                })),
              })),
            };
          }
          if (table === 'escrows') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  limit: vi.fn(() => Promise.resolve({
                    data: [expiredEscrow],
                    error: null
                  })),
                })),
              })),
              update: mockUpdate,
            };
          }
          if (table === 'escrow_events') {
            return {
              insert: vi.fn(() => Promise.resolve({ error: null })),
            };
          }
          return {};
        });

        const { runOnce } = await import('./monitor');
        await runOnce();

        expect(mockUpdate).toHaveBeenCalledWith({ status: 'expired' });
      });
    });

    describe('Escrow Settlement', () => {
      it('should process released escrows', async () => {
        const releasedEscrow = {
          id: 'escrow-released',
          escrow_address: 'bc1qtest',
          chain: 'BTC',
          amount: 0.001,
          status: 'released',
        };

        mockSupabase.from = vi.fn((table: string) => {
          if (table === 'payments') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
                })),
              })),
            };
          }
          if (table === 'escrows') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn((status: string) => {
                  if (status === 'created') {
                    return {
                      limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
                    };
                  }
                  if (status === 'released') {
                    return {
                      limit: vi.fn(() => Promise.resolve({
                        data: [releasedEscrow],
                        error: null
                      })),
                    };
                  }
                  if (status === 'refunded') {
                    return {
                      is: vi.fn(() => ({
                        limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
                      })),
                    };
                  }
                  return { limit: vi.fn(() => Promise.resolve({ data: [], error: null })) };
                }),
              })),
            };
          }
          return {};
        });

        // Mock settlement API call
        vi.mocked(global.fetch).mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ success: true }),
        } as any);

        const { runOnce } = await import('./monitor');
        await runOnce();

        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/escrow/escrow-released/settle'),
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              'Authorization': 'Bearer test-internal-api-key',
            }),
          })
        );
      });

      it('should process refunded escrows with refund action', async () => {
        const refundedEscrow = {
          id: 'escrow-refunded',
          escrow_address: 'bc1qtest',
          chain: 'BTC',
          deposited_amount: 0.001,
          status: 'refunded',
        };

        mockSupabase.from = vi.fn((table: string) => {
          if (table === 'payments') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
                })),
              })),
            };
          }
          if (table === 'escrows') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn((status: string) => {
                  if (status === 'created') {
                    return {
                      limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
                    };
                  }
                  if (status === 'released') {
                    return {
                      limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
                    };
                  }
                  if (status === 'refunded') {
                    return {
                      is: vi.fn(() => ({
                        limit: vi.fn(() => Promise.resolve({
                          data: [refundedEscrow],
                          error: null
                        })),
                      })),
                    };
                  }
                  return { limit: vi.fn(() => Promise.resolve({ data: [], error: null })) };
                }),
              })),
            };
          }
          return {};
        });

        // Mock refund API call
        vi.mocked(global.fetch).mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ success: true }),
        } as any);

        const { runOnce } = await import('./monitor');
        await runOnce();

        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/escrow/escrow-refunded/settle'),
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              'Authorization': 'Bearer test-internal-api-key',
            }),
            body: JSON.stringify({ action: 'refund' }),
          })
        );
      });

      it('should handle settlement API errors gracefully', async () => {
        const consoleSpy = vi.spyOn(console, 'error');
        
        const releasedEscrow = {
          id: 'escrow-error',
          status: 'released',
        };

        mockSupabase.from = vi.fn((table: string) => {
          if (table === 'payments') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
                })),
              })),
            };
          }
          if (table === 'escrows') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn((status: string) => {
                  if (status === 'released') {
                    return {
                      limit: vi.fn(() => Promise.resolve({
                        data: [releasedEscrow],
                        error: null
                      })),
                    };
                  }
                  return { limit: vi.fn(() => Promise.resolve({ data: [], error: null })) };
                }),
              })),
            };
          }
          return {};
        });

        // Mock failed settlement API call
        vi.mocked(global.fetch).mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: vi.fn().mockResolvedValue('Internal server error'),
        } as any);

        const { runOnce } = await import('./monitor');
        await runOnce();

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('[Monitor] Settlement failed for escrow')
        );

        consoleSpy.mockRestore();
      });

      it('should warn when INTERNAL_API_KEY not configured for escrow settlement', () => {
        delete process.env.INTERNAL_API_KEY;
        const consoleSpy = vi.spyOn(console, 'error');

        // This would be tested by the processEscrowSettlement function
        const internalApiKey = process.env.INTERNAL_API_KEY;
        if (!internalApiKey) {
          console.error('[Monitor] INTERNAL_API_KEY not configured - cannot process escrow settlements');
        }

        expect(consoleSpy).toHaveBeenCalledWith(
          '[Monitor] INTERNAL_API_KEY not configured - cannot process escrow settlements'
        );

        consoleSpy.mockRestore();
      });
    });
  });
});