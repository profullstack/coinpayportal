import { describe, it, expect, vi } from 'vitest';
import { generateQRCode, generatePaymentQR } from './generator';
import QRCode from 'qrcode';

// Mock QRCode
vi.mock('qrcode');

describe('QR Code Generator', () => {
  describe('generateQRCode', () => {
    it('should generate QR code as data URL', async () => {
      const mockDataURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA';
      vi.mocked(QRCode.toDataURL).mockResolvedValueOnce(mockDataURL);

      const result = await generateQRCode('test-data');

      expect(result).toBe(mockDataURL);
      expect(QRCode.toDataURL).toHaveBeenCalledWith('test-data', expect.any(Object));
    });

    it('should use custom options', async () => {
      const mockDataURL = 'data:image/png;base64,test';
      vi.mocked(QRCode.toDataURL).mockResolvedValueOnce(mockDataURL);

      await generateQRCode('test', { width: 500, margin: 2 });

      expect(QRCode.toDataURL).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ width: 500, margin: 2 })
      );
    });

    it('should handle empty data', async () => {
      await expect(generateQRCode('')).rejects.toThrow();
    });

    it('should handle QR code generation errors', async () => {
      vi.mocked(QRCode.toDataURL).mockRejectedValueOnce(new Error('QR generation failed'));

      await expect(generateQRCode('test')).rejects.toThrow('QR generation failed');
    });

    it('should support different error correction levels', async () => {
      const mockDataURL = 'data:image/png;base64,test';
      vi.mocked(QRCode.toDataURL).mockResolvedValueOnce(mockDataURL);

      await generateQRCode('test', { errorCorrectionLevel: 'H' });

      expect(QRCode.toDataURL).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ errorCorrectionLevel: 'H' })
      );
    });
  });

  describe('generatePaymentQR', () => {
    it('should generate Bitcoin payment QR code', async () => {
      const mockDataURL = 'data:image/png;base64,test';
      vi.mocked(QRCode.toDataURL).mockResolvedValueOnce(mockDataURL);

      const result = await generatePaymentQR({
        blockchain: 'BTC',
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        amount: 0.001,
      });

      expect(result).toBe(mockDataURL);
      expect(QRCode.toDataURL).toHaveBeenCalledWith(
        expect.stringContaining('bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'),
        expect.any(Object)
      );
    });

    it('should generate Ethereum payment QR code', async () => {
      const mockDataURL = 'data:image/png;base64,test';
      vi.mocked(QRCode.toDataURL).mockResolvedValueOnce(mockDataURL);

      const result = await generatePaymentQR({
        blockchain: 'ETH',
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        amount: 0.5,
      });

      expect(result).toBe(mockDataURL);
      expect(QRCode.toDataURL).toHaveBeenCalledWith(
        expect.stringContaining('ethereum:0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'),
        expect.any(Object)
      );
    });

    it('should generate Solana payment QR code', async () => {
      const mockDataURL = 'data:image/png;base64,test';
      vi.mocked(QRCode.toDataURL).mockResolvedValueOnce(mockDataURL);

      const result = await generatePaymentQR({
        blockchain: 'SOL',
        address: '7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK',
        amount: 10,
      });

      expect(result).toBe(mockDataURL);
      expect(QRCode.toDataURL).toHaveBeenCalledWith(
        expect.stringContaining('solana:7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK'),
        expect.any(Object)
      );
    });

    it('should include amount in payment URI', async () => {
      const mockDataURL = 'data:image/png;base64,test';
      vi.mocked(QRCode.toDataURL).mockResolvedValueOnce(mockDataURL);

      await generatePaymentQR({
        blockchain: 'BTC',
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        amount: 0.001,
      });

      expect(QRCode.toDataURL).toHaveBeenCalledWith(
        expect.stringContaining('amount=0.001'),
        expect.any(Object)
      );
    });

    it('should include label in payment URI', async () => {
      const mockDataURL = 'data:image/png;base64,test';
      vi.mocked(QRCode.toDataURL).mockResolvedValueOnce(mockDataURL);

      await generatePaymentQR({
        blockchain: 'BTC',
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        amount: 0.001,
        label: 'Payment for Order #123',
      });

      expect(QRCode.toDataURL).toHaveBeenCalledWith(
        expect.stringContaining('label=Payment%20for%20Order%20%23123'),
        expect.any(Object)
      );
    });

    it('should include message in payment URI', async () => {
      const mockDataURL = 'data:image/png;base64,test';
      vi.mocked(QRCode.toDataURL).mockResolvedValueOnce(mockDataURL);

      await generatePaymentQR({
        blockchain: 'BTC',
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        amount: 0.001,
        message: 'Thank you for your purchase',
      });

      expect(QRCode.toDataURL).toHaveBeenCalledWith(
        expect.stringContaining('message=Thank%20you%20for%20your%20purchase'),
        expect.any(Object)
      );
    });

    it('should validate blockchain type', async () => {
      await expect(
        generatePaymentQR({
          blockchain: 'INVALID' as any,
          address: 'test-address',
          amount: 1,
        })
      ).rejects.toThrow();
    });

    it('should validate address format', async () => {
      await expect(
        generatePaymentQR({
          blockchain: 'BTC',
          address: '',
          amount: 1,
        })
      ).rejects.toThrow();
    });

    it('should validate amount is positive', async () => {
      await expect(
        generatePaymentQR({
          blockchain: 'BTC',
          address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
          amount: 0,
        })
      ).rejects.toThrow();

      await expect(
        generatePaymentQR({
          blockchain: 'BTC',
          address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
          amount: -1,
        })
      ).rejects.toThrow();
    });

    it('should support USDC on different chains', async () => {
      const mockDataURL = 'data:image/png;base64,test';
      
      // USDC on Ethereum
      vi.mocked(QRCode.toDataURL).mockResolvedValueOnce(mockDataURL);
      await generatePaymentQR({
        blockchain: 'USDC_ETH',
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        amount: 100,
      });
      expect(QRCode.toDataURL).toHaveBeenCalledWith(
        expect.stringContaining('ethereum:'),
        expect.any(Object)
      );

      // USDC on Polygon
      vi.mocked(QRCode.toDataURL).mockResolvedValueOnce(mockDataURL);
      await generatePaymentQR({
        blockchain: 'USDC_POL',
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        amount: 100,
      });
      expect(QRCode.toDataURL).toHaveBeenCalledWith(
        expect.stringContaining('polygon:'),
        expect.any(Object)
      );
    });
  });
});