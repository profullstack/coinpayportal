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
        // Look for "0 BTC" pattern
        expect(screen.getByText(/0 BTC/)).toBeInTheDocument();
      });

      // Verify NaN is not displayed
      expect(screen.queryByText('NaN')).not.toBeInTheDocument();
    });

    it('should display currency in uppercase', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('ETH')).toBeInTheDocument();
        expect(screen.getByText('SOL')).toBeInTheDocument();
        expect(screen.getByText('BTC')).toBeInTheDocument();
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

    it('should display expand button for payment split details', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        // Each payment row should have an expand button
        const expandButtons = document.querySelectorAll('button[title*="split details"]');
        expect(expandButtons.length).toBe(3);
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
        // Currency column shows N/A for undefined currency
        // The third payment has null payment_address but BTC currency
        expect(screen.getByText('BTC')).toBeInTheDocument();
      });
    });
  });

  describe('Copy Functionality', () => {
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

    it('should copy address to clipboard when copy button clicked in expanded view', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        screen.getByText(/0\.05000000/);
      });

      // Expand the first payment to see the address
      const expandButtons = document.querySelectorAll('button[title*="split details"]');
      await act(async () => {
        fireEvent.click(expandButtons[0]);
      });

      await waitFor(() => {
        screen.getByText(/Payment Address:/i);
      });

      // Find copy buttons in expanded view
      const copyButtons = screen.getAllByTitle(/copy address/i);
      expect(copyButtons.length).toBeGreaterThan(0);

      await act(async () => {
        fireEvent.click(copyButtons[0]);
      });

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        '0x1234567890abcdef1234567890abcdef12345678'
      );
    });

    it('should show checkmark after copying', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        screen.getByText(/0\.05000000/);
      });

      // Expand the first payment
      const expandButtons = document.querySelectorAll('button[title*="split details"]');
      await act(async () => {
        fireEvent.click(expandButtons[0]);
      });

      await waitFor(() => {
        screen.getByText(/Payment Address:/i);
      });

      const copyButtons = screen.getAllByTitle(/copy address/i);
      
      await act(async () => {
        fireEvent.click(copyButtons[0]);
      });

      // After clicking, the checkmark should appear
      await waitFor(() => {
        const checkmarks = document.querySelectorAll('svg path[d*="M5 13l4 4L19 7"]');
        expect(checkmarks.length).toBeGreaterThan(0);
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
        expect(screen.getByText('N/A')).toBeInTheDocument();
      });
    });
  });

  describe('Payment Split Breakdown', () => {
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

    it('should display expand/collapse button for each payment', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        // Each payment row should have an expand button (chevron)
        const expandButtons = document.querySelectorAll('button[title*="split details"]');
        expect(expandButtons.length).toBe(3);
      });
    });

    it('should expand payment details when clicking expand button', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        screen.getByText(/0\.05000000/);
      });

      // Find and click the expand button for the first payment
      const expandButtons = document.querySelectorAll('button[title*="split details"]');
      
      await act(async () => {
        fireEvent.click(expandButtons[0]);
      });

      // After expanding, should show merchant split info
      await waitFor(() => {
        expect(screen.getByText(/Merchant \(99\.5%\)/)).toBeInTheDocument();
      });
    });

    it('should display merchant amount in expanded view', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        screen.getByText(/0\.05000000/);
      });

      const expandButtons = document.querySelectorAll('button[title*="split details"]');
      
      await act(async () => {
        fireEvent.click(expandButtons[0]);
      });

      await waitFor(() => {
        // Should show the merchant amount from the API
        expect(screen.getByText(/0\.04975000/)).toBeInTheDocument();
      });
    });

    it('should display platform fee in expanded view', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        screen.getByText(/0\.05000000/);
      });

      const expandButtons = document.querySelectorAll('button[title*="split details"]');
      
      await act(async () => {
        fireEvent.click(expandButtons[0]);
      });

      await waitFor(() => {
        expect(screen.getByText(/Platform Fee \(0\.5%\)/)).toBeInTheDocument();
        // Should show the fee amount from the API
        expect(screen.getByText(/0\.00025000/)).toBeInTheDocument();
      });
    });

    it('should collapse expanded view when clicking again', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        screen.getByText(/0\.05000000/);
      });

      const expandButtons = document.querySelectorAll('button[title*="split details"]');
      
      // Expand
      await act(async () => {
        fireEvent.click(expandButtons[0]);
      });

      await waitFor(() => {
        expect(screen.getByText(/Merchant \(99\.5%\)/)).toBeInTheDocument();
      });

      // Collapse
      await act(async () => {
        fireEvent.click(expandButtons[0]);
      });

      await waitFor(() => {
        expect(screen.queryByText(/Merchant \(99\.5%\)/)).not.toBeInTheDocument();
      });
    });

    it('should calculate split dynamically when API values are null', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        screen.getByText(/0\.10000000/);
      });

      // Expand the second payment (which has null merchant_amount and fee_amount)
      const expandButtons = document.querySelectorAll('button[title*="split details"]');
      
      await act(async () => {
        fireEvent.click(expandButtons[1]);
      });

      await waitFor(() => {
        // Should calculate: 0.1 * 0.995 = 0.0995 for merchant
        expect(screen.getByText(/0\.09950000/)).toBeInTheDocument();
        // Should calculate: 0.1 * 0.005 = 0.0005 for platform fee
        expect(screen.getByText(/0\.00050000/)).toBeInTheDocument();
      });
    });
  });

  describe('Merchant Wallet Address Display', () => {
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

    it('should display truncated merchant wallet address in expanded view', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        screen.getByText(/0\.05000000/);
      });

      const expandButtons = document.querySelectorAll('button[title*="split details"]');
      
      await act(async () => {
        fireEvent.click(expandButtons[0]);
      });

      await waitFor(() => {
        // Merchant address should be truncated (short format: 6...4)
        expect(screen.getByText(/0xabcd\.\.\.ef12/)).toBeInTheDocument();
      });
    });

    it('should copy merchant wallet address when copy button clicked', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        screen.getByText(/0\.05000000/);
      });

      const expandButtons = document.querySelectorAll('button[title*="split details"]');
      
      await act(async () => {
        fireEvent.click(expandButtons[0]);
      });

      await waitFor(() => {
        screen.getByText(/0xabcd\.\.\.ef12/);
      });

      // Find and click the copy button for merchant address
      const copyButtons = screen.getAllByTitle(/copy merchant address/i);
      
      await act(async () => {
        fireEvent.click(copyButtons[0]);
      });

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        '0xabcdef1234567890abcdef1234567890abcdef12'
      );
    });
  });

  describe('Blockchain Explorer Links', () => {
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

    it('should display explorer link for payment address', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        screen.getByText(/0\.05000000/);
      });

      const expandButtons = document.querySelectorAll('button[title*="split details"]');
      
      await act(async () => {
        fireEvent.click(expandButtons[0]);
      });

      await waitFor(() => {
        // Should have explorer link for ETH address
        const explorerLinks = screen.getAllByTitle(/view on blockchain explorer/i);
        expect(explorerLinks.length).toBeGreaterThan(0);
        
        // Check the link points to etherscan
        const etherscanLink = explorerLinks.find(link =>
          link.getAttribute('href')?.includes('etherscan.io')
        );
        expect(etherscanLink).toBeInTheDocument();
      });
    });

    it('should display explorer link for merchant wallet address', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        screen.getByText(/0\.05000000/);
      });

      const expandButtons = document.querySelectorAll('button[title*="split details"]');
      
      await act(async () => {
        fireEvent.click(expandButtons[0]);
      });

      await waitFor(() => {
        const explorerLinks = screen.getAllByTitle(/view on blockchain explorer/i);
        // Should have links for both payment address and merchant address
        expect(explorerLinks.length).toBeGreaterThanOrEqual(2);
      });
    });

    it('should display explorer link for forward transaction hash', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        screen.getByText(/0\.05000000/);
      });

      const expandButtons = document.querySelectorAll('button[title*="split details"]');
      
      await act(async () => {
        fireEvent.click(expandButtons[0]);
      });

      await waitFor(() => {
        // Should show forward TX section
        expect(screen.getByText(/Forward TX/i)).toBeInTheDocument();
        
        // Should have explorer link for transaction
        const txExplorerLinks = screen.getAllByTitle(/view transaction on explorer/i);
        expect(txExplorerLinks.length).toBeGreaterThan(0);
      });
    });

    it('should open explorer links in new tab', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        screen.getByText(/0\.05000000/);
      });

      const expandButtons = document.querySelectorAll('button[title*="split details"]');
      
      await act(async () => {
        fireEvent.click(expandButtons[0]);
      });

      await waitFor(() => {
        const explorerLinks = screen.getAllByTitle(/view on blockchain explorer/i);
        explorerLinks.forEach(link => {
          expect(link).toHaveAttribute('target', '_blank');
          expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        });
      });
    });

    it('should use correct explorer URL for SOL currency', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        screen.getByText(/0\.10000000/);
      });

      // Expand the SOL payment (second one)
      const expandButtons = document.querySelectorAll('button[title*="split details"]');
      
      await act(async () => {
        fireEvent.click(expandButtons[1]);
      });

      await waitFor(() => {
        const explorerLinks = screen.getAllByTitle(/view on blockchain explorer/i);
        const solscanLink = explorerLinks.find(link =>
          link.getAttribute('href')?.includes('solscan.io')
        );
        expect(solscanLink).toBeInTheDocument();
      });
    });
  });

  describe('Forward Transaction Display', () => {
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

    it('should display forward transaction hash when available', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        screen.getByText(/0\.05000000/);
      });

      const expandButtons = document.querySelectorAll('button[title*="split details"]');
      
      await act(async () => {
        fireEvent.click(expandButtons[0]);
      });

      await waitFor(() => {
        expect(screen.getByText(/Forward TX/i)).toBeInTheDocument();
        // TX hash should be truncated
        expect(screen.getByText(/0xtxha\.\.\.90ab/)).toBeInTheDocument();
      });
    });

    it('should display forwarded timestamp when available', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        screen.getByText(/0\.05000000/);
      });

      const expandButtons = document.querySelectorAll('button[title*="split details"]');
      
      await act(async () => {
        fireEvent.click(expandButtons[0]);
      });

      await waitFor(() => {
        expect(screen.getByText(/Forwarded:/i)).toBeInTheDocument();
      });
    });

    it('should not display forward TX section when no transaction hash', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        screen.getByText(/0\.10000000/);
      });

      // Expand the second payment (which has no forward_tx_hash)
      const expandButtons = document.querySelectorAll('button[title*="split details"]');
      
      await act(async () => {
        fireEvent.click(expandButtons[1]);
      });

      await waitFor(() => {
        // Should show merchant split but not forward TX
        expect(screen.getByText(/Merchant \(99\.5%\)/)).toBeInTheDocument();
      });

      // Forward TX section should not be present
      const forwardTxElements = screen.queryAllByText(/Forward TX/i);
      expect(forwardTxElements.length).toBe(0);
    });

    it('should copy forward transaction hash when copy button clicked', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        screen.getByText(/0\.05000000/);
      });

      const expandButtons = document.querySelectorAll('button[title*="split details"]');
      
      await act(async () => {
        fireEvent.click(expandButtons[0]);
      });

      await waitFor(() => {
        screen.getByText(/Forward TX/i);
      });

      // Find and click the copy button for transaction hash
      const copyButtons = screen.getAllByTitle(/copy transaction hash/i);
      
      await act(async () => {
        fireEvent.click(copyButtons[0]);
      });

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        '0xtxhash1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab'
      );
    });
  });

  describe('Payment Address in Expanded View', () => {
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

    it('should display payment address section in expanded view', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        screen.getByText(/0\.05000000/);
      });

      const expandButtons = document.querySelectorAll('button[title*="split details"]');
      
      await act(async () => {
        fireEvent.click(expandButtons[0]);
      });

      await waitFor(() => {
        expect(screen.getByText(/Payment Address:/i)).toBeInTheDocument();
      });
    });

    it('should copy payment address from expanded view', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        screen.getByText(/0\.05000000/);
      });

      const expandButtons = document.querySelectorAll('button[title*="split details"]');
      
      await act(async () => {
        fireEvent.click(expandButtons[0]);
      });

      await waitFor(() => {
        screen.getByText(/Payment Address:/i);
      });

      // Find copy button in the expanded payment address section
      const copyButtons = screen.getAllByTitle(/copy address/i);
      
      await act(async () => {
        fireEvent.click(copyButtons[0]);
      });

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        '0x1234567890abcdef1234567890abcdef12345678'
      );
    });
  });
});