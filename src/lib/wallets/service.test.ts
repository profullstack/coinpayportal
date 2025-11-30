import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createWallet,
  listWallets,
  getWallet,
  updateWallet,
  deleteWallet,
  getActiveWalletAddress,
  SUPPORTED_CRYPTOCURRENCIES,
} from './service';

// Mock Supabase client
const createMockSupabase = () => {
  const mockEq = vi.fn().mockReturnThis();
  const mockSingle = vi.fn();
  const mockOrder = vi.fn().mockReturnThis();
  
  const mockSelect = vi.fn(() => ({
    eq: mockEq,
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
      single: mockSingle,
      order: mockOrder,
    },
  };
};

describe('Wallet Service', () => {
  let mockSupabase: any;
  const businessId = 'business-123';
  const merchantId = 'merchant-123';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
  });

  describe('createWallet', () => {
    it('should create a wallet successfully', async () => {
      const walletData = {
        cryptocurrency: 'BTC' as const,
        wallet_address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      };

      const expectedWallet = {
        id: 'wallet-123',
        business_id: businessId,
        cryptocurrency: 'BTC',
        wallet_address: walletData.wallet_address,
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      // Mock business verification
      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: { id: businessId },
        error: null,
      });

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

      const result = await createWallet(mockSupabase, businessId, merchantId, walletData);

      expect(result.success).toBe(true);
      expect(result.wallet).toEqual(expectedWallet);
      expect(mockSupabase.from).toHaveBeenCalledWith('businesses');
      expect(mockSupabase.from).toHaveBeenCalledWith('business_wallets');
    });

    it('should reject invalid cryptocurrency', async () => {
      const walletData = {
        cryptocurrency: 'INVALID' as any,
        wallet_address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      };

      const result = await createWallet(mockSupabase, businessId, merchantId, walletData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid cryptocurrency');
    });

    it('should reject invalid wallet address', async () => {
      const walletData = {
        cryptocurrency: 'BTC' as const,
        wallet_address: 'short',
      };

      const result = await createWallet(mockSupabase, businessId, merchantId, walletData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid wallet address');
    });

    it('should reject if business not found', async () => {
      const walletData = {
        cryptocurrency: 'BTC' as const,
        wallet_address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      };

      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Not found' },
      });

      const result = await createWallet(mockSupabase, businessId, merchantId, walletData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Business not found');
    });

    it('should reject if wallet already exists', async () => {
      const walletData = {
        cryptocurrency: 'BTC' as const,
        wallet_address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      };

      // Mock business verification
      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: { id: businessId },
        error: null,
      });

      // Mock existing wallet check - wallet exists
      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: { id: 'existing-wallet' },
        error: null,
      });

      const result = await createWallet(mockSupabase, businessId, merchantId, walletData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });
  });

  describe('listWallets', () => {
    it('should list all wallets for a business', async () => {
      const expectedWallets = [
        {
          id: 'wallet-1',
          business_id: businessId,
          cryptocurrency: 'BTC',
          wallet_address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
          is_active: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'wallet-2',
          business_id: businessId,
          cryptocurrency: 'ETH',
          wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
          is_active: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ];

      // Mock business verification
      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: { id: businessId },
        error: null,
      });

      // Mock wallet list
      mockSupabase._mocks.order.mockResolvedValueOnce({
        data: expectedWallets,
        error: null,
      });

      const result = await listWallets(mockSupabase, businessId, merchantId);

      expect(result.success).toBe(true);
      expect(result.wallets).toEqual(expectedWallets);
      expect(result.wallets).toHaveLength(2);
    });

    it('should return empty array if no wallets', async () => {
      // Mock business verification
      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: { id: businessId },
        error: null,
      });

      // Mock empty wallet list
      mockSupabase._mocks.order.mockResolvedValueOnce({
        data: [],
        error: null,
      });

      const result = await listWallets(mockSupabase, businessId, merchantId);

      expect(result.success).toBe(true);
      expect(result.wallets).toEqual([]);
    });

    it('should reject if business not found', async () => {
      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Not found' },
      });

      const result = await listWallets(mockSupabase, businessId, merchantId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Business not found');
    });
  });

  describe('getWallet', () => {
    it('should get a specific wallet', async () => {
      const expectedWallet = {
        id: 'wallet-123',
        business_id: businessId,
        cryptocurrency: 'BTC',
        wallet_address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      // Mock business verification
      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: { id: businessId },
        error: null,
      });

      // Mock wallet retrieval
      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: expectedWallet,
        error: null,
      });

      const result = await getWallet(mockSupabase, businessId, 'BTC', merchantId);

      expect(result.success).toBe(true);
      expect(result.wallet).toEqual(expectedWallet);
    });

    it('should reject invalid cryptocurrency', async () => {
      const result = await getWallet(mockSupabase, businessId, 'INVALID' as any, merchantId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid cryptocurrency');
    });

    it('should return error if wallet not found', async () => {
      // Mock business verification
      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: { id: businessId },
        error: null,
      });

      // Mock wallet not found
      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Not found' },
      });

      const result = await getWallet(mockSupabase, businessId, 'BTC', merchantId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Not found');
    });
  });

  describe('updateWallet', () => {
    it('should update wallet address', async () => {
      const updateData = {
        wallet_address: 'bc1qnew2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      };

      const expectedWallet = {
        id: 'wallet-123',
        business_id: businessId,
        cryptocurrency: 'BTC',
        wallet_address: updateData.wallet_address,
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      // Mock business verification
      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: { id: businessId },
        error: null,
      });

      // Mock wallet update
      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: expectedWallet,
        error: null,
      });

      const result = await updateWallet(mockSupabase, businessId, 'BTC', merchantId, updateData);

      expect(result.success).toBe(true);
      expect(result.wallet?.wallet_address).toBe(updateData.wallet_address);
    });

    it('should update wallet active status', async () => {
      const updateData = {
        is_active: false,
      };

      const expectedWallet = {
        id: 'wallet-123',
        business_id: businessId,
        cryptocurrency: 'BTC',
        wallet_address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        is_active: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      // Mock business verification
      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: { id: businessId },
        error: null,
      });

      // Mock wallet update
      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: expectedWallet,
        error: null,
      });

      const result = await updateWallet(mockSupabase, businessId, 'BTC', merchantId, updateData);

      expect(result.success).toBe(true);
      expect(result.wallet?.is_active).toBe(false);
    });

    it('should reject invalid wallet address', async () => {
      const updateData = {
        wallet_address: 'short',
      };

      const result = await updateWallet(mockSupabase, businessId, 'BTC', merchantId, updateData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid wallet address');
    });
  });

  describe('deleteWallet', () => {
    it('should delete a wallet successfully', async () => {
      // Create a fresh mock for this test
      const mockEqChain = vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }));
      
      const mockDelete = vi.fn(() => ({
        eq: mockEqChain,
      }));
      
      const mockSingle = vi.fn().mockResolvedValue({
        data: { id: businessId },
        error: null,
      });
      
      const mockSelect = vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: mockSingle,
          })),
        })),
      }));
      
      const testSupabase = {
        from: vi.fn((table) => {
          if (table === 'businesses') {
            return { select: mockSelect };
          }
          return { delete: mockDelete };
        }),
      };

      const result = await deleteWallet(testSupabase as any, businessId, 'BTC', merchantId);

      expect(result.success).toBe(true);
    });

    it('should reject invalid cryptocurrency', async () => {
      const result = await deleteWallet(mockSupabase, businessId, 'INVALID' as any, merchantId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid cryptocurrency');
    });

    it('should handle deletion errors', async () => {
      // Create a fresh mock for this test
      const mockEqChain = vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: { message: 'Deletion failed' } }),
      }));
      
      const mockDelete = vi.fn(() => ({
        eq: mockEqChain,
      }));
      
      const mockSingle = vi.fn().mockResolvedValue({
        data: { id: businessId },
        error: null,
      });
      
      const mockSelect = vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: mockSingle,
          })),
        })),
      }));
      
      const testSupabase = {
        from: vi.fn((table) => {
          if (table === 'businesses') {
            return { select: mockSelect };
          }
          return { delete: mockDelete };
        }),
      };

      const result = await deleteWallet(testSupabase as any, businessId, 'BTC', merchantId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Deletion failed');
    });
  });

  describe('getActiveWalletAddress', () => {
    it('should get active wallet address', async () => {
      const expectedAddress = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';

      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: { wallet_address: expectedAddress },
        error: null,
      });

      const result = await getActiveWalletAddress(mockSupabase, businessId, 'BTC');

      expect(result.success).toBe(true);
      expect(result.address).toBe(expectedAddress);
    });

    it('should return error if no active wallet', async () => {
      mockSupabase._mocks.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Not found' },
      });

      const result = await getActiveWalletAddress(mockSupabase, businessId, 'BTC');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No active wallet found');
    });
  });

  describe('SUPPORTED_CRYPTOCURRENCIES', () => {
    it('should export supported cryptocurrencies', () => {
      expect(SUPPORTED_CRYPTOCURRENCIES).toEqual(['BTC', 'ETH', 'POL', 'SOL']);
    });
  });

  describe('MATIC is no longer supported', () => {
    it('should reject MATIC as invalid cryptocurrency for getWallet', async () => {
      const result = await getWallet(mockSupabase, businessId, 'MATIC' as any, merchantId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid cryptocurrency');
    });

    it('should reject MATIC as invalid cryptocurrency for deleteWallet', async () => {
      const result = await deleteWallet(mockSupabase, businessId, 'MATIC' as any, merchantId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid cryptocurrency');
    });

    it('should reject MATIC as invalid cryptocurrency for updateWallet', async () => {
      const updateData = {
        is_active: false,
      };

      const result = await updateWallet(mockSupabase, businessId, 'MATIC' as any, merchantId, updateData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid cryptocurrency');
    });

    it('should reject MATIC as invalid cryptocurrency for createWallet', async () => {
      const walletData = {
        cryptocurrency: 'MATIC' as any,
        wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      };

      const result = await createWallet(mockSupabase, businessId, merchantId, walletData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid cryptocurrency');
    });
  });
});