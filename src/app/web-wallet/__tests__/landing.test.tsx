import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebWalletPage from '../page';

const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: mockReplace }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

let mockState: any;

vi.mock('@/components/web-wallet/WalletContext', () => ({
  useWebWallet: () => mockState,
}));

vi.mock('@/components/web-wallet/WalletHeader', () => ({
  WalletHeader: () => <div data-testid="wallet-header">Header</div>,
}));

beforeEach(() => {
  mockReplace.mockReset();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: vi.fn(),
    },
  });
  mockState = {
    hasWallet: false,
    isUnlocked: false,
    isLoading: false,
    wallet: null,
  };
});

describe('WebWalletPage', () => {
  describe('Landing view (no wallet)', () => {
    it('should show landing page when no wallet exists', () => {
      render(<WebWalletPage />);

      expect(screen.getByText('CoinPay Wallet')).toBeInTheDocument();
      expect(
        screen.getByText(/Non-custodial multi-chain wallet/)
      ).toBeInTheDocument();
    });

    it('should show create and import buttons', () => {
      render(<WebWalletPage />);

      expect(screen.getByText('Create New Wallet')).toBeInTheDocument();
      expect(screen.getByText('Import Existing Wallet')).toBeInTheDocument();
    });

    it('should link to create page', () => {
      render(<WebWalletPage />);

      const link = screen.getByText('Create New Wallet').closest('a');
      expect(link).toHaveAttribute('href', '/web-wallet/create');
    });

    it('should link to import page', () => {
      render(<WebWalletPage />);

      const link = screen.getByText('Import Existing Wallet').closest('a');
      expect(link).toHaveAttribute('href', '/web-wallet/import');
    });

    it('should show privacy message', () => {
      render(<WebWalletPage />);

      expect(screen.getByText('No email. No KYC. No tracking.')).toBeInTheDocument();
    });
  });

  describe('Redirect when locked', () => {
    it('should redirect to unlock when wallet exists but is locked', () => {
      mockState = {
        hasWallet: true,
        isUnlocked: false,
        isLoading: false,
        wallet: null,
      };

      render(<WebWalletPage />);

      expect(mockReplace).toHaveBeenCalledWith('/web-wallet/unlock');
    });
  });

  describe('Loading state', () => {
    it('should show spinner when loading', () => {
      mockState = {
        hasWallet: false,
        isUnlocked: false,
        isLoading: true,
        wallet: null,
      };

      const { container } = render(<WebWalletPage />);
      expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    });
  });

  describe('Dashboard view (unlocked)', () => {
    it('should show dashboard when unlocked', async () => {
      const mockWallet = {
        getTotalBalanceUSD: vi.fn().mockResolvedValue({
          totalUsd: 0,
          balances: [],
        }),
        getTransactions: vi.fn().mockResolvedValue({
          transactions: [],
          total: 0,
        }),
      };

      mockState = {
        hasWallet: true,
        isUnlocked: true,
        isLoading: false,
        wallet: mockWallet,
      };

      render(<WebWalletPage />);

      expect(screen.getByTestId('wallet-header')).toBeInTheDocument();
    });

    it('should show assets section', async () => {
      const mockWallet = {
        getTotalBalanceUSD: vi.fn().mockResolvedValue({
          totalUsd: 0,
          balances: [],
        }),
        getTransactions: vi.fn().mockResolvedValue({
          transactions: [],
          total: 0,
        }),
      };

      mockState = {
        hasWallet: true,
        isUnlocked: true,
        isLoading: false,
        wallet: mockWallet,
      };

      render(<WebWalletPage />);

      // There are now 2 "Assets" elements: one in the tab button and one in the section header
      expect(screen.getAllByText('Assets').length).toBeGreaterThanOrEqual(1);
    });

    it('should show copy all addresses button near the top when assets are loaded', async () => {
      const mockWallet = {
        getTotalBalanceUSD: vi.fn().mockResolvedValue({
          totalUsd: 123.45,
          balances: [
            {
              chain: 'BTC',
              address: 'bc1qtestaddress1234567890',
              balance: '0.01',
              usdValue: 100,
            },
          ],
        }),
        getTransactions: vi.fn().mockResolvedValue({
          transactions: [],
          total: 0,
        }),
      };

      mockState = {
        hasWallet: true,
        isUnlocked: true,
        isLoading: false,
        wallet: mockWallet,
        chains: ['BTC'],
      };

      render(<WebWalletPage />);

      expect(await screen.findByText('Copy All Addresses')).toBeInTheDocument();
    });

    it('should copy all non-lightning addresses from the top-level button', async () => {
      const user = userEvent.setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      });

      const mockWallet = {
        getTotalBalanceUSD: vi.fn().mockResolvedValue({
          totalUsd: 123.45,
          balances: [
            {
              chain: 'BTC',
              address: 'bc1qtestaddress1234567890',
              balance: '0.01',
              usdValue: 100,
            },
            {
              chain: 'ETH',
              address: '0xabc123456789',
              balance: '1.25',
              usdValue: 23.45,
            },
            {
              chain: 'LN',
              address: 'Lightning Network',
              balance: '0',
              usdValue: 0,
            },
          ],
        }),
        getTransactions: vi.fn().mockResolvedValue({
          transactions: [],
          total: 0,
        }),
      };

      mockState = {
        hasWallet: true,
        isUnlocked: true,
        isLoading: false,
        wallet: mockWallet,
        chains: ['BTC', 'ETH', 'LN'],
      };

      render(<WebWalletPage />);

      await user.click(await screen.findByText('Copy All Addresses'));

      expect(writeText).toHaveBeenCalledWith(
        'BTC: bc1qtestaddress1234567890\nETH: 0xabc123456789'
      );
      expect(screen.getByText('Copied All Addresses')).toBeInTheDocument();
    });
  });
});
