/**
 * Escrow SDK Tests
 * Testing Framework: Vitest
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoinPayClient } from '../src/client.js';
import { 
  createEscrow, 
  getEscrow, 
  listEscrows, 
  releaseEscrow,
  refundEscrow,
  disputeEscrow,
  getEscrowEvents,
  waitForEscrow,
  authenticateEscrow 
} from '../src/escrow.js';

// Mock client with request method
const createMockClient = () => ({
  request: vi.fn(),
  convertFiatToCrypto: vi.fn(),
});

describe('Escrow SDK', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  describe('createEscrow', () => {
    it('should create escrow with crypto amount', async () => {
      const mockResponse = {
        id: 'escr_123',
        escrow_address: '0x123',
        chain: 'SOL',
        amount: 0.5,
        amount_usd: 75,
        status: 'pending',
        depositor_address: 'depositor123',
        beneficiary_address: 'beneficiary123',
        release_token: 'rel_123',
        beneficiary_token: 'ben_123',
        metadata: { job: 'testing' },
        expires_at: '2024-02-11T00:00:00Z',
        created_at: '2024-02-10T12:00:00Z',
      };

      mockClient.request.mockResolvedValue(mockResponse);

      const result = await createEscrow(mockClient, {
        chain: 'SOL',
        amount: 0.5,
        depositorAddress: 'depositor123',
        beneficiaryAddress: 'beneficiary123',
        metadata: { job: 'testing' },
      });

      expect(mockClient.request).toHaveBeenCalledWith('/escrow', {
        method: 'POST',
        body: JSON.stringify({
          chain: 'SOL',
          amount: 0.5,
          depositor_address: 'depositor123',
          beneficiary_address: 'beneficiary123',
          metadata: { job: 'testing' },
        }),
      });

      expect(result).toEqual({
        id: 'escr_123',
        escrowAddress: '0x123',
        chain: 'SOL',
        amount: 0.5,
        amountUsd: 75,
        status: 'pending',
        depositorAddress: 'depositor123',
        beneficiaryAddress: 'beneficiary123',
        releaseToken: 'rel_123',
        beneficiaryToken: 'ben_123',
        metadata: { job: 'testing' },
        expiresAt: '2024-02-11T00:00:00Z',
        createdAt: '2024-02-10T12:00:00Z',
      });
    });

    it('should create escrow with fiat amount conversion', async () => {
      const mockConversion = {
        cryptoAmount: 0.337,
        rate: 148.37,
        fiat: 'USD',
        crypto: 'SOL',
      };

      const mockResponse = {
        id: 'escr_456',
        escrow_address: '0x456',
        chain: 'SOL',
        amount: 0.337,
        amount_usd: 50,
        status: 'pending',
        depositor_address: 'depositor456',
        beneficiary_address: 'beneficiary456',
        release_token: 'rel_456',
        beneficiary_token: 'ben_456',
        created_at: '2024-02-10T12:00:00Z',
      };

      mockClient.convertFiatToCrypto.mockResolvedValue(mockConversion);
      mockClient.request.mockResolvedValue(mockResponse);

      const result = await createEscrow(mockClient, {
        chain: 'SOL',
        amountFiat: 50,
        fiatCurrency: 'USD',
        depositorAddress: 'depositor456',
        beneficiaryAddress: 'beneficiary456',
      });

      expect(mockClient.convertFiatToCrypto).toHaveBeenCalledWith(50, 'USD', 'SOL');
      
      expect(mockClient.request).toHaveBeenCalledWith('/escrow', {
        method: 'POST',
        body: JSON.stringify({
          chain: 'SOL',
          amount: 0.337,
          depositor_address: 'depositor456',
          beneficiary_address: 'beneficiary456',
        }),
      });

      expect(result.amount).toBe(0.337);
      expect(result.id).toBe('escr_456');
    });

    it('should throw error if both amount and amountFiat are provided', async () => {
      await expect(createEscrow(mockClient, {
        chain: 'SOL',
        amount: 0.5,
        amountFiat: 50,
        fiatCurrency: 'USD',
        depositorAddress: 'depositor',
        beneficiaryAddress: 'beneficiary',
      })).rejects.toThrow('Cannot specify both amount and amountFiat');
    });

    it('should throw error if amountFiat without fiatCurrency', async () => {
      await expect(createEscrow(mockClient, {
        chain: 'SOL',
        amountFiat: 50,
        depositorAddress: 'depositor',
        beneficiaryAddress: 'beneficiary',
      })).rejects.toThrow('fiatCurrency is required when amountFiat is specified');
    });

    it('should throw error if neither amount nor amountFiat provided', async () => {
      await expect(createEscrow(mockClient, {
        chain: 'SOL',
        depositorAddress: 'depositor',
        beneficiaryAddress: 'beneficiary',
      })).rejects.toThrow('Either amount or amountFiat must be specified');
    });
  });

  describe('authenticateEscrow', () => {
    it('should authenticate with release token', async () => {
      const mockResponse = {
        escrow: {
          id: 'escr_123',
          escrow_address: '0x123',
          chain: 'SOL',
          amount: 0.5,
          status: 'funded',
          depositor_address: 'depositor123',
          beneficiary_address: 'beneficiary123',
        },
        role: 'depositor',
      };

      mockClient.request.mockResolvedValue(mockResponse);

      const result = await authenticateEscrow(mockClient, 'escr_123', 'rel_abc123');

      expect(mockClient.request).toHaveBeenCalledWith('/escrow/escr_123/auth', {
        method: 'POST',
        body: JSON.stringify({ token: 'rel_abc123' }),
      });

      expect(result.role).toBe('depositor');
      expect(result.escrow.id).toBe('escr_123');
      expect(result.escrow.status).toBe('funded');
    });

    it('should authenticate with beneficiary token', async () => {
      const mockResponse = {
        escrow: {
          id: 'escr_123',
          escrow_address: '0x123',
          chain: 'SOL',
          amount: 0.5,
          status: 'funded',
          depositor_address: 'depositor123',
          beneficiary_address: 'beneficiary123',
        },
        role: 'beneficiary',
      };

      mockClient.request.mockResolvedValue(mockResponse);

      const result = await authenticateEscrow(mockClient, 'escr_123', 'ben_def456');

      expect(result.role).toBe('beneficiary');
    });
  });

  describe('getEscrow', () => {
    it('should get escrow by id', async () => {
      const mockResponse = {
        id: 'escr_123',
        escrow_address: '0x123',
        chain: 'SOL',
        amount: 0.5,
        status: 'funded',
        depositor_address: 'depositor123',
        beneficiary_address: 'beneficiary123',
      };

      mockClient.request.mockResolvedValue(mockResponse);

      const result = await getEscrow(mockClient, 'escr_123');

      expect(mockClient.request).toHaveBeenCalledWith('/escrow/escr_123');
      expect(result.id).toBe('escr_123');
      expect(result.escrowAddress).toBe('0x123');
    });
  });

  describe('listEscrows', () => {
    it('should list escrows with filters', async () => {
      const mockResponse = {
        escrows: [{
          id: 'escr_123',
          escrow_address: '0x123',
          chain: 'SOL',
          amount: 0.5,
          status: 'funded',
        }],
        total: 1,
        limit: 20,
        offset: 0,
      };

      mockClient.request.mockResolvedValue(mockResponse);

      const result = await listEscrows(mockClient, { 
        status: 'funded', 
        limit: 10 
      });

      expect(mockClient.request).toHaveBeenCalledWith('/escrow?status=funded&limit=10');
      expect(result.escrows).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('releaseEscrow', () => {
    it('should release escrow funds', async () => {
      const mockResponse = {
        id: 'escr_123',
        status: 'released',
      };

      mockClient.request.mockResolvedValue(mockResponse);

      const result = await releaseEscrow(mockClient, 'escr_123', 'rel_token123');

      expect(mockClient.request).toHaveBeenCalledWith('/escrow/escr_123/release', {
        method: 'POST',
        body: JSON.stringify({ release_token: 'rel_token123' }),
      });

      expect(result.status).toBe('released');
    });
  });

  describe('refundEscrow', () => {
    it('should refund escrow funds', async () => {
      const mockResponse = {
        id: 'escr_123',
        status: 'refunded',
      };

      mockClient.request.mockResolvedValue(mockResponse);

      const result = await refundEscrow(mockClient, 'escr_123', 'rel_token123');

      expect(mockClient.request).toHaveBeenCalledWith('/escrow/escr_123/refund', {
        method: 'POST',
        body: JSON.stringify({ release_token: 'rel_token123' }),
      });

      expect(result.status).toBe('refunded');
    });
  });

  describe('disputeEscrow', () => {
    it('should dispute escrow', async () => {
      const mockResponse = {
        id: 'escr_123',
        status: 'disputed',
      };

      mockClient.request.mockResolvedValue(mockResponse);

      const result = await disputeEscrow(mockClient, 'escr_123', 'token123', 'Payment not delivered');

      expect(mockClient.request).toHaveBeenCalledWith('/escrow/escr_123/dispute', {
        method: 'POST',
        body: JSON.stringify({ 
          token: 'token123',
          reason: 'Payment not delivered'
        }),
      });

      expect(result.status).toBe('disputed');
    });
  });

  describe('getEscrowEvents', () => {
    it('should get escrow events', async () => {
      const mockResponse = {
        events: [{
          id: 'evt_123',
          escrow_id: 'escr_123',
          event_type: 'created',
          actor: 'depositor',
          details: {},
          created_at: '2024-02-10T12:00:00Z',
        }],
      };

      mockClient.request.mockResolvedValue(mockResponse);

      const result = await getEscrowEvents(mockClient, 'escr_123');

      expect(mockClient.request).toHaveBeenCalledWith('/escrow/escr_123/events');
      expect(result).toHaveLength(1);
      expect(result[0].eventType).toBe('created');
    });
  });

  describe('waitForEscrow', () => {
    it('should wait for escrow status', async () => {
      const mockResponse = {
        id: 'escr_123',
        status: 'funded',
      };

      mockClient.request.mockResolvedValue(mockResponse);

      const result = await waitForEscrow(mockClient, 'escr_123', { 
        targetStatus: 'funded',
        intervalMs: 100,
        timeoutMs: 1000 
      });

      expect(result.status).toBe('funded');
    });
  });
});