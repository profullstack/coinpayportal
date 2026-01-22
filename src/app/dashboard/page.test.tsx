/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import DashboardPage from './page';

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}));

// Mock the realtime payments hook
vi.mock('@/lib/realtime/useRealtimePayments', () => ({
  useRealtimePayments: vi.fn(() => ({
    isConnected: true,
    payments: [],
  })),
}));

// Mock fetch globally
global.fetch = vi.fn();

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

describe('DashboardPage', () => {
  const mockPush = vi.fn();
  const mockRouter = {
    push: mockPush,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  };

  const mockStats = {
    total_payments: 100,
    successful_payments: 85,
    pending_payments: 10,
    failed_payments: 5,
    total_volume: '1.50000000',
    total_volume_usd: '5000.00',
  };

  const mockRecentPayments = [
    {
      id: 'payment-123-abc-def-456',
      amount_crypto: '0.05000000',
      amount_usd: '100.00',
      currency: 'eth',
      status: 'completed',
      created_at: new Date().toISOString(),
      payment_address: '0x1234567890abcdef1234567890abcdef12345678',
      merchant_wallet_address: '0xabcdef1234567890abcdef1234567890abcdef12',
      merchant_amount: '0.04975000',
      fee_amount: '0.00025000',
      forward_tx_hash: '0xtxhash1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
      forwarded_at: new Date().toISOString(),
    },
    {
      id: 'payment-789-ghi-jkl-012',
      amount_crypto: '0.10000000',
      amount_usd: '200.00',
      currency: 'sol',
      status: 'pending',
      created_at: new Date().toISOString(),
      payment_address: 'So11111111111111111111111111111111111111112',
      merchant_wallet_address: 'So22222222222222222222222222222222222222223',
      merchant_amount: null,
      fee_amount: null,
      forward_tx_hash: null,
      forwarded_at: null,
    },
    {
      id: 'payment-345-mno-pqr-678',
      amount_crypto: null,
      amount_usd: null,
      currency: 'btc',
      status: 'failed',
      created_at: new Date().toISOString(),
      payment_address: null,
      merchant_wallet_address: null,
      merchant_amount: null,
      fee_amount: null,
      forward_tx_hash: null,
      forwarded_at: null,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRouter).mockReturnValue(mockRouter);
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

      render(<DashboardPage />);

      expect(screen.getByText(/loading dashboard/i)).toBeInTheDocument();
    });
  });

  describe('Authentication', () => {
    it('should redirect to login if no token', async () => {
      localStorage.removeItem('auth_token');

      render(<DashboardPage />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/login');
      });
    });
  });

  describe('Error State', () => {
    it('should show error message when API fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          success: false,
          error: 'Failed to load dashboard data',
        }),
      } as Response);

      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText(/failed to load dashboard data/i)).toBeInTheDocument();
      });
    });
  });

  describe('Stats Display', () => {
    beforeEach(() => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          stats: mockStats,
          recent_payments: mockRecentPayments,
        }),
      } as Response);
    });

    it('should display total payments count', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('100')).toBeInTheDocument();
      });
    });

    it('should display successful payments count', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('85')).toBeInTheDocument();
      });
    });

    it('should display pending payments count', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('10')).toBeInTheDocument();
      });
    });

    it('should display failed payments count', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('5')).toBeInTheDocument();
      });
    });

    it('should display total volume in USD', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        // The API returns "5000.00" as a string, toLocaleString formats it
        expect(screen.getByText(/\$5,?000/)).toBeInTheDocument();
      });
    });

    it('should display success rate percentage', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        // 85/100 = 85%
        expect(screen.getByText(/85.*%/)).toBeInTheDocument();
      });
    });
  });

  describe('Recent Payments Table', () => {
    beforeEach(() => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          stats: mockStats,
          recent_payments: mockRecentPayments,
        }),
      } as Response);
    });

    it('should display payment IDs as clickable links', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        // Payment ID is truncated to first 8 chars + "..."
        const paymentLinks = screen.getAllByRole('link');
        const paymentDetailLink = paymentLinks.find(link =>
          link.getAttribute('href')?.includes('/payments/payment-123')
        );
        expect(paymentDetailLink).toBeInTheDocument();
      });
    });

    it('should display crypto amounts correctly', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        // Amounts now include currency, e.g., "0.05000000 ETH"
        expect(screen.getByText(/0\.05000000 ETH/)).toBeInTheDocument();
        expect(screen.getByText(/0\.10000000 SOL/)).toBeInTheDocument();
      });
    });

    it('should display USD amounts correctly', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        // USD amounts are shown as "$100.00 USD"
        expect(screen.getByText(/\$100\.00 USD/)).toBeInTheDocument();
        expect(screen.getByText(/\$200\.00 USD/)).toBeInTheDocument();
      });
    });

    it('should handle null/undefined amounts without NaN', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        // The third payment has null amounts - should show "0" not "NaN"
        // Look for "0 BTC" pattern (appears in Total, Commission, Take Home columns)
        const btcElements = screen.getAllByText(/0.*BTC/);
        expect(btcElements.length).toBeGreaterThan(0);
      });

      // Verify NaN is not displayed
      expect(screen.queryByText('NaN')).not.toBeInTheDocument();
    });

    it('should display currency in uppercase', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        // Currencies appear multiple times per row (Total, Commission, Take Home columns)
        const ethElements = screen.getAllByText(/ETH/);
        const solElements = screen.getAllByText(/SOL/);
        const btcElements = screen.getAllByText(/BTC/);
        expect(ethElements.length).toBeGreaterThan(0);
        expect(solElements.length).toBeGreaterThan(0);
        expect(btcElements.length).toBeGreaterThan(0);
      });
    });

    it('should display payment status badges', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('completed')).toBeInTheDocument();
        expect(screen.getByText('pending')).toBeInTheDocument();
        expect(screen.getByText('failed')).toBeInTheDocument();
      });
    });

    it('should display commission and take home columns', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        // Table should have Commission and Take Home headers
        expect(screen.getByText('Commission')).toBeInTheDocument();
        expect(screen.getByText('Take Home')).toBeInTheDocument();
      });
    });

    it('should display "View Details" buttons', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        const viewButtons = screen.getAllByText(/view details/i);
        expect(viewButtons.length).toBe(3); // One for each payment
      });
    });

    it('should handle null payment address gracefully', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        // The third payment has null payment_address but BTC currency
        // BTC appears multiple times (Total, Commission, Take Home columns)
        const btcElements = screen.getAllByText(/BTC/);
        expect(btcElements.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Commission and Take Home Display', () => {
    beforeEach(() => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          stats: mockStats,
          recent_payments: mockRecentPayments,
        }),
      } as Response);
    });

    it('should display commission amounts in table', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        // Should show the fee amount from the API (0.00025 for first payment)
        expect(screen.getByText(/0\.00025000/)).toBeInTheDocument();
      });
    });

    it('should display take home amounts in table', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        // Should show the merchant amount from the API (0.04975 for first payment)
        expect(screen.getByText(/0\.04975000/)).toBeInTheDocument();
      });
    });

    it('should show 0.5% label for commission', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        const labels = screen.getAllByText(/0\.5%/);
        expect(labels.length).toBeGreaterThan(0);
      });
    });

    it('should show 99.5% label for take home', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        const labels = screen.getAllByText(/99\.5%/);
        expect(labels.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Navigation Links', () => {
    beforeEach(() => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          stats: mockStats,
          recent_payments: mockRecentPayments,
        }),
      } as Response);
    });

    it('should have link to create payment', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        const createLinks = screen.getAllByText(/create payment/i);
        expect(createLinks.length).toBeGreaterThan(0);
      });
    });

    it('should have link to manage businesses', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText(/manage businesses/i)).toBeInTheDocument();
      });
    });

    it('should link payment ID to payment detail page', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        const paymentLinks = screen.getAllByRole('link');
        const paymentDetailLink = paymentLinks.find(link => 
          link.getAttribute('href')?.includes('/payments/payment-123')
        );
        expect(paymentDetailLink).toBeInTheDocument();
      });
    });

    it('should link View Details button to payment detail page', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        const viewButtons = screen.getAllByText(/view details/i);
        const firstButton = viewButtons[0].closest('a');
        expect(firstButton).toHaveAttribute('href', '/payments/payment-123-abc-def-456');
      });
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no payments', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          stats: {
            total_payments: 0,
            successful_payments: 0,
            pending_payments: 0,
            failed_payments: 0,
            total_volume: '0',
            total_volume_usd: 0,
          },
          recent_payments: [],
        }),
      } as Response);

      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText(/no payments yet/i)).toBeInTheDocument();
      });
    });

    it('should show create payment button in empty state', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          stats: {
            total_payments: 0,
            successful_payments: 0,
            pending_payments: 0,
            failed_payments: 0,
            total_volume: '0',
            total_volume_usd: 0,
          },
          recent_payments: [],
        }),
      } as Response);

      render(<DashboardPage />);

      await waitFor(() => {
        const createButtons = screen.getAllByText(/create payment/i);
        expect(createButtons.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Connection Status', () => {
    it('should show live updates indicator when connected', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          stats: mockStats,
          recent_payments: mockRecentPayments,
        }),
      } as Response);

      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText(/live updates/i)).toBeInTheDocument();
      });
    });
  });

  describe('Status Colors', () => {
    beforeEach(() => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          stats: mockStats,
          recent_payments: mockRecentPayments,
        }),
      } as Response);
    });

    it('should apply green color to completed status', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        const completedBadge = screen.getByText('completed');
        expect(completedBadge).toHaveClass('bg-green-100', 'text-green-800');
      });
    });

    it('should apply yellow color to pending status', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        const pendingBadge = screen.getByText('pending');
        expect(pendingBadge).toHaveClass('bg-yellow-100', 'text-yellow-800');
      });
    });

    it('should apply red color to failed status', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        const failedBadge = screen.getByText('failed');
        expect(failedBadge).toHaveClass('bg-red-100', 'text-red-800');
      });
    });
  });

  describe('Date Formatting', () => {
    beforeEach(() => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          stats: mockStats,
          recent_payments: mockRecentPayments,
        }),
      } as Response);
    });

    it('should format dates correctly', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        // Date should be formatted like "Nov 27, 2025, 10:30 AM"
        const datePattern = /\w{3} \d{1,2}, \d{4}/;
        const dateElements = screen.getAllByText(datePattern);
        expect(dateElements.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Amount Formatting Edge Cases', () => {
    it('should handle empty string amounts', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          stats: mockStats,
          recent_payments: [{
            id: 'payment-empty',
            amount_crypto: '',
            amount_usd: '',
            currency: 'eth',
            status: 'pending',
            created_at: new Date().toISOString(),
            payment_address: '0x123',
          }],
        }),
      } as Response);

      render(<DashboardPage />);

      await waitFor(() => {
        // Should show "0" for empty amounts, not NaN
        expect(screen.queryByText('NaN')).not.toBeInTheDocument();
      });
    });

    it('should handle undefined currency', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          stats: mockStats,
          recent_payments: [{
            id: 'payment-no-currency',
            amount_crypto: '1.0',
            amount_usd: '100',
            currency: undefined,
            status: 'pending',
            created_at: new Date().toISOString(),
            payment_address: '0x123',
          }],
        }),
      } as Response);

      render(<DashboardPage />);

      await waitFor(() => {
        // Should display amounts without currency suffix when currency is undefined
        expect(screen.getByText(/1\.00000000/)).toBeInTheDocument();
        // Verify NaN is not displayed
        expect(screen.queryByText('NaN')).not.toBeInTheDocument();
      });
    });
  });

  describe('Payment Split Calculation', () => {
    beforeEach(() => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          stats: mockStats,
          recent_payments: mockRecentPayments,
        }),
      } as Response);
    });

    it('should display commission and take home for payments with API values', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        // First payment has merchant_amount and fee_amount from API
        expect(screen.getByText(/0\.04975000/)).toBeInTheDocument(); // merchant amount
        expect(screen.getByText(/0\.00025000/)).toBeInTheDocument(); // fee amount
      });
    });

    it('should calculate split dynamically when API values are null', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        // Second payment has null merchant_amount and fee_amount
        // Should calculate: 0.1 * 0.995 = 0.0995 for merchant
        expect(screen.getByText(/0\.09950000/)).toBeInTheDocument();
        // Should calculate: 0.1 * 0.005 = 0.0005 for platform fee
        expect(screen.getByText(/0\.00050000/)).toBeInTheDocument();
      });
    });
  });

});