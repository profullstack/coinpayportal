/**
 * E2E Test: Settings Flow
 *
 * Tests wallet settings: lock, password change, seed reveal, wallet deletion.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SettingsPage from '../settings/page';

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

vi.mock('@/components/web-wallet/WalletHeader', () => ({
  WalletHeader: () => <div data-testid="wallet-header">Header</div>,
}));

const mockLock = vi.fn();
const mockDeleteWallet = vi.fn();
const mockChangePassword = vi.fn();
let mockState: any;

vi.mock('@/components/web-wallet/WalletContext', () => ({
  useWebWallet: () => mockState,
}));

beforeEach(() => {
  mockPush.mockReset();
  mockReplace.mockReset();
  mockLock.mockReset();
  mockDeleteWallet.mockReset();
  mockChangePassword.mockReset();

  mockChangePassword.mockResolvedValue(true);

  mockState = {
    wallet: { getMnemonic: vi.fn().mockReturnValue('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about') },
    walletId: 'wid-settings-e2e-001',
    chains: ['BTC', 'ETH', 'SOL'],
    isUnlocked: true,
    deleteWallet: mockDeleteWallet,
    lock: mockLock,
    changePassword: mockChangePassword,
  };
});

describe('E2E: Settings Flow', () => {
  describe('Wallet Info', () => {
    it('should display wallet ID and chain badges', () => {
      render(<SettingsPage />);

      expect(screen.getByText('wid-settings-e2e-001')).toBeInTheDocument();
      expect(screen.getByText('BTC')).toBeInTheDocument();
      expect(screen.getByText('ETH')).toBeInTheDocument();
      expect(screen.getByText('SOL')).toBeInTheDocument();
    });
  });

  describe('Lock Wallet', () => {
    it('should lock wallet on button click', () => {
      render(<SettingsPage />);

      fireEvent.click(screen.getByText('Lock Wallet Now'));
      expect(mockLock).toHaveBeenCalledOnce();
    });
  });

  describe('Password Change Flow', () => {
    it('should show password change form on click', () => {
      render(<SettingsPage />);

      fireEvent.click(screen.getByText('Change Password'));
      expect(screen.getByText('Current Password')).toBeInTheDocument();
      expect(screen.getByText('New Password')).toBeInTheDocument();
      expect(screen.getByText('Confirm New Password')).toBeInTheDocument();
    });

    it('should successfully change password', async () => {
      render(<SettingsPage />);

      fireEvent.click(screen.getByText('Change Password'));

      // Fill out the form
      fireEvent.change(screen.getByPlaceholderText('Enter current password'), {
        target: { value: 'OldPassword123!' },
      });
      fireEvent.change(screen.getByPlaceholderText('Enter new password'), {
        target: { value: 'NewStr0ng!Pass456' },
      });
      fireEvent.change(screen.getByPlaceholderText('Confirm new password'), {
        target: { value: 'NewStr0ng!Pass456' },
      });

      fireEvent.click(screen.getByText('Update Password'));

      await waitFor(() => {
        expect(mockChangePassword).toHaveBeenCalledWith('OldPassword123!', 'NewStr0ng!Pass456');
        expect(screen.getByText('Password changed successfully')).toBeInTheDocument();
      });
    });

    it('should show error on wrong current password', async () => {
      mockChangePassword.mockResolvedValue(false);

      render(<SettingsPage />);

      fireEvent.click(screen.getByText('Change Password'));

      fireEvent.change(screen.getByPlaceholderText('Enter current password'), {
        target: { value: 'WrongPass' },
      });
      fireEvent.change(screen.getByPlaceholderText('Enter new password'), {
        target: { value: 'NewStr0ng!Pass456' },
      });
      fireEvent.change(screen.getByPlaceholderText('Confirm new password'), {
        target: { value: 'NewStr0ng!Pass456' },
      });

      fireEvent.click(screen.getByText('Update Password'));

      await waitFor(() => {
        expect(screen.getByText('Incorrect current password')).toBeInTheDocument();
      });
    });

    it('should validate password mismatch', async () => {
      render(<SettingsPage />);

      fireEvent.click(screen.getByText('Change Password'));

      fireEvent.change(screen.getByPlaceholderText('Enter current password'), {
        target: { value: 'OldPass123!' },
      });
      fireEvent.change(screen.getByPlaceholderText('Enter new password'), {
        target: { value: 'NewPass123!' },
      });
      fireEvent.change(screen.getByPlaceholderText('Confirm new password'), {
        target: { value: 'DifferentPass456!' },
      });

      fireEvent.click(screen.getByText('Update Password'));

      await waitFor(() => {
        expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
      });
    });

    it('should validate minimum password length', async () => {
      render(<SettingsPage />);

      fireEvent.click(screen.getByText('Change Password'));

      fireEvent.change(screen.getByPlaceholderText('Enter current password'), {
        target: { value: 'OldPass' },
      });
      fireEvent.change(screen.getByPlaceholderText('Enter new password'), {
        target: { value: 'short' },
      });
      fireEvent.change(screen.getByPlaceholderText('Confirm new password'), {
        target: { value: 'short' },
      });

      fireEvent.click(screen.getByText('Update Password'));

      await waitFor(() => {
        expect(screen.getByText('New password must be at least 8 characters')).toBeInTheDocument();
      });
    });

    it('should validate same password', async () => {
      render(<SettingsPage />);

      fireEvent.click(screen.getByText('Change Password'));

      fireEvent.change(screen.getByPlaceholderText('Enter current password'), {
        target: { value: 'SamePass123!' },
      });
      fireEvent.change(screen.getByPlaceholderText('Enter new password'), {
        target: { value: 'SamePass123!' },
      });
      fireEvent.change(screen.getByPlaceholderText('Confirm new password'), {
        target: { value: 'SamePass123!' },
      });

      fireEvent.click(screen.getByText('Update Password'));

      await waitFor(() => {
        expect(screen.getByText('New password must be different from current')).toBeInTheDocument();
      });
    });

    it('should cancel password change', () => {
      render(<SettingsPage />);

      fireEvent.click(screen.getByText('Change Password'));
      expect(screen.getByText('Current Password')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Cancel'));
      expect(screen.queryByText('Current Password')).not.toBeInTheDocument();
    });
  });

  describe('Recovery Phrase Reveal', () => {
    it('should show warning before reveal', () => {
      render(<SettingsPage />);

      expect(screen.getByText(/Never share your recovery phrase/)).toBeInTheDocument();
    });

    it('should complete full reveal flow', () => {
      render(<SettingsPage />);

      // Step 1: Click to start reveal
      fireEvent.click(screen.getByText('Reveal Recovery Phrase'));

      // Step 2: Click reveal button
      fireEvent.click(screen.getByText('Reveal'));

      // Step 3: Seed should be visible
      expect(screen.getByText('Write down your recovery phrase')).toBeInTheDocument();
    });

    it('should hide seed after revealing', () => {
      render(<SettingsPage />);

      fireEvent.click(screen.getByText('Reveal Recovery Phrase'));
      fireEvent.click(screen.getByText('Reveal'));

      expect(screen.getByText('Write down your recovery phrase')).toBeInTheDocument();

      // Hide it
      fireEvent.click(screen.getByText('Hide Recovery Phrase'));

      // Should be back to warning
      expect(screen.getByText(/Never share your recovery phrase/)).toBeInTheDocument();
    });

    it('should show error when mnemonic not available', () => {
      mockState.wallet.getMnemonic = vi.fn().mockReturnValue(null);

      render(<SettingsPage />);

      fireEvent.click(screen.getByText('Reveal Recovery Phrase'));
      fireEvent.click(screen.getByText('Reveal'));

      expect(screen.getByText('Mnemonic not available in current session')).toBeInTheDocument();
    });
  });

  describe('Delete Wallet', () => {
    it('should complete full deletion flow', () => {
      render(<SettingsPage />);

      // Step 1: Click delete
      fireEvent.click(screen.getByText('Delete Wallet From Device'));

      // Step 2: Verify warning shown
      expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument();

      // Step 3: Type DELETE
      fireEvent.change(screen.getByPlaceholderText('DELETE'), {
        target: { value: 'DELETE' },
      });

      // Step 4: Confirm
      fireEvent.click(screen.getByText('Delete Permanently'));

      // Step 5: Verify redirect
      expect(mockDeleteWallet).toHaveBeenCalledOnce();
      expect(mockPush).toHaveBeenCalledWith('/web-wallet');
    });

    it('should not allow delete without typing DELETE', () => {
      render(<SettingsPage />);

      fireEvent.click(screen.getByText('Delete Wallet From Device'));

      const deleteBtn = screen.getByText('Delete Permanently');
      expect(deleteBtn).toBeDisabled();

      // Type incorrect text
      fireEvent.change(screen.getByPlaceholderText('DELETE'), {
        target: { value: 'delete' }, // lowercase
      });
      expect(deleteBtn).toBeDisabled();
    });

    it('should cancel deletion', () => {
      render(<SettingsPage />);

      fireEvent.click(screen.getByText('Delete Wallet From Device'));
      fireEvent.click(screen.getByText('Cancel'));

      expect(mockDeleteWallet).not.toHaveBeenCalled();
      expect(screen.getByText('Delete Wallet From Device')).toBeInTheDocument();
    });
  });

  describe('Authentication Guard', () => {
    it('should redirect to unlock if not unlocked', () => {
      mockState = { ...mockState, isUnlocked: false };
      render(<SettingsPage />);
      expect(mockReplace).toHaveBeenCalledWith('/web-wallet/unlock');
    });
  });

  describe('Navigation', () => {
    it('should have back link to dashboard', () => {
      render(<SettingsPage />);
      const backLink = screen.getByText('← Dashboard');
      expect(backLink.closest('a')).toHaveAttribute('href', '/web-wallet');
    });
  });
});
