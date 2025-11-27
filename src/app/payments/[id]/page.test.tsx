/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { useRouter, useParams } from 'next/navigation';
import PaymentDetailPage from './page';

// Mock Next.js router and params
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
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

describe('PaymentDetailPage', () => {
  const mockPush = vi.fn();
  const mockRouter = {
    push: mockPush,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  };

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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRouter).mockReturnValue(mockRouter);
    vi.mocked(useParams).mockReturnValue({ id: 'payment-123' });
    localStorage.clear();
    localStorage.setItem('auth_token', 'test-token');
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Loading State', () => {
    it('should show loading spinner initially', () => {
      vi.mocked(fetch).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<PaymentDetailPage />);

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

      render(<PaymentDetailPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /payment not found/i })).toBeInTheDocument();
      });
    });

    it('should have button to view payment history on error', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          success: false,
          error: 'Payment not found',
        }),
      } as Response);

      render(<PaymentDetailPage />);

      await waitFor(() => {
        const historyButton = screen.getByText(/view payment history/i);
        expect(historyButton).toBeInTheDocument();
      });
    });

    it('should redirect to login if no token', async () => {
      localStorage.removeItem('auth_token');

      render(<PaymentDetailPage />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/login');
      });
    });
  });

  describe('Payment Display', () => {
    beforeEach(() => {
      // Return confirmed payment to avoid polling/timer issues
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'confirmed' },
        }),
      } as Response);
    });

    it('should display payment address', async () => {
      render(<PaymentDetailPage />);

      await waitFor(() => {
        expect(screen.getByText(mockPayment.payment_address)).toBeInTheDocument();
      });
    });

    it('should display crypto amount', async () => {
      render(<PaymentDetailPage />);

      await waitFor(() => {
        expect(screen.getByText(/0\.05000000/)).toBeInTheDocument();
        // ETH appears in multiple places, just check the amount is displayed
        expect(screen.getByText(/0\.05000000.*ETH/)).toBeInTheDocument();
      });
    });

    it('should display USD amount', async () => {
      render(<PaymentDetailPage />);

      await waitFor(() => {
        expect(screen.getByText(/\$100\.00/)).toBeInTheDocument();
      });
    });

    it('should display payment ID', async () => {
      render(<PaymentDetailPage />);

      await waitFor(() => {
        expect(screen.getByText(mockPayment.id)).toBeInTheDocument();
      });
    });

    it('should display description if present', async () => {
      render(<PaymentDetailPage />);

      await waitFor(() => {
        expect(screen.getByText(mockPayment.description)).toBeInTheDocument();
      });
    });

    it('should display status in payment details section', async () => {
      render(<PaymentDetailPage />);

      await waitFor(() => {
        // Status label should be present
        expect(screen.getByText('Status:')).toBeInTheDocument();
        // Status value should be capitalized (Confirmed)
        expect(screen.getByText('Confirmed')).toBeInTheDocument();
      });
    });
  });

  describe('QR Code Display', () => {
    it('should display QR code for pending payment', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: mockPayment,
        }),
      } as Response);

      render(<PaymentDetailPage />);

      await waitFor(() => {
        const qrImage = screen.getByAltText(/payment qr code/i);
        expect(qrImage).toBeInTheDocument();
        expect(qrImage).toHaveAttribute('src', `/api/payments/${mockPayment.id}/qr`);
      });
    });

    it('should not show QR code for confirmed payment', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'confirmed' },
        }),
      } as Response);

      render(<PaymentDetailPage />);

      await waitFor(() => {
        screen.getByText(/payment confirmed/i);
      });

      expect(screen.queryByAltText(/payment qr code/i)).not.toBeInTheDocument();
    });

    it('should not show QR code for expired payment', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'expired' },
        }),
      } as Response);

      render(<PaymentDetailPage />);

      await waitFor(() => {
        screen.getByText(/payment expired/i);
      });

      expect(screen.queryByAltText(/payment qr code/i)).not.toBeInTheDocument();
    });

    it('should not show QR code when payment_address is missing', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, payment_address: null },
        }),
      } as Response);

      render(<PaymentDetailPage />);

      await waitFor(() => {
        expect(screen.getByText(/payment address is being generated/i)).toBeInTheDocument();
      });

      expect(screen.queryByAltText(/payment qr code/i)).not.toBeInTheDocument();
    });

    it('should show loading spinner while QR code is loading', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: mockPayment,
        }),
      } as Response);

      render(<PaymentDetailPage />);

      await waitFor(() => {
        // QR code section should be present
        expect(screen.getByText(/qr code/i)).toBeInTheDocument();
      });
    });
  });

  describe('Missing Payment Address', () => {
    it('should show warning message when payment address is missing', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, payment_address: null },
        }),
      } as Response);

      render(<PaymentDetailPage />);

      await waitFor(() => {
        expect(screen.getByText(/payment address is being generated/i)).toBeInTheDocument();
      });
    });

    it('should show payment address when available', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'confirmed' },
        }),
      } as Response);

      render(<PaymentDetailPage />);

      await waitFor(() => {
        expect(screen.getByText(mockPayment.payment_address)).toBeInTheDocument();
      });
    });
  });

  describe('Status Display', () => {
    it('should show pending status', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'pending' },
        }),
      } as Response);

      render(<PaymentDetailPage />);

      await waitFor(() => {
        expect(screen.getByText(/waiting for payment/i)).toBeInTheDocument();
      });
    });

    it('should show detected status', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'detected' },
        }),
      } as Response);

      render(<PaymentDetailPage />);

      await waitFor(() => {
        expect(screen.getByText(/payment detected/i)).toBeInTheDocument();
      });
    });

    it('should show confirmed status', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'confirmed' },
        }),
      } as Response);

      render(<PaymentDetailPage />);

      await waitFor(() => {
        expect(screen.getByText(/payment confirmed/i)).toBeInTheDocument();
      });
    });

    it('should show forwarded status', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'forwarded' },
        }),
      } as Response);

      render(<PaymentDetailPage />);

      await waitFor(() => {
        expect(screen.getByText(/payment complete/i)).toBeInTheDocument();
      });
    });

    it('should show expired status', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'expired' },
        }),
      } as Response);

      render(<PaymentDetailPage />);

      await waitFor(() => {
        expect(screen.getByText(/payment expired/i)).toBeInTheDocument();
      });
    });

    it('should show failed status', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'failed' },
        }),
      } as Response);

      render(<PaymentDetailPage />);

      await waitFor(() => {
        expect(screen.getByText(/payment failed/i)).toBeInTheDocument();
      });
    });
  });

  describe('Copy Functionality', () => {
    beforeEach(() => {
      // Use confirmed status to avoid polling
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'confirmed' },
        }),
      } as Response);
    });

    it('should copy address to clipboard when copy button clicked', async () => {
      render(<PaymentDetailPage />);

      await waitFor(() => {
        screen.getByText(mockPayment.payment_address);
      });

      // Find copy button for address (first copy button)
      const copyButtons = screen.getAllByTitle(/copy/i);
      await act(async () => {
        fireEvent.click(copyButtons[0]);
      });

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockPayment.payment_address);
    });

    it('should copy amount to clipboard when copy button clicked', async () => {
      render(<PaymentDetailPage />);

      await waitFor(() => {
        screen.getByText(/0\.05000000/);
      });

      // Find copy button for amount (second copy button)
      const copyButtons = screen.getAllByTitle(/copy/i);
      await act(async () => {
        fireEvent.click(copyButtons[1]);
      });

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('0.05000000');
    });
  });

  describe('Navigation', () => {
    beforeEach(() => {
      // Use confirmed status to avoid polling
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'confirmed' },
        }),
      } as Response);
    });

    it('should have link to view all payments', async () => {
      render(<PaymentDetailPage />);

      await waitFor(() => {
        const viewAllButton = screen.getByText(/view all payments/i);
        expect(viewAllButton).toBeInTheDocument();
      });
    });

    it('should have link to create new payment', async () => {
      render(<PaymentDetailPage />);

      await waitFor(() => {
        const createButton = screen.getByText(/create new payment/i);
        expect(createButton).toBeInTheDocument();
      });
    });

    it('should navigate to payment history when clicking view all', async () => {
      render(<PaymentDetailPage />);

      await waitFor(() => {
        screen.getByText(/view all payments/i);
      });

      const viewAllButton = screen.getByText(/view all payments/i);
      fireEvent.click(viewAllButton);

      expect(mockPush).toHaveBeenCalledWith('/payments/history');
    });

    it('should navigate to create payment when clicking create new', async () => {
      render(<PaymentDetailPage />);

      await waitFor(() => {
        screen.getByText(/create new payment/i);
      });

      const createButton = screen.getByText(/create new payment/i);
      fireEvent.click(createButton);

      expect(mockPush).toHaveBeenCalledWith('/payments/create');
    });
  });

  describe('Timer Display', () => {
    it('should show countdown timer for pending payment', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: mockPayment,
        }),
      } as Response);

      render(<PaymentDetailPage />);

      await waitFor(() => {
        // Timer should be displayed in MM:SS format - use getAllByText since there may be multiple
        const timerElements = screen.getAllByText(/\d{2}:\d{2}/);
        expect(timerElements.length).toBeGreaterThan(0);
      });
    });

    it('should not show timer for completed payment', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'confirmed' },
        }),
      } as Response);

      render(<PaymentDetailPage />);

      await waitFor(() => {
        screen.getByText(/payment confirmed/i);
      });

      // Timer should not be visible for confirmed payments
      expect(screen.queryByText(/waiting for payment/i)).not.toBeInTheDocument();
    });
  });

  describe('QR Code Persistence', () => {
    it('should show QR code for pending payment even with old created_at', async () => {
      // Create a payment that was created 20 minutes ago (past the 15 min expiry)
      // but server still says it's pending - QR should still show
      const oldCreatedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: {
            ...mockPayment,
            status: 'pending',
            created_at: oldCreatedAt,
          },
        }),
      } as Response);

      render(<PaymentDetailPage />);

      await waitFor(() => {
        // QR code should still be visible because server status is 'pending'
        const qrImage = screen.getByAltText(/payment qr code/i);
        expect(qrImage).toBeInTheDocument();
      });
    });

    it('should show QR code for detected payment even with old created_at', async () => {
      // Create a payment that was created 20 minutes ago but is in 'detected' status
      const oldCreatedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: {
            ...mockPayment,
            status: 'detected',
            created_at: oldCreatedAt,
          },
        }),
      } as Response);

      render(<PaymentDetailPage />);

      await waitFor(() => {
        // QR code should still be visible because server status is 'detected'
        const qrImage = screen.getByAltText(/payment qr code/i);
        expect(qrImage).toBeInTheDocument();
      });
    });

    it('should not show QR code when server status is expired', async () => {
      // Payment is expired on the server - QR should not show
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: {
            ...mockPayment,
            status: 'expired',
          },
        }),
      } as Response);

      render(<PaymentDetailPage />);

      await waitFor(() => {
        screen.getByText(/payment expired/i);
      });

      expect(screen.queryByAltText(/payment qr code/i)).not.toBeInTheDocument();
    });

    it('should use expires_at field for time calculation when available', async () => {
      // Payment with explicit expires_at in the future
      const futureExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes from now
      const oldCreatedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 minutes ago
      
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: {
            ...mockPayment,
            status: 'pending',
            created_at: oldCreatedAt,
            expires_at: futureExpiresAt,
          },
        }),
      } as Response);

      render(<PaymentDetailPage />);

      await waitFor(() => {
        // Timer should show time remaining based on expires_at, not created_at
        // Since expires_at is 10 minutes in the future, timer should show ~10:00
        const timerElements = screen.getAllByText(/\d{2}:\d{2}/);
        expect(timerElements.length).toBeGreaterThan(0);
        // The timer should show something around 09:xx or 10:xx
        const timerText = timerElements[0].textContent;
        expect(timerText).toMatch(/^(09|10):\d{2}$/);
      });
    });
  });

  describe('Polling Behavior', () => {
    it('should not poll for confirmed payment', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'confirmed' },
        }),
      } as Response);

      render(<PaymentDetailPage />);

      await waitFor(() => {
        screen.getByText(/payment confirmed/i);
      });

      // Wait a bit and verify no additional fetches
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should not poll for expired payment', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'expired' },
        }),
      } as Response);

      render(<PaymentDetailPage />);

      await waitFor(() => {
        screen.getByText(/payment expired/i);
      });

      // Wait a bit and verify no additional fetches
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should not poll for failed payment', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: { ...mockPayment, status: 'failed' },
        }),
      } as Response);

      render(<PaymentDetailPage />);

      await waitFor(() => {
        screen.getByText(/payment failed/i);
      });

      // Wait a bit and verify no additional fetches
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });
});