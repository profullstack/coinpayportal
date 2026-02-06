import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ImportWalletPage from '../import/page';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const mockImportWallet = vi.fn();
const mockClearError = vi.fn();
let mockState: any;

vi.mock('@/components/web-wallet/WalletContext', () => ({
  useWebWallet: () => mockState,
}));

const VALID_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

beforeEach(() => {
  mockImportWallet.mockReset();
  mockClearError.mockReset();
  mockPush.mockReset();

  mockState = {
    importWallet: mockImportWallet,
    isLoading: false,
    error: null,
    clearError: mockClearError,
  };
});

describe('ImportWalletPage', () => {
  it('should render import form', () => {
    render(<ImportWalletPage />);

    expect(screen.getByRole('heading', { name: /Import Wallet/ })).toBeInTheDocument();
    expect(screen.getByText('12 words')).toBeInTheDocument();
    expect(screen.getByText('24 words')).toBeInTheDocument();
  });

  it('should show seed input in paste mode by default', () => {
    render(<ImportWalletPage />);
    expect(
      screen.getByPlaceholderText('Enter your 12-word recovery phrase...')
    ).toBeInTheDocument();
  });

  it('should switch between 12 and 24 word modes', () => {
    render(<ImportWalletPage />);

    fireEvent.click(screen.getByText('24 words'));
    expect(
      screen.getByPlaceholderText('Enter your 24-word recovery phrase...')
    ).toBeInTheDocument();
  });

  it('should show password fields', () => {
    render(<ImportWalletPage />);

    expect(screen.getByLabelText('Encryption Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument();
  });

  it('should disable import button when form is incomplete', () => {
    render(<ImportWalletPage />);

    const importBtn = screen.getByRole('button', { name: /Import Wallet/ });
    expect(importBtn).toBeDisabled();
  });

  it('should call importWallet on submit', async () => {
    mockImportWallet.mockResolvedValue({ walletId: 'wid-123' });

    render(<ImportWalletPage />);

    // Enter mnemonic
    const textarea = screen.getByPlaceholderText(
      'Enter your 12-word recovery phrase...'
    );
    fireEvent.change(textarea, { target: { value: VALID_MNEMONIC } });

    // Enter passwords
    const pwInput = screen.getByLabelText('Encryption Password');
    const confirmInput = screen.getByLabelText('Confirm Password');
    fireEvent.change(pwInput, { target: { value: 'MyStr0ng!Pass' } });
    fireEvent.change(confirmInput, { target: { value: 'MyStr0ng!Pass' } });

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /Import Wallet/ }));

    await waitFor(() => {
      expect(mockImportWallet).toHaveBeenCalledWith(
        VALID_MNEMONIC,
        'MyStr0ng!Pass',
        { chains: expect.any(Array) }
      );
    });
  });

  it('should redirect to dashboard on success', async () => {
    mockImportWallet.mockResolvedValue({ walletId: 'wid-123' });

    render(<ImportWalletPage />);

    const textarea = screen.getByPlaceholderText(
      'Enter your 12-word recovery phrase...'
    );
    fireEvent.change(textarea, { target: { value: VALID_MNEMONIC } });

    const pwInput = screen.getByLabelText('Encryption Password');
    const confirmInput = screen.getByLabelText('Confirm Password');
    fireEvent.change(pwInput, { target: { value: 'MyStr0ng!Pass' } });
    fireEvent.change(confirmInput, { target: { value: 'MyStr0ng!Pass' } });

    fireEvent.click(screen.getByRole('button', { name: /Import Wallet/ }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/web-wallet');
    });
  });

  it('should show error from context', () => {
    mockState = { ...mockState, error: 'Import failed' };

    render(<ImportWalletPage />);
    expect(screen.getByText('Import failed')).toBeInTheDocument();
  });

  it('should have back link', () => {
    render(<ImportWalletPage />);
    const backLink = screen.getAllByText(/Back/)[0];
    expect(backLink.closest('a')).toHaveAttribute('href', '/web-wallet');
  });
});
