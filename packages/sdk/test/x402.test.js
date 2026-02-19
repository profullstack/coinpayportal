/**
 * x402 Payment Protocol Tests
 * Testing Framework: Vitest
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildPaymentRequired,
  createX402Middleware,
  verifyX402Payment,
  settleX402Payment,
  convertUsdToAssetAmount,
  PAYMENT_METHODS,
  USDC_CONTRACTS,
  CHAIN_IDS,
} from '../src/x402.js';

describe('x402 Module', () => {
  describe('USDC_CONTRACTS constants', () => {
    it('should have correct contract addresses', () => {
      expect(USDC_CONTRACTS.base).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
      expect(USDC_CONTRACTS.ethereum).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
      expect(USDC_CONTRACTS.polygon).toBe('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359');
      expect(USDC_CONTRACTS.solana).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    });

    it('should have 4 networks', () => {
      expect(Object.keys(USDC_CONTRACTS)).toHaveLength(4);
    });
  });

  describe('CHAIN_IDS constants', () => {
    it('should have correct chain IDs', () => {
      expect(CHAIN_IDS.base).toBe(8453);
      expect(CHAIN_IDS.ethereum).toBe(1);
      expect(CHAIN_IDS.polygon).toBe(137);
    });

    it('should have 3 EVM chains', () => {
      expect(Object.keys(CHAIN_IDS)).toHaveLength(3);
    });
  });

  describe('PAYMENT_METHODS constants', () => {
    it('should have all native crypto methods', () => {
      expect(PAYMENT_METHODS.btc.asset).toBe('BTC');
      expect(PAYMENT_METHODS.bch.asset).toBe('BCH');
      expect(PAYMENT_METHODS.eth.asset).toBe('ETH');
      expect(PAYMENT_METHODS.pol.asset).toBe('POL');
      expect(PAYMENT_METHODS.sol.asset).toBe('SOL');
    });

    it('should have all USDC methods', () => {
      expect(PAYMENT_METHODS.usdc_eth.asset).toBe('USDC');
      expect(PAYMENT_METHODS.usdc_polygon.asset).toBe('USDC');
      expect(PAYMENT_METHODS.usdc_solana.asset).toBe('USDC');
      expect(PAYMENT_METHODS.usdc_base.asset).toBe('USDC');
    });

    it('should have lightning and stripe methods', () => {
      expect(PAYMENT_METHODS.lightning.scheme).toBe('bolt12');
      expect(PAYMENT_METHODS.stripe.scheme).toBe('stripe-checkout');
    });

    it('should have correct EVM chain IDs', () => {
      expect(PAYMENT_METHODS.eth.chainId).toBe(1);
      expect(PAYMENT_METHODS.pol.chainId).toBe(137);
      expect(PAYMENT_METHODS.usdc_base.chainId).toBe(8453);
    });
  });

  describe('convertUsdToAssetAmount', () => {
    it('should convert USD to USDC (6 decimals)', () => {
      expect(convertUsdToAssetAmount(1.0, 'usdc_eth')).toBe('1000000');
      expect(convertUsdToAssetAmount(5.50, 'usdc_base')).toBe('5500000');
    });

    it('should convert USD to Stripe cents', () => {
      expect(convertUsdToAssetAmount(1.0, 'stripe')).toBe('100');
      expect(convertUsdToAssetAmount(49.99, 'stripe')).toBe('4999');
    });

    it('should convert USD to BTC using rates', () => {
      const result = convertUsdToAssetAmount(650, 'btc', { BTC: 65000 });
      expect(result).toBe('1000000'); // 0.01 BTC = 1,000,000 sats
    });

    it('should throw for unknown method', () => {
      expect(() => convertUsdToAssetAmount(1, 'fake_coin')).toThrow('Unknown payment method');
    });

    it('should throw when no rate available for crypto', () => {
      expect(() => convertUsdToAssetAmount(1, 'btc', {})).toThrow('No exchange rate for BTC');
    });
  });

  describe('buildPaymentRequired', () => {
    it('should return correct x402 payload structure', () => {
      const result = buildPaymentRequired({
        payTo: '0xABC',
        amountUsd: 1.0,
        methods: ['usdc_eth'],
      });

      expect(result.x402Version).toBe(1);
      expect(result.accepts).toBeInstanceOf(Array);
      expect(result.accepts).toHaveLength(1);
    });

    it('should include required fields in accepts entries', () => {
      const result = buildPaymentRequired({
        payTo: '0xABC',
        amountUsd: 5.0,
        methods: ['usdc_base'],
      });

      const entry = result.accepts[0];
      expect(entry.scheme).toBe('exact');
      expect(entry.network).toBe('base');
      expect(entry.asset).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
      expect(entry.maxAmountRequired).toBe('5000000');
      expect(entry.payTo).toBe('0xABC');
      expect(entry.maxTimeoutSeconds).toBe(300);
      expect(entry.extra.facilitator).toBe('https://coinpayportal.com/api/x402');
    });

    it('should use default values for optional fields', () => {
      const result = buildPaymentRequired({
        payTo: '0xABC',
        amountUsd: 1.0,
        methods: ['usdc_eth'],
      });

      const entry = result.accepts[0];
      expect(entry.description).toBe('Payment required');
      expect(entry.mimeType).toBe('application/json');
      expect(entry.maxTimeoutSeconds).toBe(300);
    });

    it('should support custom description and facilitator URL', () => {
      const result = buildPaymentRequired({
        payTo: '0xABC',
        amountUsd: 1.0,
        methods: ['usdc_eth'],
        description: 'Premium access',
        facilitatorUrl: 'https://custom.com/x402',
      });

      const entry = result.accepts[0];
      expect(entry.description).toBe('Premium access');
      expect(entry.extra.facilitator).toBe('https://custom.com/x402');
    });

    it('should build multiple payment methods', () => {
      const result = buildPaymentRequired({
        payTo: { ethereum: '0xETH', base: '0xBASE', solana: 'SoWallet' },
        amountUsd: 10.0,
        methods: ['usdc_eth', 'usdc_base', 'usdc_solana'],
      });

      expect(result.accepts).toHaveLength(3);
      expect(result.accepts[0].network).toBe('ethereum');
      expect(result.accepts[1].network).toBe('base');
      expect(result.accepts[2].network).toBe('solana');
    });

    it('should skip methods with no matching payTo address', () => {
      const result = buildPaymentRequired({
        payTo: { ethereum: '0xETH' },
        amountUsd: 1.0,
        methods: ['usdc_eth', 'usdc_base'],
      });

      expect(result.accepts).toHaveLength(1);
      expect(result.accepts[0].network).toBe('ethereum');
    });

    it('should skip crypto methods when no rate is available', () => {
      const result = buildPaymentRequired({
        payTo: '0xABC',
        amountUsd: 1.0,
        methods: ['btc', 'usdc_eth'],
        rates: {}, // no BTC rate
      });

      expect(result.accepts).toHaveLength(1);
      expect(result.accepts[0].extra.assetSymbol).toBe('USDC');
    });

    it('should throw when no methods can be built', () => {
      expect(() => buildPaymentRequired({
        payTo: {},
        amountUsd: 1.0,
        methods: ['usdc_eth'],
      })).toThrow('No payment methods could be built');
    });

    it('should support legacy single-method mode', () => {
      const result = buildPaymentRequired({
        payTo: '0xABC',
        amount: '1000000',
        network: 'base',
      });

      expect(result.x402Version).toBe(1);
      expect(result.accepts).toHaveLength(1);
      expect(result.accepts[0].maxAmountRequired).toBe('1000000');
    });

    it('should include chainId in extra for EVM methods', () => {
      const result = buildPaymentRequired({
        payTo: '0xABC',
        amountUsd: 1.0,
        methods: ['usdc_base'],
      });

      expect(result.accepts[0].extra.chainId).toBe(8453);
    });

    it('should resolve payTo from object by network', () => {
      const result = buildPaymentRequired({
        payTo: { ethereum: '0xETH_ADDR', polygon: '0xPOL_ADDR' },
        amountUsd: 1.0,
        methods: ['usdc_eth', 'usdc_polygon'],
      });

      expect(result.accepts[0].payTo).toBe('0xETH_ADDR');
      expect(result.accepts[1].payTo).toBe('0xPOL_ADDR');
    });
  });

  describe('createX402Middleware', () => {
    it('should throw if apiKey is missing', () => {
      expect(() => createX402Middleware({ payTo: '0xABC' })).toThrow('apiKey');
    });

    it('should throw if payTo is missing', () => {
      expect(() => createX402Middleware({ apiKey: 'cp_live_test' })).toThrow('payTo');
    });

    it('should return a route factory function', () => {
      const x402 = createX402Middleware({
        apiKey: 'cp_live_test',
        payTo: '0xABC',
      });

      expect(typeof x402).toBe('function');
    });

    it('should throw if route has no amount', () => {
      const x402 = createX402Middleware({
        apiKey: 'cp_live_test',
        payTo: '0xABC',
      });

      expect(() => x402({})).toThrow('amountUsd or amount');
    });

    it('should return 402 when no payment header is present', async () => {
      const x402 = createX402Middleware({
        apiKey: 'cp_live_test',
        payTo: '0xABC',
        methods: ['usdc_eth'],
      });

      const middleware = x402({ amountUsd: 5.0 });

      const req = {
        headers: {},
        protocol: 'https',
        get: vi.fn().mockReturnValue('example.com'),
        originalUrl: '/premium',
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          x402Version: 1,
          accepts: expect.any(Array),
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should call verify and pass through when payment is valid', async () => {
      const mockPayment = {
        scheme: 'exact',
        signature: '0xsig',
        payload: { from: '0x1', to: '0x2', amount: '1000000' },
      };
      const paymentHeader = Buffer.from(JSON.stringify(mockPayment)).toString('base64');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          valid: true,
          payment: { from: '0x1', to: '0x2', amount: '1000000', network: 'ethereum' },
        }),
      });
      global.fetch = mockFetch;

      const x402 = createX402Middleware({
        apiKey: 'cp_live_test',
        payTo: '0xABC',
        methods: ['usdc_eth'],
      });

      const middleware = x402({ amountUsd: 5.0 });

      const req = {
        headers: { 'x-payment': paymentHeader },
        protocol: 'https',
        get: vi.fn().mockReturnValue('example.com'),
        originalUrl: '/premium',
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      const next = vi.fn();

      await middleware(req, res, next);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://coinpayportal.com/api/x402/verify',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'X-API-Key': 'cp_live_test' }),
        })
      );
      expect(next).toHaveBeenCalled();
      expect(req.x402Payment).toBeDefined();
    });

    it('should return 402 when verification fails', async () => {
      const mockPayment = {
        scheme: 'exact',
        signature: '0xbad',
        payload: { from: '0x1', to: '0x2', amount: '1000000' },
      };
      const paymentHeader = Buffer.from(JSON.stringify(mockPayment)).toString('base64');

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Invalid payment signature' }),
      });

      const x402 = createX402Middleware({
        apiKey: 'cp_live_test',
        payTo: '0xABC',
        methods: ['usdc_eth'],
      });

      const middleware = x402({ amountUsd: 5.0 });

      const req = {
        headers: { 'x-payment': paymentHeader },
        protocol: 'https',
        get: vi.fn().mockReturnValue('example.com'),
        originalUrl: '/premium',
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Invalid payment proof' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 500 when fetch throws', async () => {
      const mockPayment = {
        scheme: 'exact',
        signature: '0xsig',
        payload: { from: '0x1', to: '0x2', amount: '1000000' },
      };
      const paymentHeader = Buffer.from(JSON.stringify(mockPayment)).toString('base64');

      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const x402 = createX402Middleware({
        apiKey: 'cp_live_test',
        payTo: '0xABC',
        methods: ['usdc_eth'],
      });

      const middleware = x402({ amountUsd: 5.0 });

      const req = {
        headers: { 'x-payment': paymentHeader },
        protocol: 'https',
        get: vi.fn().mockReturnValue('example.com'),
        originalUrl: '/premium',
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      const next = vi.fn();

      await middleware(req, res, next);

      // On verification failure, middleware falls back to 402 (re-prompt payment)
      expect(res.status).toHaveBeenCalledWith(402);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('verifyX402Payment', () => {
    let mockFetch;

    beforeEach(() => {
      mockFetch = vi.fn();
      global.fetch = mockFetch;
    });

    it('should return invalid for missing payment header', async () => {
      const result = await verifyX402Payment(null, { apiKey: 'cp_live_test' });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Missing payment header');
    });

    it('should return invalid for malformed base64', async () => {
      const result = await verifyX402Payment('not-valid-base64!!!', { apiKey: 'cp_live_test' });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid payment header encoding');
    });

    it('should return invalid when required fields are missing', async () => {
      const header = Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64');
      const result = await verifyX402Payment(header, { apiKey: 'cp_live_test' });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Missing scheme, signature, or payload');
    });

    it('should return invalid for expired payment', async () => {
      const expiredPayment = {
        scheme: 'exact',
        signature: '0xsig',
        payload: {
          from: '0x1',
          to: '0x2',
          amount: '1000000',
          expiresAt: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
        },
      };
      const header = Buffer.from(JSON.stringify(expiredPayment)).toString('base64');

      const result = await verifyX402Payment(header, { apiKey: 'cp_live_test' });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Payment proof has expired');
    });

    it('should return valid on successful verification', async () => {
      const payment = {
        scheme: 'exact',
        signature: '0xsig',
        payload: {
          from: '0x1',
          to: '0x2',
          amount: '1000000',
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      };
      const header = Buffer.from(JSON.stringify(payment)).toString('base64');

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          valid: true,
          payment: { from: '0x1', to: '0x2', amount: '1000000', network: 'base' },
        }),
      });

      const result = await verifyX402Payment(header, { apiKey: 'cp_live_test' });

      expect(result.valid).toBe(true);
      expect(result.payment).toBeDefined();
      expect(result.payment.from).toBe('0x1');
    });

    it('should return invalid when facilitator rejects', async () => {
      const payment = {
        scheme: 'exact',
        signature: '0xbad',
        payload: { from: '0x1', to: '0x2', amount: '1000000' },
      };
      const header = Buffer.from(JSON.stringify(payment)).toString('base64');

      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Invalid signature' }),
      });

      const result = await verifyX402Payment(header, { apiKey: 'cp_live_test' });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid signature');
    });

    it('should handle network errors gracefully', async () => {
      const payment = {
        scheme: 'exact',
        signature: '0xsig',
        payload: { from: '0x1', to: '0x2', amount: '1000000' },
      };
      const header = Buffer.from(JSON.stringify(payment)).toString('base64');

      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const result = await verifyX402Payment(header, { apiKey: 'cp_live_test' });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Facilitator error');
      expect(result.reason).toContain('Connection refused');
    });

    it('should send X-API-Key header when apiKey provided', async () => {
      const payment = {
        scheme: 'exact',
        signature: '0xsig',
        payload: { from: '0x1', to: '0x2', amount: '1000000' },
      };
      const header = Buffer.from(JSON.stringify(payment)).toString('base64');

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ valid: true, payment: {} }),
      });

      await verifyX402Payment(header, { apiKey: 'cp_live_mykey' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-API-Key': 'cp_live_mykey' }),
        })
      );
    });

    it('should use custom apiBaseUrl', async () => {
      const payment = {
        scheme: 'exact',
        signature: '0xsig',
        payload: { from: '0x1', to: '0x2', amount: '1000000' },
      };
      const header = Buffer.from(JSON.stringify(payment)).toString('base64');

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ valid: true, payment: {} }),
      });

      await verifyX402Payment(header, {
        apiKey: 'cp_live_test',
        apiBaseUrl: 'https://custom.example.com',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.example.com/api/x402/verify',
        expect.any(Object)
      );
    });
  });

  describe('settleX402Payment', () => {
    let mockFetch;

    beforeEach(() => {
      mockFetch = vi.fn();
      global.fetch = mockFetch;
    });

    it('should return error for missing payment header', async () => {
      const result = await settleX402Payment(null, { apiKey: 'cp_live_test' });
      expect(result.settled).toBe(false);
      expect(result.error).toBe('Missing payment header');
    });

    it('should return error for malformed header', async () => {
      const result = await settleX402Payment('not-valid!!!', { apiKey: 'cp_live_test' });
      expect(result.settled).toBe(false);
      expect(result.error).toContain('Invalid payment header encoding');
    });

    it('should settle successfully', async () => {
      const payment = {
        payload: { from: '0x1', to: '0x2', amount: '1000000', nonce: '42', network: 'base' },
      };
      const header = Buffer.from(JSON.stringify(payment)).toString('base64');

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          settled: true,
          txHash: '0xabc123',
          network: 'base',
          asset: 'USDC',
          method: 'usdc_base',
        }),
      });

      const result = await settleX402Payment(header, { apiKey: 'cp_live_test' });

      expect(result.settled).toBe(true);
      expect(result.txHash).toBe('0xabc123');
      expect(result.network).toBe('base');
      expect(result.asset).toBe('USDC');
      expect(result.method).toBe('usdc_base');
    });

    it('should handle already-settled payment', async () => {
      const payment = {
        payload: { from: '0x1', to: '0x2', amount: '1000000', nonce: '42', network: 'base' },
      };
      const header = Buffer.from(JSON.stringify(payment)).toString('base64');

      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Payment already settled' }),
      });

      const result = await settleX402Payment(header, { apiKey: 'cp_live_test' });
      expect(result.settled).toBe(false);
      expect(result.error).toBe('Payment already settled');
    });

    it('should handle network errors', async () => {
      const payment = {
        payload: { from: '0x1', to: '0x2', amount: '1000000', nonce: '42', network: 'base' },
      };
      const header = Buffer.from(JSON.stringify(payment)).toString('base64');

      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await settleX402Payment(header, { apiKey: 'cp_live_test' });
      expect(result.settled).toBe(false);
      expect(result.error).toContain('Settlement error');
      expect(result.error).toContain('ECONNREFUSED');
    });

    it('should use custom apiBaseUrl', async () => {
      const payment = {
        payload: { from: '0x1', to: '0x2', amount: '1000000', nonce: '42', network: 'base' },
      };
      const header = Buffer.from(JSON.stringify(payment)).toString('base64');

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ settled: true, txHash: '0x123' }),
      });

      await settleX402Payment(header, {
        apiKey: 'cp_live_test',
        apiBaseUrl: 'https://custom.example.com',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.example.com/api/x402/settle',
        expect.any(Object)
      );
    });
  });
});
