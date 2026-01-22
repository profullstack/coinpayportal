import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createMerchantWallet,
  listMerchantWallets,
  getMerchantWallet,
  updateMerchantWallet,
  deleteMerchantWallet,
  importWalletsToBusiness,
} from './merchant-service';

// Mock Supabase client
const createMockSupabase = () => {
  const mockEq = vi.fn().mockReturnThis();
  const mockIn = vi.fn().mockReturnThis();
  const mockSingle = vi.fn();
  const mockOrder = vi.fn().mockReturnThis();

  const mockSelect = vi.fn(() => ({
    eq: mockEq,
    in: mockIn,
    single: mockSingle,
    order: mockOrder,
  }));

  const mockInsert = vi.fn(() => ({
    select: mockSelect,
  }));

  const mockUpdate = vi.fn(() => ({
    eq: mockEq,
    select: mockSelect,
  }));

  const mockDelete = vi.fn(() => ({
    eq: mockEq,
  }));

  return {
    from: vi.fn(() => ({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
      delete: mockDelete,
    })),
    _mocks: {
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
      delete: mockDelete,
      eq: mockEq,
      in: mockIn,
      single: mockSingle,
      order: mockOrder,
    },
  };
};

describe('Merchant Wallet Service', () => {
  let mockSupabase: any;
  const merchantId = 'merchant-123';
  const businessId = 'business-123';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
  });

  describe('createMerchantWallet', () => {
    it('should create a merchant wallet successfully', async () => {
      const walletData = {
        cryptocurrency: 'BTC' as const,
        wallet_address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        label: 'Main BTC Wallet',
      };

      const expectedWallet = {
        id: 'wallet-123',
        merchant_id: merchantId,
        cryptocurrency: 'BTC',
        wallet_address: walletData.wallet_address,
        label: walletData.label,
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      // Mock existing wallet check
      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      // Mock wallet creation
      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: expectedWallet,
        error: null,
      });

      const result = await createMerchantWallet(mockSupabase, merchantId, walletData);

      expect(result.success).toBe(true);
      expect(result.wallet).toEqual(expectedWallet);
      expect(mockSupabase.from).toHaveBeenCalledWith('merchant_wallets');
    });

    it('should create wallet without label', async () => {
      const walletData = {
        cryptocurrency: 'ETH' as const,
        wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1234',
      };

      const expectedWallet = {
        id: 'wallet-123',
        merchant_id: merchantId,
        cryptocurrency: 'ETH',
        wallet_address: walletData.wallet_address,
        label: null,
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: expectedWallet,
        error: null,
      });

      const result = await createMerchantWallet(mockSupabase, merchantId, walletData);

      expect(result.success).toBe(true);
      expect(result.wallet?.label).toBeNull();
    });

    it('should reject invalid cryptocurrency', async () => {
      const walletData = {
        cryptocurrency: 'INVALID' as any,
        wallet_address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      };

      const result = await createMerchantWallet(mockSupabase, merchantId, walletData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid cryptocurrency');
    });

    it('should reject invalid wallet address', async () => {
      const walletData = {
        cryptocurrency: 'BTC' as const,
        wallet_address: 'short',
      };

      const result = await createMerchantWallet(mockSupabase, merchantId, walletData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid wallet address');
    });

    it('should reject if wallet already exists', async () => {
      const walletData = {
        cryptocurrency: 'BTC' as const,
        wallet_address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      };

      // Mock existing wallet check - wallet exists
      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: { id: 'existing-wallet' },
        error: null,
      });

      const result = await createMerchantWallet(mockSupabase, merchantId, walletData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });
  });

  describe('listMerchantWallets', () => {
    it('should list all wallets for a merchant', async () => {
      const expectedWallets = [
        {
          id: 'wallet-1',
          merchant_id: merchantId,
          cryptocurrency: 'BTC',
          wallet_address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
          label: 'Main BTC',
          is_active: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'wallet-2',
          merchant_id: merchantId,
          cryptocurrency: 'ETH',
          wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1234',
          label: null,
          is_active: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ];

      mockSupabase._mocks.order.mockResolvedValueOnce({
        data: expectedWallets,
        error: null,
      });

      const result = await listMerchantWallets(mockSupabase, merchantId);

      expect(result.success).toBe(true);
      expect(result.wallets).toEqual(expectedWallets);
      expect(result.wallets).toHaveLength(2);
    });

    it('should return empty array if no wallets', async () => {
      mockSupabase._mocks.order.mockResolvedValueOnce({
        data: [],
        error: null,
      });

      const result = await listMerchantWallets(mockSupabase, merchantId);

      expect(result.success).toBe(true);
      expect(result.wallets).toEqual([]);
    });

    it('should handle database errors', async () => {
      mockSupabase._mocks.order.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database error' },
      });

      const result = await listMerchantWallets(mockSupabase, merchantId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });
  });

  describe('getMerchantWallet', () => {
    it('should get a specific wallet', async () => {
      const expectedWallet = {
        id: 'wallet-123',
        merchant_id: merchantId,
        cryptocurrency: 'BTC',
        wallet_address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        label: 'Main BTC',
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: expectedWallet,
        error: null,
      });

      const result = await getMerchantWallet(mockSupabase, merchantId, 'BTC');

      expect(result.success).toBe(true);
      expect(result.wallet).toEqual(expectedWallet);
    });

    it('should reject invalid cryptocurrency', async () => {
      const result = await getMerchantWallet(mockSupabase, merchantId, 'INVALID' as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid cryptocurrency');
    });

    it('should return error if wallet not found', async () => {
      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Wallet not found' },
      });

      const result = await getMerchantWallet(mockSupabase, merchantId, 'BTC');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('updateMerchantWallet', () => {
    it('should update wallet address', async () => {
      const updateData = {
        wallet_address: 'bc1qnew2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      };

      const expectedWallet = {
        id: 'wallet-123',
        merchant_id: merchantId,
        cryptocurrency: 'BTC',
        wallet_address: updateData.wallet_address,
        label: 'Main BTC',
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: expectedWallet,
        error: null,
      });

      const result = await updateMerchantWallet(mockSupabase, merchantId, 'BTC', updateData);

      expect(result.success).toBe(true);
      expect(result.wallet?.wallet_address).toBe(updateData.wallet_address);
    });

    it('should update wallet label', async () => {
      const updateData = {
        label: 'Updated Label',
      };

      const expectedWallet = {
        id: 'wallet-123',
        merchant_id: merchantId,
        cryptocurrency: 'BTC',
        wallet_address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        label: updateData.label,
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: expectedWallet,
        error: null,
      });

      const result = await updateMerchantWallet(mockSupabase, merchantId, 'BTC', updateData);

      expect(result.success).toBe(true);
      expect(result.wallet?.label).toBe(updateData.label);
    });

    it('should update active status', async () => {
      const updateData = {
        is_active: false,
      };

      const expectedWallet = {
        id: 'wallet-123',
        merchant_id: merchantId,
        cryptocurrency: 'BTC',
        wallet_address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        label: 'Main BTC',
        is_active: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: expectedWallet,
        error: null,
      });

      const result = await updateMerchantWallet(mockSupabase, merchantId, 'BTC', updateData);

      expect(result.success).toBe(true);
      expect(result.wallet?.is_active).toBe(false);
    });

    it('should reject invalid wallet address', async () => {
      const updateData = {
        wallet_address: 'short',
      };

      const result = await updateMerchantWallet(mockSupabase, merchantId, 'BTC', updateData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid wallet address');
    });

    it('should reject invalid cryptocurrency', async () => {
      const updateData = {
        is_active: false,
      };

      const result = await updateMerchantWallet(mockSupabase, merchantId, 'INVALID' as any, updateData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid cryptocurrency');
    });
  });

  describe('deleteMerchantWallet', () => {
    it('should delete a wallet successfully', async () => {
      const mockEqChain = vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }));

      const mockDelete = vi.fn(() => ({
        eq: mockEqChain,
      }));

      const testSupabase = {
        from: vi.fn(() => ({
          delete: mockDelete,
        })),
      };

      const result = await deleteMerchantWallet(testSupabase as any, merchantId, 'BTC');

      expect(result.success).toBe(true);
    });

    it('should reject invalid cryptocurrency', async () => {
      const result = await deleteMerchantWallet(mockSupabase, merchantId, 'INVALID' as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid cryptocurrency');
    });

    it('should handle deletion errors', async () => {
      const mockEqChain = vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: { message: 'Deletion failed' } }),
      }));

      const mockDelete = vi.fn(() => ({
        eq: mockEqChain,
      }));

      const testSupabase = {
        from: vi.fn(() => ({
          delete: mockDelete,
        })),
      };

      const result = await deleteMerchantWallet(testSupabase as any, merchantId, 'BTC');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Deletion failed');
    });
  });

  describe('importWalletsToBusiness', () => {
    it('should import all global wallets to a business', async () => {
      // Create a more complete mock for this complex operation
      const merchantWallets = [
        {
          id: 'mw-1',
          merchant_id: merchantId,
          cryptocurrency: 'BTC',
          wallet_address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
          is_active: true,
        },
        {
          id: 'mw-2',
          merchant_id: merchantId,
          cryptocurrency: 'ETH',
          wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1234',
          is_active: true,
        },
      ];

      let callCount = 0;
      const mockFrom = vi.fn((table: string) => {
        if (table === 'businesses') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: { id: businessId },
                    error: null,
                  }),
                })),
              })),
            })),
          };
        }
        if (table === 'merchant_wallets') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({
                  data: merchantWallets,
                  error: null,
                }),
              })),
            })),
          };
        }
        if (table === 'business_wallets') {
          callCount++;
          if (callCount === 1) {
            // First call - get existing wallets
            return {
              select: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              })),
            };
          } else {
            // Second call - insert wallets
            return {
              insert: vi.fn().mockResolvedValue({
                error: null,
              }),
            };
          }
        }
        return {};
      });

      const testSupabase = { from: mockFrom };

      const result = await importWalletsToBusiness(
        testSupabase as any,
        merchantId,
        businessId
      );

      expect(result.success).toBe(true);
      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(0);
    });

    it('should skip existing wallets', async () => {
      const merchantWallets = [
        {
          id: 'mw-1',
          merchant_id: merchantId,
          cryptocurrency: 'BTC',
          wallet_address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
          is_active: true,
        },
        {
          id: 'mw-2',
          merchant_id: merchantId,
          cryptocurrency: 'ETH',
          wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1234',
          is_active: true,
        },
      ];

      const existingWallets = [
        { cryptocurrency: 'BTC' },
      ];

      let businessWalletsCallCount = 0;
      const mockFrom = vi.fn((table: string) => {
        if (table === 'businesses') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: { id: businessId },
                    error: null,
                  }),
                })),
              })),
            })),
          };
        }
        if (table === 'merchant_wallets') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({
                  data: merchantWallets,
                  error: null,
                }),
              })),
            })),
          };
        }
        if (table === 'business_wallets') {
          businessWalletsCallCount++;
          if (businessWalletsCallCount === 1) {
            return {
              select: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({
                  data: existingWallets,
                  error: null,
                }),
              })),
            };
          } else {
            return {
              insert: vi.fn().mockResolvedValue({
                error: null,
              }),
            };
          }
        }
        return {};
      });

      const testSupabase = { from: mockFrom };

      const result = await importWalletsToBusiness(
        testSupabase as any,
        merchantId,
        businessId
      );

      expect(result.success).toBe(true);
      expect(result.imported).toBe(1); // Only ETH should be imported
      expect(result.skipped).toBe(1); // BTC already exists
    });

    it('should return success with zero imports if no global wallets', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'businesses') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: { id: businessId },
                    error: null,
                  }),
                })),
              })),
            })),
          };
        }
        if (table === 'merchant_wallets') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              })),
            })),
          };
        }
        return {};
      });

      const testSupabase = { from: mockFrom };

      const result = await importWalletsToBusiness(
        testSupabase as any,
        merchantId,
        businessId
      );

      expect(result.success).toBe(true);
      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it('should reject if business not found', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'businesses') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: null,
                    error: { message: 'Not found' },
                  }),
                })),
              })),
            })),
          };
        }
        return {};
      });

      const testSupabase = { from: mockFrom };

      const result = await importWalletsToBusiness(
        testSupabase as any,
        merchantId,
        businessId
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Business not found');
    });

    it('should import only specified cryptocurrencies', async () => {
      const merchantWallets = [
        {
          id: 'mw-1',
          merchant_id: merchantId,
          cryptocurrency: 'BTC',
          wallet_address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
          is_active: true,
        },
      ];

      let businessWalletsCallCount = 0;
      const mockFrom = vi.fn((table: string) => {
        if (table === 'businesses') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: { id: businessId },
                    error: null,
                  }),
                })),
              })),
            })),
          };
        }
        if (table === 'merchant_wallets') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  in: vi.fn().mockResolvedValue({
                    data: merchantWallets,
                    error: null,
                  }),
                })),
              })),
            })),
          };
        }
        if (table === 'business_wallets') {
          businessWalletsCallCount++;
          if (businessWalletsCallCount === 1) {
            return {
              select: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              })),
            };
          } else {
            return {
              insert: vi.fn().mockResolvedValue({
                error: null,
              }),
            };
          }
        }
        return {};
      });

      const testSupabase = { from: mockFrom };

      const result = await importWalletsToBusiness(
        testSupabase as any,
        merchantId,
        businessId,
        ['BTC']
      );

      expect(result.success).toBe(true);
      expect(result.imported).toBe(1);
    });
  });
});
