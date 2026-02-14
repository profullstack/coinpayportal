import { describe, it, expect, beforeEach } from 'vitest';
import { CoinPayClient } from '../src/client.js';
import { registerMerchant, loginMerchant, getMe } from '../src/auth.js';

describe('Auth SDK', () => {
  let client;
  
  beforeEach(() => {
    // Create client without API key for auth operations
    client = new CoinPayClient({ 
      baseUrl: process.env.COINPAY_BASE_URL || 'https://coinpayportal.com/api' 
    });
  });

  describe('registerMerchant', () => {
    it('should be a function', () => {
      expect(typeof registerMerchant).toBe('function');
    });

    it('should throw error for missing email', async () => {
      await expect(registerMerchant(client, { password: 'test123' }))
        .rejects.toThrow();
    });

    it('should throw error for missing password', async () => {
      await expect(registerMerchant(client, { email: 'test@example.com' }))
        .rejects.toThrow();
    });

    // Skip actual API test unless in integration mode
    it.skip('should register a new merchant', async () => {
      const testEmail = `test-${Date.now()}@example.com`;
      const result = await registerMerchant(client, {
        email: testEmail,
        password: 'test123456',
        name: 'Test Merchant'
      });
      
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('merchant');
      expect(result).toHaveProperty('token');
      expect(result.merchant.email).toBe(testEmail);
    });
  });

  describe('loginMerchant', () => {
    it('should be a function', () => {
      expect(typeof loginMerchant).toBe('function');
    });

    it('should throw error for missing email', async () => {
      await expect(loginMerchant(client, { password: 'test123' }))
        .rejects.toThrow();
    });

    it('should throw error for missing password', async () => {
      await expect(loginMerchant(client, { email: 'test@example.com' }))
        .rejects.toThrow();
    });

    // Skip actual API test unless in integration mode
    it.skip('should login with valid credentials', async () => {
      const result = await loginMerchant(client, {
        email: 'test@example.com',
        password: 'validpassword'
      });
      
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('merchant');
      expect(result).toHaveProperty('token');
    });
  });

  describe('getMe', () => {
    it('should be a function', () => {
      expect(typeof getMe).toBe('function');
    });

    it('should require authentication', async () => {
      await expect(getMe(client))
        .rejects.toThrow();
    });

    // Skip actual API test unless in integration mode
    it.skip('should return merchant info when authenticated', async () => {
      // This would require a valid JWT token
      const authenticatedClient = new CoinPayClient({ 
        apiKey: 'valid-jwt-token',
        baseUrl: process.env.COINPAY_BASE_URL || 'https://coinpayportal.com/api' 
      });
      
      const result = await getMe(authenticatedClient);
      
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('email');
      expect(result).toHaveProperty('created_at');
    });
  });

  describe('client unauthenticated requests', () => {
    it('should create client without API key', () => {
      const unauthClient = new CoinPayClient({});
      expect(unauthClient).toBeInstanceOf(CoinPayClient);
    });

    it('should allow unauthenticated requests', async () => {
      // This is just testing the method exists and doesn't throw immediately
      expect(typeof client.requestUnauthenticated).toBe('function');
    });

    it('should reject authenticated requests without API key', async () => {
      await expect(client.request('/test'))
        .rejects.toThrow('API key is required');
    });
  });
});