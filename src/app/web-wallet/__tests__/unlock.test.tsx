import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UnlockWalletPage from '../unlock/page';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const mockUnlock = vi.fn();
const mockDeleteWallet = vi.fn();
let mockState: any;

vi.mock('@/components/web-wallet/WalletContext', () => ({
  useWebWallet: () => mockState,
}));

beforeEach(() => {
  mockUnlock.mockReset();
  mockDeleteWallet.mockReset();
  mockPush.mockReset();

  mockState = {
    unlock: mockUnlock,
    deleteWallet: mockDeleteWallet,
    isLoading: false,
    error: null,
    walletId: 'wid-12345678-abcd',
  };
});

describe('UnlockWalletPage', () => {
  it('should render unlock form', () => {
    render(<UnlockWalletPage />);

    expect(screen.getByText('Unlock Wallet')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument();
  });

  it('should show wallet ID snippet', () => {
    render(<UnlockWalletPage />);
    expect(screen.getByText(/wid-1234.*abcd/)).toBeInTheDocument();
  });

  it('should disable unlock button when empty', () => {
    render(<UnlockWalletPage />);
    expect(screen.getByText('Unlock')).toBeDisabled();
  });

  it('should call unlock on submit', async () => {
    mockUnlock.mockResolvedValue(true);

    render(<UnlockWalletPage />);

    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'MyPassword' },
    });
    fireEvent.click(screen.getByText('Unlock'));

    await waitFor(() => {
      expect(mockUnlock).toHaveBeenCalledWith('MyPassword');
    });
  });

  it('should redirect to dashboard on successful unlock', async () => {
    mockUnlock.mockResolvedValue(true);

    render(<UnlockWalletPage />);

    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'correct' },
    });
    fireEvent.click(screen.getByText('Unlock'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/web-wallet');
    });
  });

  it('should show error on failed unlock', () => {
    mockState = { ...mockState, error: 'Incorrect password' };

    render(<UnlockWalletPage />);
    expect(screen.getByText('Incorrect password')).toBeInTheDocument();
  });

  it('should show import link', () => {
    render(<UnlockWalletPage />);
    expect(screen.getByText('Import different wallet')).toBeInTheDocument();
    expect(
      screen.getByText('Import different wallet').closest('a')
    ).toHaveAttribute('href', '/web-wallet/import');
  });

  it('should show delete option', () => {
    render(<UnlockWalletPage />);
    expect(
      screen.getByText('Delete wallet from this device')
    ).toBeInTheDocument();
  });

  it('should show delete confirmation dialog', () => {
    render(<UnlockWalletPage />);

    fireEvent.click(screen.getByText('Delete wallet from this device'));

    expect(
      screen.getByText(/permanently delete the encrypted wallet/)
    ).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('should call deleteWallet and redirect on confirm', () => {
    render(<UnlockWalletPage />);

    fireEvent.click(screen.getByText('Delete wallet from this device'));
    fireEvent.click(screen.getByText('Delete'));

    expect(mockDeleteWallet).toHaveBeenCalledOnce();
    expect(mockPush).toHaveBeenCalledWith('/web-wallet');
  });

  it('should cancel delete', () => {
    render(<UnlockWalletPage />);

    fireEvent.click(screen.getByText('Delete wallet from this device'));
    fireEvent.click(screen.getByText('Cancel'));

    expect(mockDeleteWallet).not.toHaveBeenCalled();
    // Back to normal view
    expect(
      screen.getByText('Delete wallet from this device')
    ).toBeInTheDocument();
  });

  it('should show loading state', () => {
    mockState = { ...mockState, isLoading: true };

    render(<UnlockWalletPage />);
    expect(screen.getByText('Unlocking...')).toBeInTheDocument();
  });
});
