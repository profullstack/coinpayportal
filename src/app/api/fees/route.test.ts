import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for the /api/fees endpoint
 * Verifies real-time network fee estimation functionality
 */

// Mock the fees module
vi.mock('@/lib/rates/fees', () => ({
  getEstimatedNetworkFee: vi.fn(),
  getEstimatedNetworkFees: vi.fn(),
}));

import { GET } from './route';
import { getEstimatedNetworkFee, getEstimatedNetworkFees } from '@/lib/rates/fees';

describe('GET /api/fees', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Single blockchain fee request', () => {
    it('should return fee for a single blockchain', async () => {
      (getEstimatedNetworkFee as any).mockResolvedValue(0.01);

      const request = new Request('http://localhost/api/fees?blockchain=USDC_POL');
      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.blockchain).toBe('USDC_POL');
      expect(data.fee_usd).toBe(0.01);
      expect(data.timestamp).toBeDefined();
    });

    it('should handle lowercase blockchain codes', async () => {
      (getEstimatedNetworkFee as any).mockResolvedValue(3.00);

      const request = new Request('http://localhost/api/fees?blockchain=eth');
      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.blockchain).toBe('ETH');
      expect(data.fee_usd).toBe(3.00);
    });

    it('should reject unsupported blockchain', async () => {
      const request = new Request('http://localhost/api/fees?blockchain=INVALID');
      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Unsupported blockchain');
    });
  });

  describe('Multiple blockchains fee request', () => {
    it('should return fees for multiple blockchains', async () => {
      (getEstimatedNetworkFees as any).mockResolvedValue({
        USDC_POL: 0.01,
        USDC_SOL: 0.001,
        ETH: 3.50,
      });

      const request = new Request('http://localhost/api/fees?blockchains=USDC_POL,USDC_SOL,ETH');
      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.fees).toHaveLength(3);
      expect(data.fees.find((f: any) => f.blockchain === 'USDC_POL').fee_usd).toBe(0.01);
      expect(data.fees.find((f: any) => f.blockchain === 'USDC_SOL').fee_usd).toBe(0.001);
      expect(data.fees.find((f: any) => f.blockchain === 'ETH').fee_usd).toBe(3.50);
    });

    it('should filter out invalid blockchains from list', async () => {
      (getEstimatedNetworkFees as any).mockResolvedValue({
        BTC: 2.00,
        ETH: 3.00,
      });

      const request = new Request('http://localhost/api/fees?blockchains=BTC,INVALID,ETH');
      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.fees).toHaveLength(2);
      expect(getEstimatedNetworkFees).toHaveBeenCalledWith(['BTC', 'ETH']);
    });

    it('should reject when all blockchains are invalid', async () => {
      const request = new Request('http://localhost/api/fees?blockchains=INVALID1,INVALID2');
      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('No valid blockchains');
    });
  });

  describe('All blockchains fee request', () => {
    it('should return fees for all supported blockchains when no params', async () => {
      const mockFees: Record<string, number> = {
        BTC: 2.00,
        BCH: 0.01,
        ETH: 3.00,
        POL: 0.01,
        SOL: 0.001,
        USDC_ETH: 3.00,
        USDC_POL: 0.01,
        USDC_SOL: 0.001,
      };
      (getEstimatedNetworkFees as any).mockResolvedValue(mockFees);

      const request = new Request('http://localhost/api/fees');
      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.fees.length).toBeGreaterThan(0);
    });
  });

  describe('Fee display formatting', () => {
    it('should format small fees with 4 decimal places', async () => {
      (getEstimatedNetworkFees as any).mockResolvedValue({
        SOL: 0.00025,
      });

      const request = new Request('http://localhost/api/fees?blockchains=SOL');
      const response = await GET(request as any);
      const data = await response.json();

      const solFee = data.fees.find((f: any) => f.blockchain === 'SOL');
      expect(solFee.display).toBe('~$0.0003'); // Rounded to 4 decimals
    });

    it('should format medium fees with 2 decimal places', async () => {
      (getEstimatedNetworkFees as any).mockResolvedValue({
        POL: 0.05,
      });

      const request = new Request('http://localhost/api/fees?blockchains=POL');
      const response = await GET(request as any);
      const data = await response.json();

      const polFee = data.fees.find((f: any) => f.blockchain === 'POL');
      expect(polFee.display).toBe('~$0.05');
    });

    it('should format large fees with 2 decimal places', async () => {
      (getEstimatedNetworkFees as any).mockResolvedValue({
        ETH: 5.50,
      });

      const request = new Request('http://localhost/api/fees?blockchains=ETH');
      const response = await GET(request as any);
      const data = await response.json();

      const ethFee = data.fees.find((f: any) => f.blockchain === 'ETH');
      expect(ethFee.display).toBe('~$5.50');
    });
  });

  describe('Error handling', () => {
    it('should return 500 error when fee estimation fails', async () => {
      (getEstimatedNetworkFees as any).mockRejectedValue(new Error('TATUM_API_KEY environment variable is not set'));

      const request = new Request('http://localhost/api/fees');
      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe('TATUM_API_KEY environment variable is not set');
    });

    it('should return error message from API failure', async () => {
      (getEstimatedNetworkFees as any).mockRejectedValue(new Error('Tatum API error: 401'));

      const request = new Request('http://localhost/api/fees');
      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Tatum API error: 401');
    });
  });

  describe('USDC chain-specific fees', () => {
    it('should return different fees for USDC on different chains', async () => {
      (getEstimatedNetworkFees as any).mockResolvedValue({
        USDC_ETH: 3.50,
        USDC_POL: 0.01,
        USDC_SOL: 0.001,
      });

      const request = new Request('http://localhost/api/fees?blockchains=USDC_ETH,USDC_POL,USDC_SOL');
      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);

      const ethFee = data.fees.find((f: any) => f.blockchain === 'USDC_ETH');
      const polFee = data.fees.find((f: any) => f.blockchain === 'USDC_POL');
      const solFee = data.fees.find((f: any) => f.blockchain === 'USDC_SOL');

      expect(ethFee.fee_usd).toBe(3.50);
      expect(polFee.fee_usd).toBe(0.01);
      expect(solFee.fee_usd).toBe(0.001);

      // Polygon and Solana should be much cheaper than Ethereum
      expect(polFee.fee_usd).toBeLessThan(ethFee.fee_usd / 100);
      expect(solFee.fee_usd).toBeLessThan(ethFee.fee_usd / 100);
    });
  });
});
