/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { useParams } from 'next/navigation';
import PublicPaymentPage from './page';

// Mock Next.js router and params
vi.mock('next/navigation', () => ({
  useParams: vi.fn(),
}));

// Mock fetch globally
global.fetch = vi.fn();

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

describe('PublicPaymentPage', () => {
  const mockPayment = {
    id: 'payment-123',
    business_id: 'business-1',
    payment_address: '0x1234567890abcdef1234567890abcdef12345678',
    amount: '100.00',
    crypto_amount: '0.05000000',
    currency: 'USD',
    crypto_currency: 'ETH',
    blockchain: 'ETH',
    status: 'pending',
    description: 'Test payment',
    created_at: new Date().toISOString(),
  };

  const mockBusiness = {
    id: 'business-1',
    name: 'Test Business',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useParams).mockReturnValue({ id: 'payment-123' });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Loading State', () => {
    it('should show loading spinner initially', () => {
      vi.mocked(fetch).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<PublicPaymentPage />);

      expect(screen.getByText(/loading payment/i)).toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('should show error when payment not found', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          success: false,
          error: 'Payment not found',
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /payment not found/i })).toBeInTheDocument();
      });
    });

    it('should have link to homepage on error', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          success: false,
          error: 'Payment not found',
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        const homeButton = screen.getByText(/go to homepage/i);
        expect(homeButton).toBeInTheDocument();
      });
    });

    it('should NOT redirect to login (public page)', async () => {
      // Unlike the private payment page, this should NOT redirect to login
      // Use mockResolvedValue (not Once) because page makes multiple fetch calls
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'confirmed' },
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        // Should show payment content, not redirect
        expect(screen.getByText(/0\.05000000/)).toBeInTheDocument();
      });
    });
  });

  describe('Payment Display', () => {
    beforeEach(() => {
      // Return confirmed payment to avoid polling/timer issues
      // Use mockResolvedValue (not Once) because page makes multiple fetch calls
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'confirmed' },
        }),
      } as Response);
    });

    it('should display payment address', async () => {
      render(<PublicPaymentPage />);

      await waitFor(() => {
        expect(screen.getByText(mockPayment.payment_address)).toBeInTheDocument();
      });
    });

    it('should display crypto amount', async () => {
      render(<PublicPaymentPage />);

      await waitFor(() => {
        expect(screen.getByText(/0\.05000000/)).toBeInTheDocument();
      });
    });

    it('should display USD amount', async () => {
      render(<PublicPaymentPage />);

      await waitFor(() => {
        expect(screen.getByText(/\$100\.00/)).toBeInTheDocument();
      });
    });

    it('should display payment ID', async () => {
      render(<PublicPaymentPage />);

      await waitFor(() => {
        expect(screen.getByText(/payment-123/)).toBeInTheDocument();
      });
    });

    it('should display description if present', async () => {
      render(<PublicPaymentPage />);

      await waitFor(() => {
        expect(screen.getByText(mockPayment.description)).toBeInTheDocument();
      });
    });

    it('should display currency name', async () => {
      render(<PublicPaymentPage />);

      await waitFor(() => {
        expect(screen.getByText(/ethereum/i)).toBeInTheDocument();
      });
    });
  });

  describe('Business Display', () => {
    it('should display business name when available', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            payment: { ...mockPayment, status: 'confirmed' },
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            business: mockBusiness,
          }),
        } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        expect(screen.getByText(/payment to test business/i)).toBeInTheDocument();
      });
    });

    it('should not fail if business fetch fails', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            payment: { ...mockPayment, status: 'confirmed' },
          }),
        } as Response)
        .mockRejectedValueOnce(new Error('Business not found'));

      render(<PublicPaymentPage />);

      await waitFor(() => {
        // Should still show payment info even if business fetch fails
        expect(screen.getByText(/0\.05000000/)).toBeInTheDocument();
      });
    });
  });

  describe('QR Code Display', () => {
    it('should display QR code for pending payment', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: mockPayment,
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        const qrImage = screen.getByAltText(/payment qr code/i);
        expect(qrImage).toBeInTheDocument();
        expect(qrImage).toHaveAttribute('src', `/api/payments/${mockPayment.id}/qr`);
      });
    });

    it('should not show QR code for expired payment', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'expired' },
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        expect(screen.getByText(/payment expired/i)).toBeInTheDocument();
      });

      // QR code should not be visible for expired payments
      expect(screen.queryByAltText(/payment qr code/i)).not.toBeInTheDocument();
    });

    it('should not show QR code for failed payment', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'failed' },
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        expect(screen.getByText(/payment failed/i)).toBeInTheDocument();
      });

      // QR code should not be visible for failed payments
      expect(screen.queryByAltText(/payment qr code/i)).not.toBeInTheDocument();
    });
  });

  describe('Status Display', () => {
    it('should show awaiting payment status for pending', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'pending' },
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        expect(screen.getByText(/awaiting payment/i)).toBeInTheDocument();
      });
    });

    it('should show payment detected status', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'detected' },
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        expect(screen.getByText(/payment detected/i)).toBeInTheDocument();
      });
    });

    it('should show payment complete status for confirmed', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'confirmed' },
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        expect(screen.getByText(/payment complete/i)).toBeInTheDocument();
      });
    });

    it('should show payment complete status for forwarded', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'forwarded' },
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        expect(screen.getByText(/payment complete/i)).toBeInTheDocument();
      });
    });

    it('should show payment expired status', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'expired' },
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        expect(screen.getByText(/payment expired/i)).toBeInTheDocument();
      });
    });

    it('should show payment failed status', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'failed' },
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        expect(screen.getByText(/payment failed/i)).toBeInTheDocument();
      });
    });

    it('should show processing status for forwarding', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'forwarding' },
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        expect(screen.getByText(/processing/i)).toBeInTheDocument();
      });
    });
  });

  describe('Copy Functionality', () => {
    beforeEach(() => {
      // Use confirmed status to avoid polling
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'confirmed' },
        }),
      } as Response);
    });

    it('should copy address to clipboard when copy button clicked', async () => {
      render(<PublicPaymentPage />);

      await waitFor(() => {
        screen.getByText(mockPayment.payment_address);
      });

      // Find copy button for address
      const copyButtons = screen.getAllByTitle(/copy/i);
      await act(async () => {
        fireEvent.click(copyButtons[0]);
      });

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockPayment.payment_address);
    });

    it('should show copy amount button', async () => {
      render(<PublicPaymentPage />);

      await waitFor(() => {
        expect(screen.getByText(/copy amount/i)).toBeInTheDocument();
      });
    });
  });

  describe('Timer Display', () => {
    it('should show countdown timer for pending payment', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: mockPayment,
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        // Timer should be displayed in MM:SS format
        const timerElements = screen.getAllByText(/\d{2}:\d{2}/);
        expect(timerElements.length).toBeGreaterThan(0);
      });
    });

    it('should show "remaining" label with timer', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: mockPayment,
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        expect(screen.getByText(/remaining/i)).toBeInTheDocument();
      });
    });

    it('should not show timer for completed payment', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'confirmed' },
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        screen.getByText(/payment complete/i);
      });

      // Timer should not be visible for confirmed payments
      expect(screen.queryByText(/remaining/i)).not.toBeInTheDocument();
    });
  });

  describe('Transaction Links', () => {
    it('should show payment tx link for confirmed payment', async () => {
      const txHash = '0xpayment123456789abcdef1234567890abcdef';
      
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: {
            ...mockPayment,
            status: 'confirmed',
            tx_hash: txHash,
          },
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        expect(screen.getByText(/payment tx/i)).toBeInTheDocument();
      });

      // Should have a link to the explorer
      const txLinks = screen.getAllByRole('link');
      const explorerLink = txLinks.find(link =>
        link.getAttribute('href')?.includes('etherscan.io/tx/')
      );
      expect(explorerLink).toBeDefined();
    });

    it('should show both payment and forward tx links for forwarded payment', async () => {
      const txHash = '0xpayment123456789abcdef1234567890abcdef';
      const forwardTxHash = '0xforward987654321fedcba0987654321fedcba';
      
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: {
            ...mockPayment,
            status: 'forwarded',
            tx_hash: txHash,
            forward_tx_hash: forwardTxHash,
          },
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        expect(screen.getByText(/payment tx/i)).toBeInTheDocument();
        expect(screen.getByText(/forward tx/i)).toBeInTheDocument();
      });
    });

    it('should not show tx links for pending payment', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: {
            ...mockPayment,
            status: 'pending',
            tx_hash: null,
          },
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        expect(screen.getByText(/awaiting payment/i)).toBeInTheDocument();
      });

      // Should not show "Payment TX:" label
      expect(screen.queryByText(/payment tx/i)).not.toBeInTheDocument();
    });
  });

  describe('Branding', () => {
    it('should show CoinPay branding', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'confirmed' },
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        // There are multiple CoinPay elements (header and footer)
        const coinpayElements = screen.getAllByText(/coinpay/i);
        expect(coinpayElements.length).toBeGreaterThan(0);
      });
    });

    it('should show "Powered by CoinPay" footer', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'confirmed' },
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        expect(screen.getByText(/powered by/i)).toBeInTheDocument();
      });
    });
  });

  describe('Polling Behavior', () => {
    it('should not poll for confirmed payment with tx_hash', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'confirmed', tx_hash: '0xconfirmed123' },
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        screen.getByText(/payment complete/i);
      });

      // Wait a bit and verify no additional fetches beyond initial load
      // Page makes 2 initial calls: payment fetch + business fetch
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should not poll for expired payment', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'expired' },
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        screen.getByText(/payment expired/i);
      });

      // Wait a bit and verify no additional fetches beyond initial load
      // Page makes 2 initial calls: payment fetch + business fetch
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should not poll for failed payment', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'failed' },
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        screen.getByText(/payment failed/i);
      });

      // Wait a bit and verify no additional fetches beyond initial load
      // Page makes 2 initial calls: payment fetch + business fetch
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Currency Display', () => {
    it('should show Bitcoin name for BTC', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, blockchain: 'BTC', status: 'confirmed' },
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        expect(screen.getByText(/bitcoin/i)).toBeInTheDocument();
      });
    });

    it('should show Solana name for SOL', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, blockchain: 'SOL', status: 'confirmed' },
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        expect(screen.getByText(/solana/i)).toBeInTheDocument();
      });
    });

    it('should show Polygon name for MATIC', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, blockchain: 'MATIC', status: 'confirmed' },
        }),
      } as Response);

      render(<PublicPaymentPage />);

      await waitFor(() => {
        expect(screen.getByText(/polygon/i)).toBeInTheDocument();
      });
    });
  });
});