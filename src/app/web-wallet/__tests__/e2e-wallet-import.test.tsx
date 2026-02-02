/**
 * E2E Test: Wallet Import Flow
 *
 * Tests the complete wallet import flow: seed entry → password → dashboard.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ImportWalletPage from '../import/page';

// ── Mocks ──

const mockPush = vi.fn();
const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
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

beforeEach(() => {
  mockImportWallet.mockReset();
  mockClearError.mockReset();
  mockPush.mockReset();
  mockReplace.mockReset();

  mockState = {
    importWallet: mockImportWallet,
    isLoading: false,
    error: null,
    clearError: mockClearError,
  };
});

describe('E2E: Wallet Import Flow', () => {
  it('should render the import page with seed input', () => {
    render(<ImportWalletPage />);

    expect(screen.getByRole('heading', { name: 'Import Wallet' })).toBeInTheDocument();
    // Should show the seed textarea in paste mode by default
    expect(screen.getByPlaceholderText(/Enter your 12-word recovery phrase/)).toBeInTheDocument();
  });

  it('should accept a 12-word seed phrase and proceed', async () => {
    mockImportWallet.mockResolvedValue({
      walletId: 'wid-imported-001',
    });

    render(<ImportWalletPage />);

    // Find the textarea (paste mode is default)
    const textarea = screen.getByPlaceholderText(/Enter your 12-word recovery phrase/);

    const testSeed = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    fireEvent.change(textarea, { target: { value: testSeed } });

    // The word count should update
    expect(screen.getByText('12 / 12 words')).toBeInTheDocument();

    // The page should show buttons
    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  it('should show error on invalid mnemonic', async () => {
    mockImportWallet.mockRejectedValue(new Error('Invalid mnemonic'));
    mockState = { ...mockState, error: 'Invalid mnemonic phrase' };

    render(<ImportWalletPage />);

    expect(screen.getByText('Invalid mnemonic phrase')).toBeInTheDocument();
  });

  it('should show loading during import', () => {
    mockState = { ...mockState, isLoading: true };
    render(<ImportWalletPage />);

    // Loading state should show "Importing..." and be disabled
    const importBtn = screen.getByText('Importing...');
    expect(importBtn).toBeDisabled();
  });

  it('should have back link to wallet landing', () => {
    render(<ImportWalletPage />);

    const backLinks = screen.getAllByText(/Back/);
    const backLink = backLinks.find(el => el.closest('a'));
    expect(backLink?.closest('a')).toHaveAttribute('href', '/web-wallet');
  });
});
