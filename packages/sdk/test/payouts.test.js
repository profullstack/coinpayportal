/**
 * Payouts Module Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createPayout,
  listPayouts,
  getPayout,
  formatPayoutAmount,
} from '../src/payouts.js';

const mockClient = {
  request: vi.fn(),
};

describe('Payouts Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createPayout', () => {
    it('should create a payout with correct parameters', async () => {
      const mockResponse = {
        success: true,
        payout: { id: 'po_123', stripe_payout_id: 'po_stripe_123', amount_cents: 5000, status: 'pending' },
      };
      mockClient.request.mockResolvedValue(mockResponse);

      const result = await createPayout(mockClient, {
        amount: 5000,
        currency: 'usd',
        description: 'Weekly payout',
      });

      expect(mockClient.request).toHaveBeenCalledWith('/stripe/payouts', {
        method: 'POST',
        body: JSON.stringify({
          amount: 5000,
          currency: 'usd',
          description: 'Weekly payout',
          metadata: undefined,
        }),
      });
      expect(result).toEqual(mockResponse);
    });

    it('should use default currency usd', async () => {
      mockClient.request.mockResolvedValue({ success: true });

      await createPayout(mockClient, { amount: 1000 });

      const call = mockClient.request.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.currency).toBe('usd');
    });

    it('should include metadata when provided', async () => {
      mockClient.request.mockResolvedValue({ success: true });

      await createPayout(mockClient, {
        amount: 2000,
        metadata: { orderId: '123' },
      });

      const call = mockClient.request.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.metadata).toEqual({ orderId: '123' });
    });
  });

  describe('listPayouts', () => {
    it('should list payouts with no filters', async () => {
      const mockResponse = {
        success: true,
        payouts: [{ id: 'po_1' }, { id: 'po_2' }],
        pagination: { total: 2, limit: 50, offset: 0, has_more: false },
      };
      mockClient.request.mockResolvedValue(mockResponse);

      const result = await listPayouts(mockClient);

      expect(mockClient.request).toHaveBeenCalledWith('/stripe/payouts');
      expect(result.payouts).toHaveLength(2);
    });

    it('should pass filter parameters', async () => {
      mockClient.request.mockResolvedValue({ success: true, payouts: [] });

      await listPayouts(mockClient, {
        status: 'paid',
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31',
        limit: 10,
        offset: 20,
      });

      const url = mockClient.request.mock.calls[0][0];
      expect(url).toContain('status=paid');
      expect(url).toContain('date_from=2024-01-01');
      expect(url).toContain('date_to=2024-12-31');
      expect(url).toContain('limit=10');
      expect(url).toContain('offset=20');
    });
  });

  describe('getPayout', () => {
    it('should get a payout by ID', async () => {
      const mockResponse = {
        success: true,
        payout: { id: 'po_123', status: 'paid', amount_cents: 5000 },
      };
      mockClient.request.mockResolvedValue(mockResponse);

      const result = await getPayout(mockClient, 'po_123');

      expect(mockClient.request).toHaveBeenCalledWith('/stripe/payouts/po_123');
      expect(result.payout.id).toBe('po_123');
    });
  });

  describe('formatPayoutAmount', () => {
    it('should format USD amounts', () => {
      expect(formatPayoutAmount(5000)).toBe('$50.00');
      expect(formatPayoutAmount(125)).toBe('$1.25');
      expect(formatPayoutAmount(0)).toBe('$0.00');
    });

    it('should format EUR amounts', () => {
      expect(formatPayoutAmount(5000, 'eur')).toBe('€50.00');
    });

    it('should format GBP amounts', () => {
      expect(formatPayoutAmount(5000, 'gbp')).toBe('£50.00');
    });

    it('should use currency code for unknown currencies', () => {
      expect(formatPayoutAmount(5000, 'jpy')).toBe('JPY 50.00');
    });
  });
});
