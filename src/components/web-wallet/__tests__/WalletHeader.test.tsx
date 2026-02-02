import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WalletHeader } from '../WalletHeader';

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// Mock useWebWallet
const mockLock = vi.fn();
vi.mock('../WalletContext', () => ({
  useWebWallet: () => mockWalletState,
}));

let mockWalletState: any;

beforeEach(() => {
  mockWalletState = {
    isUnlocked: false,
    walletId: null,
    lock: mockLock,
  };
});

describe('WalletHeader', () => {
  it('should show brand name', () => {
    render(<WalletHeader />);
    expect(screen.getByText('CoinPay Wallet')).toBeInTheDocument();
  });

  it('should link brand to /web-wallet', () => {
    render(<WalletHeader />);
    const link = screen.getByText('CoinPay Wallet');
    expect(link.closest('a')).toHaveAttribute('href', '/web-wallet');
  });

  it('should not show nav when locked', () => {
    render(<WalletHeader />);

    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
    expect(screen.queryByText('Lock')).not.toBeInTheDocument();
  });

  it('should show nav links when unlocked', () => {
    mockWalletState = {
      isUnlocked: true,
      walletId: 'wid-12345678-abcd',
      lock: mockLock,
    };

    render(<WalletHeader />);

    // Desktop nav links
    const dashboardLinks = screen.getAllByText('Dashboard');
    expect(dashboardLinks.length).toBeGreaterThan(0);

    const settingsLinks = screen.getAllByText('Settings');
    expect(settingsLinks.length).toBeGreaterThan(0);
  });

  it('should show wallet ID snippet when unlocked', () => {
    mockWalletState = {
      isUnlocked: true,
      walletId: 'wid-12345678-abcdef',
      lock: mockLock,
    };

    render(<WalletHeader />);
    expect(screen.getByText('wid-1234...')).toBeInTheDocument();
  });

  it('should show lock button when unlocked', () => {
    mockWalletState = {
      isUnlocked: true,
      walletId: 'wid-123',
      lock: mockLock,
    };

    render(<WalletHeader />);
    const lockBtn = screen.getByText('Lock');
    expect(lockBtn).toBeInTheDocument();
  });

  it('should call lock when clicking lock button', () => {
    mockWalletState = {
      isUnlocked: true,
      walletId: 'wid-123',
      lock: mockLock,
    };

    render(<WalletHeader />);
    fireEvent.click(screen.getByText('Lock'));
    expect(mockLock).toHaveBeenCalledOnce();
  });

  it('should have mobile nav when unlocked', () => {
    mockWalletState = {
      isUnlocked: true,
      walletId: 'wid-123',
      lock: mockLock,
    };

    render(<WalletHeader />);

    // Mobile nav has separate links
    const settingsLinks = screen.getAllByText('Settings');
    // Desktop + mobile = 2
    expect(settingsLinks.length).toBe(2);
  });
});
