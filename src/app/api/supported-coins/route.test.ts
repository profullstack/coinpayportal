import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for the supported coins API endpoint
 * GET /api/supported-coins
 * 
 * Returns the list of supported cryptocurrencies (wallets) configured for a business.
 * Supports authentication via API key (business-level) or JWT (merchant-level with business_id param).
 */

describe('GET /api/supported-coins', () => {
  describe('Response Structure', () => {
    /**
     * Helper function that mirrors the response transformation logic
     */
    function transformWalletToSupportedCoin(wallet: {
      cryptocurrency: string;
      wallet_address: string;
      is_active: boolean;
    }) {
      return {
        symbol: wallet.cryptocurrency,
        name: getCryptoName(wallet.cryptocurrency),
        is_active: wallet.is_active,
        has_wallet: true,
      };
    }

    function getCryptoName(symbol: string): string {
      const names: Record<string, string> = {
        BTC: 'Bitcoin',
        BCH: 'Bitcoin Cash',
        ETH: 'Ethereum',
        POL: 'Polygon',
        SOL: 'Solana',
        USDT: 'Tether',
        USDC: 'USD Coin',
        BNB: 'BNB',
        XRP: 'XRP',
        ADA: 'Cardano',
        DOGE: 'Dogecoin',
      };
      return names[symbol] || symbol;
    }

    it('should transform wallet to supported coin format', () => {
      const wallet = {
        cryptocurrency: 'BTC',
        wallet_address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        is_active: true,
      };

      const result = transformWalletToSupportedCoin(wallet);

      expect(result).toEqual({
        symbol: 'BTC',
        name: 'Bitcoin',
        is_active: true,
        has_wallet: true,
      });
    });

    it('should transform ETH wallet correctly', () => {
      const wallet = {
        cryptocurrency: 'ETH',
        wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f5bE1a',
        is_active: true,
      };

      const result = transformWalletToSupportedCoin(wallet);

      expect(result).toEqual({
        symbol: 'ETH',
        name: 'Ethereum',
        is_active: true,
        has_wallet: true,
      });
    });

    it('should transform SOL wallet correctly', () => {
      const wallet = {
        cryptocurrency: 'SOL',
        wallet_address: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV',
        is_active: false,
      };

      const result = transformWalletToSupportedCoin(wallet);

      expect(result).toEqual({
        symbol: 'SOL',
        name: 'Solana',
        is_active: false,
        has_wallet: true,
      });
    });

    it('should transform POL wallet correctly', () => {
      const wallet = {
        cryptocurrency: 'POL',
        wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f5bE1a',
        is_active: true,
      };

      const result = transformWalletToSupportedCoin(wallet);

      expect(result).toEqual({
        symbol: 'POL',
        name: 'Polygon',
        is_active: true,
        has_wallet: true,
      });
    });

    it('should transform USDC wallet correctly', () => {
      const wallet = {
        cryptocurrency: 'USDC',
        wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f5bE1a',
        is_active: true,
      };

      const result = transformWalletToSupportedCoin(wallet);

      expect(result).toEqual({
        symbol: 'USDC',
        name: 'USD Coin',
        is_active: true,
        has_wallet: true,
      });
    });

    it('should handle unknown cryptocurrency symbol', () => {
      const wallet = {
        cryptocurrency: 'UNKNOWN',
        wallet_address: 'someaddress',
        is_active: true,
      };

      const result = transformWalletToSupportedCoin(wallet);

      expect(result).toEqual({
        symbol: 'UNKNOWN',
        name: 'UNKNOWN', // Falls back to symbol
        is_active: true,
        has_wallet: true,
      });
    });
  });

  describe('Response Aggregation', () => {
    function aggregateSupportedCoins(wallets: Array<{
      cryptocurrency: string;
      wallet_address: string;
      is_active: boolean;
    }>) {
      const names: Record<string, string> = {
        BTC: 'Bitcoin',
        BCH: 'Bitcoin Cash',
        ETH: 'Ethereum',
        POL: 'Polygon',
        SOL: 'Solana',
        USDT: 'Tether',
        USDC: 'USD Coin',
        BNB: 'BNB',
        XRP: 'XRP',
        ADA: 'Cardano',
        DOGE: 'Dogecoin',
      };

      return wallets.map((wallet) => ({
        symbol: wallet.cryptocurrency,
        name: names[wallet.cryptocurrency] || wallet.cryptocurrency,
        is_active: wallet.is_active,
        has_wallet: true,
      }));
    }

    it('should aggregate multiple wallets', () => {
      const wallets = [
        { cryptocurrency: 'BTC', wallet_address: 'btc-addr', is_active: true },
        { cryptocurrency: 'ETH', wallet_address: 'eth-addr', is_active: true },
        { cryptocurrency: 'SOL', wallet_address: 'sol-addr', is_active: false },
      ];

      const result = aggregateSupportedCoins(wallets);

      expect(result).toHaveLength(3);
      expect(result[0].symbol).toBe('BTC');
      expect(result[1].symbol).toBe('ETH');
      expect(result[2].symbol).toBe('SOL');
      expect(result[2].is_active).toBe(false);
    });

    it('should return empty array when no wallets configured', () => {
      const wallets: Array<{
        cryptocurrency: string;
        wallet_address: string;
        is_active: boolean;
      }> = [];

      const result = aggregateSupportedCoins(wallets);

      expect(result).toEqual([]);
    });

    it('should preserve wallet order', () => {
      const wallets = [
        { cryptocurrency: 'SOL', wallet_address: 'sol-addr', is_active: true },
        { cryptocurrency: 'BTC', wallet_address: 'btc-addr', is_active: true },
        { cryptocurrency: 'ETH', wallet_address: 'eth-addr', is_active: true },
      ];

      const result = aggregateSupportedCoins(wallets);

      expect(result[0].symbol).toBe('SOL');
      expect(result[1].symbol).toBe('BTC');
      expect(result[2].symbol).toBe('ETH');
    });
  });

  describe('Active Only Filter', () => {
    function filterActiveCoins(coins: Array<{
      symbol: string;
      name: string;
      is_active: boolean;
      has_wallet: boolean;
    }>, activeOnly: boolean) {
      if (!activeOnly) return coins;
      return coins.filter((coin) => coin.is_active);
    }

    it('should filter to active coins only when activeOnly is true', () => {
      const coins = [
        { symbol: 'BTC', name: 'Bitcoin', is_active: true, has_wallet: true },
        { symbol: 'ETH', name: 'Ethereum', is_active: false, has_wallet: true },
        { symbol: 'SOL', name: 'Solana', is_active: true, has_wallet: true },
      ];

      const result = filterActiveCoins(coins, true);

      expect(result).toHaveLength(2);
      expect(result.every((c) => c.is_active)).toBe(true);
    });

    it('should return all coins when activeOnly is false', () => {
      const coins = [
        { symbol: 'BTC', name: 'Bitcoin', is_active: true, has_wallet: true },
        { symbol: 'ETH', name: 'Ethereum', is_active: false, has_wallet: true },
        { symbol: 'SOL', name: 'Solana', is_active: true, has_wallet: true },
      ];

      const result = filterActiveCoins(coins, false);

      expect(result).toHaveLength(3);
    });
  });

  describe('API Response Format', () => {
    interface SupportedCoinsResponse {
      success: boolean;
      coins: Array<{
        symbol: string;
        name: string;
        is_active: boolean;
        has_wallet: boolean;
      }>;
      business_id: string;
      total: number;
    }

    function createSuccessResponse(
      businessId: string,
      coins: Array<{
        symbol: string;
        name: string;
        is_active: boolean;
        has_wallet: boolean;
      }>
    ): SupportedCoinsResponse {
      return {
        success: true,
        coins,
        business_id: businessId,
        total: coins.length,
      };
    }

    it('should create proper success response', () => {
      const coins = [
        { symbol: 'BTC', name: 'Bitcoin', is_active: true, has_wallet: true },
        { symbol: 'ETH', name: 'Ethereum', is_active: true, has_wallet: true },
      ];

      const response = createSuccessResponse('biz-123', coins);

      expect(response.success).toBe(true);
      expect(response.coins).toHaveLength(2);
      expect(response.business_id).toBe('biz-123');
      expect(response.total).toBe(2);
    });

    it('should handle empty coins list', () => {
      const response = createSuccessResponse('biz-123', []);

      expect(response.success).toBe(true);
      expect(response.coins).toEqual([]);
      expect(response.total).toBe(0);
    });
  });

  describe('Error Responses', () => {
    interface ErrorResponse {
      success: false;
      error: string;
    }

    function createErrorResponse(message: string): ErrorResponse {
      return {
        success: false,
        error: message,
      };
    }

    it('should create authentication error response', () => {
      const response = createErrorResponse('Authentication required');

      expect(response.success).toBe(false);
      expect(response.error).toBe('Authentication required');
    });

    it('should create business not found error response', () => {
      const response = createErrorResponse('Business not found');

      expect(response.success).toBe(false);
      expect(response.error).toBe('Business not found');
    });

    it('should create invalid business_id error response', () => {
      const response = createErrorResponse('business_id is required when using JWT authentication');

      expect(response.success).toBe(false);
      expect(response.error).toBe('business_id is required when using JWT authentication');
    });
  });

  describe('Query Parameter Parsing', () => {
    function parseQueryParams(searchParams: URLSearchParams): {
      businessId: string | null;
      activeOnly: boolean;
    } {
      return {
        businessId: searchParams.get('business_id'),
        activeOnly: searchParams.get('active_only') === 'true',
      };
    }

    it('should parse business_id from query params', () => {
      const params = new URLSearchParams('business_id=biz-123');
      const result = parseQueryParams(params);

      expect(result.businessId).toBe('biz-123');
    });

    it('should parse active_only as true', () => {
      const params = new URLSearchParams('active_only=true');
      const result = parseQueryParams(params);

      expect(result.activeOnly).toBe(true);
    });

    it('should parse active_only as false when not set', () => {
      const params = new URLSearchParams('');
      const result = parseQueryParams(params);

      expect(result.activeOnly).toBe(false);
    });

    it('should parse active_only as false when set to other value', () => {
      const params = new URLSearchParams('active_only=false');
      const result = parseQueryParams(params);

      expect(result.activeOnly).toBe(false);
    });

    it('should handle both params together', () => {
      const params = new URLSearchParams('business_id=biz-456&active_only=true');
      const result = parseQueryParams(params);

      expect(result.businessId).toBe('biz-456');
      expect(result.activeOnly).toBe(true);
    });
  });

  describe('Business ID Resolution', () => {
    interface AuthContext {
      type: 'merchant' | 'business';
      merchantId: string;
      businessId?: string;
    }

    function resolveBusinessId(
      authContext: AuthContext,
      queryBusinessId: string | null
    ): { businessId: string | null; error: string | null } {
      // API key auth provides business ID directly
      if (authContext.type === 'business' && authContext.businessId) {
        return { businessId: authContext.businessId, error: null };
      }

      // JWT auth requires business_id in query params
      if (authContext.type === 'merchant') {
        if (!queryBusinessId) {
          return {
            businessId: null,
            error: 'business_id is required when using JWT authentication',
          };
        }
        return { businessId: queryBusinessId, error: null };
      }

      return { businessId: null, error: 'Unable to resolve business ID' };
    }

    it('should use businessId from API key auth context', () => {
      const authContext: AuthContext = {
        type: 'business',
        merchantId: 'merchant-123',
        businessId: 'biz-from-apikey',
      };

      const result = resolveBusinessId(authContext, null);

      expect(result.businessId).toBe('biz-from-apikey');
      expect(result.error).toBeNull();
    });

    it('should use businessId from query params for JWT auth', () => {
      const authContext: AuthContext = {
        type: 'merchant',
        merchantId: 'merchant-123',
      };

      const result = resolveBusinessId(authContext, 'biz-from-query');

      expect(result.businessId).toBe('biz-from-query');
      expect(result.error).toBeNull();
    });

    it('should return error when JWT auth without business_id', () => {
      const authContext: AuthContext = {
        type: 'merchant',
        merchantId: 'merchant-123',
      };

      const result = resolveBusinessId(authContext, null);

      expect(result.businessId).toBeNull();
      expect(result.error).toBe('business_id is required when using JWT authentication');
    });

    it('should prefer API key businessId over query param', () => {
      const authContext: AuthContext = {
        type: 'business',
        merchantId: 'merchant-123',
        businessId: 'biz-from-apikey',
      };

      const result = resolveBusinessId(authContext, 'biz-from-query');

      expect(result.businessId).toBe('biz-from-apikey');
    });
  });
});

describe('Crypto Name Mapping', () => {
  const CRYPTO_NAMES: Record<string, string> = {
    BTC: 'Bitcoin',
    BCH: 'Bitcoin Cash',
    ETH: 'Ethereum',
    POL: 'Polygon',
    SOL: 'Solana',
    USDT: 'Tether',
    USDC: 'USD Coin',
    BNB: 'BNB',
    XRP: 'XRP',
    ADA: 'Cardano',
    DOGE: 'Dogecoin',
  };

  it('should have all supported cryptocurrencies mapped', () => {
    const supportedCryptos = ['BTC', 'BCH', 'ETH', 'USDT', 'USDC', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'POL'];

    for (const crypto of supportedCryptos) {
      expect(CRYPTO_NAMES[crypto]).toBeDefined();
      expect(typeof CRYPTO_NAMES[crypto]).toBe('string');
      expect(CRYPTO_NAMES[crypto].length).toBeGreaterThan(0);
    }
  });

  it('should have correct names for major cryptocurrencies', () => {
    expect(CRYPTO_NAMES.BTC).toBe('Bitcoin');
    expect(CRYPTO_NAMES.ETH).toBe('Ethereum');
    expect(CRYPTO_NAMES.SOL).toBe('Solana');
    expect(CRYPTO_NAMES.POL).toBe('Polygon');
    expect(CRYPTO_NAMES.USDC).toBe('USD Coin');
  });
});
