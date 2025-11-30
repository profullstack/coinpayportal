import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for the payment creation API route
 * Focuses on the response transformation that maps internal field names
 * to frontend-expected field names
 */

describe('Payment API Response Transformation', () => {
  describe('transformPaymentResponse', () => {
    /**
     * Helper function that mirrors the transformation logic in the API route
     * This allows us to test the transformation without importing the route
     */
    function transformPaymentResponse(payment: any) {
      return {
        ...payment,
        amount_usd: payment?.amount,
        amount_crypto: payment?.crypto_amount,
        currency: payment?.blockchain?.toLowerCase(),
      };
    }

    it('should transform amount to amount_usd', () => {
      const payment = {
        id: 'test-id',
        amount: 100.50,
        crypto_amount: 0.002,
        blockchain: 'BTC',
        status: 'pending',
      };

      const transformed = transformPaymentResponse(payment);

      expect(transformed.amount_usd).toBe(100.50);
      expect(transformed.amount).toBe(100.50); // Original field preserved
    });

    it('should transform crypto_amount to amount_crypto', () => {
      const payment = {
        id: 'test-id',
        amount: 100,
        crypto_amount: 0.00234567,
        blockchain: 'BTC',
        status: 'pending',
      };

      const transformed = transformPaymentResponse(payment);

      expect(transformed.amount_crypto).toBe(0.00234567);
      expect(transformed.crypto_amount).toBe(0.00234567); // Original field preserved
    });

    it('should transform blockchain to lowercase currency', () => {
      const payment = {
        id: 'test-id',
        amount: 100,
        crypto_amount: 0.05,
        blockchain: 'ETH',
        status: 'pending',
      };

      const transformed = transformPaymentResponse(payment);

      expect(transformed.currency).toBe('eth');
      expect(transformed.blockchain).toBe('ETH'); // Original field preserved
    });

    it('should handle SOL blockchain', () => {
      const payment = {
        id: 'test-id',
        amount: 50,
        crypto_amount: 0.5,
        blockchain: 'SOL',
        status: 'pending',
      };

      const transformed = transformPaymentResponse(payment);

      expect(transformed.currency).toBe('sol');
      expect(transformed.amount_usd).toBe(50);
      expect(transformed.amount_crypto).toBe(0.5);
    });

    it('should handle POL blockchain', () => {
      const payment = {
        id: 'test-id',
        amount: 25,
        crypto_amount: 25.5,
        blockchain: 'POL',
        status: 'pending',
      };

      const transformed = transformPaymentResponse(payment);

      expect(transformed.currency).toBe('pol');
    });

    it('should handle USDC_ETH blockchain', () => {
      const payment = {
        id: 'test-id',
        amount: 100,
        crypto_amount: 100,
        blockchain: 'USDC_ETH',
        status: 'pending',
      };

      const transformed = transformPaymentResponse(payment);

      expect(transformed.currency).toBe('usdc_eth');
    });

    it('should preserve all original payment fields', () => {
      const payment = {
        id: 'test-payment-id',
        business_id: 'test-business-id',
        amount: 100,
        crypto_amount: 0.002,
        crypto_currency: 'BTC',
        blockchain: 'BTC',
        status: 'pending',
        payment_address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        merchant_wallet_address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
        metadata: { description: 'Test payment' },
        created_at: '2024-01-01T00:00:00Z',
        expires_at: '2024-01-01T00:15:00Z',
      };

      const transformed = transformPaymentResponse(payment);

      // All original fields should be preserved
      expect(transformed.id).toBe(payment.id);
      expect(transformed.business_id).toBe(payment.business_id);
      expect(transformed.crypto_currency).toBe(payment.crypto_currency);
      expect(transformed.status).toBe(payment.status);
      expect(transformed.payment_address).toBe(payment.payment_address);
      expect(transformed.merchant_wallet_address).toBe(payment.merchant_wallet_address);
      expect(transformed.metadata).toEqual(payment.metadata);
      expect(transformed.created_at).toBe(payment.created_at);
      expect(transformed.expires_at).toBe(payment.expires_at);
    });

    it('should handle null payment gracefully', () => {
      const transformed = transformPaymentResponse(null);

      expect(transformed.amount_usd).toBeUndefined();
      expect(transformed.amount_crypto).toBeUndefined();
      expect(transformed.currency).toBeUndefined();
    });

    it('should handle undefined fields gracefully', () => {
      const payment = {
        id: 'test-id',
        status: 'pending',
        // amount, crypto_amount, and blockchain are undefined
      };

      const transformed = transformPaymentResponse(payment);

      expect(transformed.amount_usd).toBeUndefined();
      expect(transformed.amount_crypto).toBeUndefined();
      expect(transformed.currency).toBeUndefined();
    });

    it('should handle zero amounts', () => {
      const payment = {
        id: 'test-id',
        amount: 0,
        crypto_amount: 0,
        blockchain: 'BTC',
        status: 'pending',
      };

      const transformed = transformPaymentResponse(payment);

      expect(transformed.amount_usd).toBe(0);
      expect(transformed.amount_crypto).toBe(0);
    });

    it('should handle very small crypto amounts', () => {
      const payment = {
        id: 'test-id',
        amount: 1,
        crypto_amount: 0.00000001, // 1 satoshi
        blockchain: 'BTC',
        status: 'pending',
      };

      const transformed = transformPaymentResponse(payment);

      expect(transformed.amount_crypto).toBe(0.00000001);
    });

    it('should handle very large amounts', () => {
      const payment = {
        id: 'test-id',
        amount: 1000000,
        crypto_amount: 20,
        blockchain: 'BTC',
        status: 'pending',
      };

      const transformed = transformPaymentResponse(payment);

      expect(transformed.amount_usd).toBe(1000000);
      expect(transformed.amount_crypto).toBe(20);
    });
  });
});

describe('Currency to Blockchain Mapping', () => {
  /**
   * Helper function that mirrors the mapping logic in the API route
   */
  function mapCurrencyToBlockchain(currency: string): string | null {
    const mapping: Record<string, string> = {
      'btc': 'BTC',
      'bch': 'BCH',
      'eth': 'ETH',
      'pol': 'POL',
      'sol': 'SOL',
      'usdc_eth': 'USDC_ETH',
      'usdc_pol': 'USDC_POL',
      'usdc_sol': 'USDC_SOL',
    };
    return mapping[currency.toLowerCase()] || null;
  }

  it('should map btc to BTC', () => {
    expect(mapCurrencyToBlockchain('btc')).toBe('BTC');
    expect(mapCurrencyToBlockchain('BTC')).toBe('BTC');
  });

  it('should map eth to ETH', () => {
    expect(mapCurrencyToBlockchain('eth')).toBe('ETH');
    expect(mapCurrencyToBlockchain('ETH')).toBe('ETH');
  });

  it('should map sol to SOL', () => {
    expect(mapCurrencyToBlockchain('sol')).toBe('SOL');
    expect(mapCurrencyToBlockchain('SOL')).toBe('SOL');
  });

  it('should map pol to POL', () => {
    expect(mapCurrencyToBlockchain('pol')).toBe('POL');
    expect(mapCurrencyToBlockchain('POL')).toBe('POL');
  });

  it('should reject matic as invalid (use pol instead)', () => {
    expect(mapCurrencyToBlockchain('matic')).toBeNull();
    expect(mapCurrencyToBlockchain('MATIC')).toBeNull();
  });

  it('should map bch to BCH', () => {
    expect(mapCurrencyToBlockchain('bch')).toBe('BCH');
  });

  it('should map USDC variants correctly', () => {
    expect(mapCurrencyToBlockchain('usdc_eth')).toBe('USDC_ETH');
    expect(mapCurrencyToBlockchain('usdc_pol')).toBe('USDC_POL');
    expect(mapCurrencyToBlockchain('usdc_sol')).toBe('USDC_SOL');
  });

  it('should reject usdc_matic as invalid (use usdc_pol instead)', () => {
    expect(mapCurrencyToBlockchain('usdc_matic')).toBeNull();
  });

  it('should return null for unknown currencies', () => {
    expect(mapCurrencyToBlockchain('unknown')).toBeNull();
    expect(mapCurrencyToBlockchain('doge')).toBeNull();
    expect(mapCurrencyToBlockchain('')).toBeNull();
  });

  it('should be case insensitive', () => {
    expect(mapCurrencyToBlockchain('BtC')).toBe('BTC');
    expect(mapCurrencyToBlockchain('Eth')).toBe('ETH');
    expect(mapCurrencyToBlockchain('USDC_ETH')).toBe('USDC_ETH');
  });
});

describe('Blockchain to Crypto Mapping', () => {
  /**
   * Helper function that mirrors the mapping logic in the API route
   */
  function blockchainToCrypto(blockchain: string): string {
    if (blockchain.startsWith('USDC_')) {
      return 'USDC';
    }
    return blockchain;
  }

  it('should return blockchain as-is for native tokens', () => {
    expect(blockchainToCrypto('BTC')).toBe('BTC');
    expect(blockchainToCrypto('ETH')).toBe('ETH');
    expect(blockchainToCrypto('SOL')).toBe('SOL');
    expect(blockchainToCrypto('POL')).toBe('POL');
    expect(blockchainToCrypto('BCH')).toBe('BCH');
  });

  it('should return USDC for USDC variants', () => {
    expect(blockchainToCrypto('USDC_ETH')).toBe('USDC');
    expect(blockchainToCrypto('USDC_POL')).toBe('USDC');
    expect(blockchainToCrypto('USDC_SOL')).toBe('USDC');
  });
});