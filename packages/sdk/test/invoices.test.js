/**
 * Invoice SDK Tests
 * Testing Framework: Vitest
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createInvoice,
  getInvoice,
  listInvoices,
  updateInvoice,
  deleteInvoice,
  sendInvoice,
  getInvoicePaymentData,
  InvoiceStatus,
} from '../src/invoices.js';

// Mock client with request method
const createMockClient = () => ({
  request: vi.fn(),
  requestUnauthenticated: vi.fn(),
});

describe('Invoice SDK', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  describe('createInvoice', () => {
    it('should create invoice with required fields', async () => {
      const mockResponse = {
        id: 'inv_123',
        business_id: 'biz_456',
        currency: 'USD',
        amount: 250,
        status: 'draft',
        created_at: '2026-03-22T12:00:00Z',
        updated_at: '2026-03-22T12:00:00Z',
      };

      mockClient.request.mockResolvedValue(mockResponse);

      const result = await createInvoice(mockClient, {
        businessId: 'biz_456',
        currency: 'USD',
        amount: 250,
      });

      expect(mockClient.request).toHaveBeenCalledWith('/invoices', {
        method: 'POST',
        body: JSON.stringify({
          business_id: 'biz_456',
          currency: 'USD',
          amount: 250,
        }),
      });

      expect(result).toEqual({
        id: 'inv_123',
        businessId: 'biz_456',
        clientId: undefined,
        currency: 'USD',
        amount: 250,
        cryptoCurrency: undefined,
        cryptoAmount: undefined,
        status: 'draft',
        dueDate: undefined,
        notes: undefined,
        walletId: undefined,
        merchantWalletAddress: undefined,
        paymentAddress: undefined,
        stripeCheckoutUrl: undefined,
        paidAt: undefined,
        sentAt: undefined,
        createdAt: '2026-03-22T12:00:00Z',
        updatedAt: '2026-03-22T12:00:00Z',
      });
    });

    it('should create invoice with all optional fields', async () => {
      const mockResponse = {
        id: 'inv_789',
        business_id: 'biz_456',
        client_id: 'cli_001',
        currency: 'EUR',
        amount: 500,
        crypto_currency: 'ETH',
        status: 'draft',
        due_date: '2026-04-01',
        notes: 'Consulting services',
        wallet_id: 'wal_123',
        merchant_wallet_address: '0xabc123',
        created_at: '2026-03-22T12:00:00Z',
        updated_at: '2026-03-22T12:00:00Z',
      };

      mockClient.request.mockResolvedValue(mockResponse);

      const result = await createInvoice(mockClient, {
        businessId: 'biz_456',
        clientId: 'cli_001',
        currency: 'EUR',
        amount: 500,
        cryptoCurrency: 'ETH',
        dueDate: '2026-04-01',
        notes: 'Consulting services',
        walletId: 'wal_123',
        merchantWalletAddress: '0xabc123',
      });

      expect(mockClient.request).toHaveBeenCalledWith('/invoices', {
        method: 'POST',
        body: JSON.stringify({
          business_id: 'biz_456',
          currency: 'EUR',
          amount: 500,
          client_id: 'cli_001',
          crypto_currency: 'ETH',
          due_date: '2026-04-01',
          notes: 'Consulting services',
          wallet_id: 'wal_123',
          merchant_wallet_address: '0xabc123',
        }),
      });

      expect(result.clientId).toBe('cli_001');
      expect(result.cryptoCurrency).toBe('ETH');
      expect(result.notes).toBe('Consulting services');
      expect(result.merchantWalletAddress).toBe('0xabc123');
    });
  });

  describe('listInvoices', () => {
    it('should list invoices without filters', async () => {
      const mockResponse = {
        invoices: [
          { id: 'inv_1', business_id: 'biz_456', currency: 'USD', amount: 100, status: 'draft', created_at: '2026-03-20T12:00:00Z' },
          { id: 'inv_2', business_id: 'biz_456', currency: 'USD', amount: 200, status: 'sent', created_at: '2026-03-21T12:00:00Z' },
        ],
        total: 2,
      };

      mockClient.request.mockResolvedValue(mockResponse);

      const result = await listInvoices(mockClient);

      expect(mockClient.request).toHaveBeenCalledWith('/invoices');
      expect(result.invoices).toHaveLength(2);
      expect(result.invoices[0].id).toBe('inv_1');
      expect(result.invoices[1].status).toBe('sent');
      expect(result.total).toBe(2);
    });

    it('should list invoices with filters', async () => {
      const mockResponse = {
        invoices: [
          { id: 'inv_3', business_id: 'biz_456', currency: 'USD', amount: 300, status: 'paid', created_at: '2026-03-22T12:00:00Z' },
        ],
        total: 1,
      };

      mockClient.request.mockResolvedValue(mockResponse);

      await listInvoices(mockClient, {
        businessId: 'biz_456',
        status: 'paid',
        clientId: 'cli_001',
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
      });

      expect(mockClient.request).toHaveBeenCalledWith(
        '/invoices?business_id=biz_456&status=paid&client_id=cli_001&date_from=2026-03-01&date_to=2026-03-31'
      );
    });

    it('should handle array response format', async () => {
      const mockResponse = [
        { id: 'inv_1', business_id: 'biz_456', currency: 'USD', amount: 100, status: 'draft' },
      ];

      mockClient.request.mockResolvedValue(mockResponse);

      const result = await listInvoices(mockClient);
      expect(result.invoices).toHaveLength(1);
      expect(result.invoices[0].businessId).toBe('biz_456');
    });
  });

  describe('getInvoice', () => {
    it('should get invoice by ID', async () => {
      const mockResponse = {
        id: 'inv_123',
        business_id: 'biz_456',
        currency: 'USD',
        amount: 250,
        status: 'sent',
        payment_address: '0xdef456',
        sent_at: '2026-03-22T14:00:00Z',
        created_at: '2026-03-22T12:00:00Z',
        updated_at: '2026-03-22T14:00:00Z',
      };

      mockClient.request.mockResolvedValue(mockResponse);

      const result = await getInvoice(mockClient, 'inv_123');

      expect(mockClient.request).toHaveBeenCalledWith('/invoices/inv_123');
      expect(result.id).toBe('inv_123');
      expect(result.status).toBe('sent');
      expect(result.paymentAddress).toBe('0xdef456');
    });
  });

  describe('updateInvoice', () => {
    it('should update invoice with partial fields', async () => {
      const mockResponse = {
        id: 'inv_123',
        business_id: 'biz_456',
        currency: 'USD',
        amount: 300,
        notes: 'Updated notes',
        status: 'draft',
        created_at: '2026-03-22T12:00:00Z',
        updated_at: '2026-03-22T15:00:00Z',
      };

      mockClient.request.mockResolvedValue(mockResponse);

      const result = await updateInvoice(mockClient, 'inv_123', {
        amount: 300,
        notes: 'Updated notes',
      });

      expect(mockClient.request).toHaveBeenCalledWith('/invoices/inv_123', {
        method: 'PUT',
        body: JSON.stringify({
          amount: 300,
          notes: 'Updated notes',
        }),
      });

      expect(result.amount).toBe(300);
      expect(result.notes).toBe('Updated notes');
    });

    it('should handle snake_case conversion for all update fields', async () => {
      mockClient.request.mockResolvedValue({ id: 'inv_123', status: 'draft' });

      await updateInvoice(mockClient, 'inv_123', {
        cryptoCurrency: 'BTC',
        dueDate: '2026-05-01',
        merchantWalletAddress: '0xnew',
      });

      expect(mockClient.request).toHaveBeenCalledWith('/invoices/inv_123', {
        method: 'PUT',
        body: JSON.stringify({
          crypto_currency: 'BTC',
          due_date: '2026-05-01',
          merchant_wallet_address: '0xnew',
        }),
      });
    });
  });

  describe('deleteInvoice', () => {
    it('should delete a draft invoice', async () => {
      mockClient.request.mockResolvedValue({ success: true });

      const result = await deleteInvoice(mockClient, 'inv_123');

      expect(mockClient.request).toHaveBeenCalledWith('/invoices/inv_123', {
        method: 'DELETE',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('sendInvoice', () => {
    it('should send an invoice', async () => {
      const mockResponse = {
        success: true,
        payment_address: '0xpay123',
        stripe_checkout_url: 'https://checkout.stripe.com/sess_123',
      };

      mockClient.request.mockResolvedValue(mockResponse);

      const result = await sendInvoice(mockClient, 'inv_123');

      expect(mockClient.request).toHaveBeenCalledWith('/invoices/inv_123/send', {
        method: 'POST',
      });
      expect(result.payment_address).toBe('0xpay123');
      expect(result.stripe_checkout_url).toBe('https://checkout.stripe.com/sess_123');
    });
  });

  describe('getInvoicePaymentData', () => {
    it('should get payment data without auth', async () => {
      const mockResponse = {
        id: 'inv_123',
        amount: 250,
        currency: 'USD',
        crypto_amount: 0.125,
        crypto_currency: 'ETH',
        payment_address: '0xpay123',
        status: 'sent',
        due_date: '2026-04-01',
      };

      mockClient.requestUnauthenticated.mockResolvedValue(mockResponse);

      const result = await getInvoicePaymentData(mockClient, 'inv_123');

      expect(mockClient.requestUnauthenticated).toHaveBeenCalledWith('/invoices/inv_123/pay');
      expect(mockClient.request).not.toHaveBeenCalled();
      expect(result.payment_address).toBe('0xpay123');
    });
  });

  describe('InvoiceStatus', () => {
    it('should have all status constants', () => {
      expect(InvoiceStatus.DRAFT).toBe('draft');
      expect(InvoiceStatus.SENT).toBe('sent');
      expect(InvoiceStatus.PAID).toBe('paid');
      expect(InvoiceStatus.OVERDUE).toBe('overdue');
      expect(InvoiceStatus.CANCELLED).toBe('cancelled');
    });
  });
});
