/**
 * Escrow Series SDK Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoinPayClient } from '../src/client.js';

const createMockClient = () => {
  const client = new CoinPayClient({ apiKey: 'test-key', baseUrl: 'http://localhost:3000/api' });
  client.request = vi.fn();
  return client;
};

describe('Escrow Series SDK', () => {
  let client;

  beforeEach(() => {
    client = createMockClient();
  });

  describe('createEscrowSeries', () => {
    it('should create a crypto escrow series', async () => {
      const mockSeries = {
        id: 'ser_123',
        merchant_id: 'biz_123',
        payment_method: 'crypto',
        amount: 100000,
        currency: 'USD',
        coin: 'SOL',
        interval: 'monthly',
        status: 'active',
      };
      client.request.mockResolvedValue(mockSeries);

      const result = await client.createEscrowSeries({
        business_id: 'biz_123',
        payment_method: 'crypto',
        amount: 100000,
        currency: 'USD',
        coin: 'SOL',
        interval: 'monthly',
        beneficiary_address: 'ben_addr',
        depositor_address: 'dep_addr',
      });

      expect(client.request).toHaveBeenCalledWith('/escrow/series', {
        method: 'POST',
        body: expect.any(String),
      });
      expect(result.id).toBe('ser_123');
    });

    it('should create a card escrow series', async () => {
      const mockSeries = {
        id: 'ser_456',
        payment_method: 'card',
        amount: 5000,
        interval: 'weekly',
        status: 'active',
      };
      client.request.mockResolvedValue(mockSeries);

      const result = await client.createEscrowSeries({
        business_id: 'biz_123',
        payment_method: 'card',
        amount: 5000,
        interval: 'weekly',
        stripe_account_id: 'acct_123',
      });

      expect(result.payment_method).toBe('card');
    });
  });

  describe('listEscrowSeries', () => {
    it('should list series for a business', async () => {
      client.request.mockResolvedValue({ series: [{ id: 'ser_1' }, { id: 'ser_2' }] });

      const result = await client.listEscrowSeries('biz_123');
      expect(client.request).toHaveBeenCalledWith('/escrow/series?business_id=biz_123');
      expect(result.series).toHaveLength(2);
    });

    it('should filter by status', async () => {
      client.request.mockResolvedValue({ series: [] });

      await client.listEscrowSeries('biz_123', 'active');
      expect(client.request).toHaveBeenCalledWith('/escrow/series?business_id=biz_123&status=active');
    });
  });

  describe('getEscrowSeries', () => {
    it('should get series detail with child escrows', async () => {
      client.request.mockResolvedValue({
        series: { id: 'ser_123', status: 'active' },
        escrows: { crypto: [], stripe: [] },
      });

      const result = await client.getEscrowSeries('ser_123');
      expect(client.request).toHaveBeenCalledWith('/escrow/series/ser_123');
      expect(result.series.id).toBe('ser_123');
    });
  });

  describe('updateEscrowSeries', () => {
    it('should pause a series', async () => {
      client.request.mockResolvedValue({ id: 'ser_123', status: 'paused' });

      const result = await client.updateEscrowSeries('ser_123', { status: 'paused' });
      expect(client.request).toHaveBeenCalledWith('/escrow/series/ser_123', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'paused' }),
      });
      expect(result.status).toBe('paused');
    });

    it('should update amount', async () => {
      client.request.mockResolvedValue({ id: 'ser_123', amount: 200000 });

      await client.updateEscrowSeries('ser_123', { amount: 200000 });
      expect(client.request).toHaveBeenCalledWith('/escrow/series/ser_123', {
        method: 'PATCH',
        body: JSON.stringify({ amount: 200000 }),
      });
    });
  });

  describe('cancelEscrowSeries', () => {
    it('should cancel a series', async () => {
      client.request.mockResolvedValue({ id: 'ser_123', status: 'cancelled' });

      const result = await client.cancelEscrowSeries('ser_123');
      expect(client.request).toHaveBeenCalledWith('/escrow/series/ser_123', {
        method: 'DELETE',
      });
      expect(result.status).toBe('cancelled');
    });
  });
});
