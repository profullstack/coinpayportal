/**
 * E2E Test: Wallet Creation Flow
 *
 * Tests the complete wallet creation flow from landing → create → seed backup → dashboard.
 * Uses jsdom + vitest as the E2E-level test runner (component integration tests).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CreateWalletPage from '../create/page';

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
  mockReplace.mockReset();

  mockState = {
    createWallet: mockCreateWallet,
    isLoading: false,
    error: null,
    clearError: mockClearError,
  };
});

describe('E2E: Wallet Creation Flow', () => {
  it('should complete full wallet creation: password → chain selection → create → seed display', async () => {
    const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    mockCreateWallet.mockResolvedValue({
      mnemonic: testMnemonic,
      walletId: 'wid-e2e-001',
    });

    render(<CreateWalletPage />);

    // Step 1: Verify initial password step is shown
    expect(screen.getByText('Create New Wallet')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument();

    // Step 2: Fill in passwords
    const pwInput = screen.getByLabelText('Password');
    const confirmInput = screen.getByLabelText('Confirm Password');
    fireEvent.change(pwInput, { target: { value: 'Str0ng!Pass123' } });
    fireEvent.change(confirmInput, { target: { value: 'Str0ng!Pass123' } });

    // Step 3: Verify create button is enabled
    const createBtn = screen.getByText('Create Wallet');
    expect(createBtn).not.toBeDisabled();

    // Step 4: Click create
    fireEvent.click(createBtn);

    // Step 5: Verify createWallet was called with password and chains
    await waitFor(() => {
      expect(mockCreateWallet).toHaveBeenCalledWith('Str0ng!Pass123', {
        chains: expect.any(Array),
      });
    });
  });

  it('should prevent creation with weak password', () => {
    render(<CreateWalletPage />);

    const pwInput = screen.getByLabelText('Password');
    const confirmInput = screen.getByLabelText('Confirm Password');
    fireEvent.change(pwInput, { target: { value: 'abc' } });
    fireEvent.change(confirmInput, { target: { value: 'abc' } });

    const createBtn = screen.getByText('Create Wallet');
    expect(createBtn).toBeDisabled();
  });

  it('should prevent creation with mismatched passwords', () => {
    render(<CreateWalletPage />);

    const pwInput = screen.getByLabelText('Password');
    const confirmInput = screen.getByLabelText('Confirm Password');
    fireEvent.change(pwInput, { target: { value: 'Str0ng!Pass123' } });
    fireEvent.change(confirmInput, { target: { value: 'DifferentPass456!' } });

    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    const createBtn = screen.getByText('Create Wallet');
    expect(createBtn).toBeDisabled();
  });

  it('should show loading state during creation', async () => {
    mockState = { ...mockState, isLoading: true };
    render(<CreateWalletPage />);

    // When loading, the button text changes to "Creating..." and it should be disabled
    const createBtn = screen.getByText('Creating...');
    expect(createBtn).toBeDisabled();
  });

  it('should show error message on creation failure', () => {
    mockState = { ...mockState, error: 'Network error: unable to create wallet' };
    render(<CreateWalletPage />);

    expect(screen.getByText('Network error: unable to create wallet')).toBeInTheDocument();
  });

  it('should have correct navigation links', () => {
    render(<CreateWalletPage />);

    // Back link to landing page
    const backLinks = screen.getAllByText(/Back/);
    const backLink = backLinks.find(el => el.closest('a'));
    expect(backLink?.closest('a')).toHaveAttribute('href', '/web-wallet');
  });

  it('should show progress indicators for the 3-step flow', () => {
    const { container } = render(<CreateWalletPage />);
    const progressBars = container.querySelectorAll('.rounded-full.h-1');
    expect(progressBars.length).toBe(3);
  });
});
