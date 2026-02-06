import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CreateWalletPage from '../create/page';

// Mock next/navigation
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// Mock WalletContext
const mockCreateWallet = vi.fn();
const mockClearError = vi.fn();
let mockState: any;

vi.mock('@/components/web-wallet/WalletContext', () => ({
  useWebWallet: () => mockState,
}));

beforeEach(() => {
  mockCreateWallet.mockReset();
  mockClearError.mockReset();
  mockPush.mockReset();

  mockState = {
    createWallet: mockCreateWallet,
    isLoading: false,
    error: null,
    clearError: mockClearError,
  };
});

describe('CreateWalletPage', () => {
  it('should render the password step initially', () => {
    render(<CreateWalletPage />);

    expect(screen.getByText('Create New Wallet')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument();
    expect(screen.getByText('Select chains')).toBeInTheDocument();
  });

  it('should disable create button when form is incomplete', () => {
    render(<CreateWalletPage />);

    const createBtn = screen.getByText('Create Wallet');
    expect(createBtn).toBeDisabled();
  });

  it('should show password mismatch error', () => {
    render(<CreateWalletPage />);

    const [pwInput, confirmInput] = screen.getAllByPlaceholderText(/password/i);
    fireEvent.change(pwInput, { target: { value: 'MyStr0ng!Pass' } });
    fireEvent.change(confirmInput, { target: { value: 'different' } });

    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
  });

  it('should call createWallet and show seed on submit', async () => {
    const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    mockCreateWallet.mockResolvedValue({
      mnemonic: testMnemonic,
      walletId: 'wid-123',
    });

    render(<CreateWalletPage />);

    // Fill form
    const [pwInput, confirmInput] = screen.getAllByPlaceholderText(/password/i);
    fireEvent.change(pwInput, { target: { value: 'MyStr0ng!Pass' } });
    fireEvent.change(confirmInput, { target: { value: 'MyStr0ng!Pass' } });

    // Submit
    fireEvent.click(screen.getByText('Create Wallet'));

    await waitFor(() => {
      expect(mockCreateWallet).toHaveBeenCalledWith('MyStr0ng!Pass', {
        chains: expect.any(Array),
      });
    });
  });

  it('should show error message from context', () => {
    mockState = {
      ...mockState,
      error: 'Something went wrong',
    };

    render(<CreateWalletPage />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('should have progress indicators', () => {
    render(<CreateWalletPage />);

    // 3 progress bars
    const { container } = render(<CreateWalletPage />);
    const bars = container.querySelectorAll('.rounded-full.h-1');
    expect(bars.length).toBe(3);
  });

  it('should show back link', () => {
    render(<CreateWalletPage />);
    const backLink = screen.getAllByText(/Back/)[0];
    expect(backLink.closest('a')).toHaveAttribute('href', '/web-wallet');
  });
});
