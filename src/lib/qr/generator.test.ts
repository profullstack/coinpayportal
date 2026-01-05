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

    it('should generate Ethereum payment QR code with EIP-681 format', async () => {
      const mockDataURL = 'data:image/png;base64,test';
      vi.mocked(QRCode.toDataURL).mockResolvedValueOnce(mockDataURL);

      const result = await generatePaymentQR({
        blockchain: 'ETH',
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        amount: 0.5,
      });

      expect(result).toBe(mockDataURL);
      // EIP-681 format: ethereum:address@chainId?value=amountInWei
      expect(QRCode.toDataURL).toHaveBeenCalledWith(
        expect.stringMatching(/ethereum:0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb@1\?value=500000000000000000/),
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

    it('should support USDC on different chains with EIP-681 ERC-20 transfer format', async () => {
      const mockDataURL = 'data:image/png;base64,test';

      // USDC on Ethereum - EIP-681 format with contract address and transfer function
      vi.mocked(QRCode.toDataURL).mockResolvedValueOnce(mockDataURL);
      await generatePaymentQR({
        blockchain: 'USDC_ETH',
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        amount: 100,
      });
      // Should use USDC contract address on ETH mainnet (chain ID 1)
      expect(QRCode.toDataURL).toHaveBeenCalledWith(
        expect.stringMatching(/ethereum:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48@1\/transfer\?address=0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb&uint256=100000000/),
        expect.any(Object)
      );

      // USDC on Polygon - EIP-681 format (all EVM chains use ethereum: scheme)
      vi.mocked(QRCode.toDataURL).mockResolvedValueOnce(mockDataURL);
      await generatePaymentQR({
        blockchain: 'USDC_POL',
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        amount: 100,
      });
      // Should use USDC contract address on Polygon (chain ID 137)
      expect(QRCode.toDataURL).toHaveBeenCalledWith(
        expect.stringMatching(/ethereum:0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359@137\/transfer\?address=0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb&uint256=100000000/),
        expect.any(Object)
      );
    });

    it('should generate Polygon payment QR code with EIP-681 format', async () => {
      const mockDataURL = 'data:image/png;base64,test';
      vi.mocked(QRCode.toDataURL).mockResolvedValueOnce(mockDataURL);

      await generatePaymentQR({
        blockchain: 'POL',
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        amount: 1,
      });

      // EIP-681: all EVM chains use ethereum: scheme with chain ID
      expect(QRCode.toDataURL).toHaveBeenCalledWith(
        expect.stringMatching(/ethereum:0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb@137\?value=1000000000000000000/),
        expect.any(Object)
      );
    });

    it('should generate USDC on Solana with SPL token format', async () => {
      const mockDataURL = 'data:image/png;base64,test';
      vi.mocked(QRCode.toDataURL).mockResolvedValueOnce(mockDataURL);

      await generatePaymentQR({
        blockchain: 'USDC_SOL',
        address: '7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK',
        amount: 50,
      });

      // Solana Pay format with SPL token
      expect(QRCode.toDataURL).toHaveBeenCalledWith(
        expect.stringMatching(/solana:7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK\?amount=50&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/),
        expect.any(Object)
      );
    });
  });
});