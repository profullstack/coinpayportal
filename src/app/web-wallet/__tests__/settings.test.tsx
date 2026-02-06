import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SettingsPage from '../settings/page';

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
let mockState: any;

vi.mock('@/components/web-wallet/WalletContext', () => ({
  useWebWallet: () => mockState,
}));

beforeEach(() => {
  mockPush.mockReset();
  mockReplace.mockReset();
  mockLock.mockReset();
  mockDeleteWallet.mockReset();

  mockState = {
    wallet: { getMnemonic: vi.fn().mockReturnValue('test mnemonic phrase here') },
    walletId: 'wid-12345678-abcdef',
    chains: ['BTC', 'ETH', 'SOL'],
    isUnlocked: true,
    deleteWallet: mockDeleteWallet,
    lock: mockLock,
    changePassword: vi.fn().mockResolvedValue(true),
  };
});

describe('SettingsPage', () => {
  it('should render settings sections', () => {
    render(<SettingsPage />);

    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Wallet Info')).toBeInTheDocument();
    expect(screen.getByText('Security')).toBeInTheDocument();
    expect(screen.getByText('Recovery Phrase')).toBeInTheDocument();
    expect(screen.getByText('Danger Zone')).toBeInTheDocument();
  });

  it('should show wallet ID', () => {
    render(<SettingsPage />);
    expect(screen.getByText('wid-12345678-abcdef')).toBeInTheDocument();
  });

  it('should show chain badges', () => {
    render(<SettingsPage />);
    expect(screen.getByText('BTC')).toBeInTheDocument();
    expect(screen.getByText('ETH')).toBeInTheDocument();
    expect(screen.getByText('SOL')).toBeInTheDocument();
  });

  it('should call lock when clicking lock button', () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByText('Lock Wallet Now'));
    expect(mockLock).toHaveBeenCalledOnce();
  });

  it('should redirect when not unlocked', () => {
    mockState = { ...mockState, isUnlocked: false };
    render(<SettingsPage />);
    expect(mockReplace).toHaveBeenCalledWith('/web-wallet/unlock');
  });

  describe('Recovery Phrase', () => {
    it('should show warning before reveal', () => {
      render(<SettingsPage />);
      expect(
        screen.getByText(/Never share your recovery phrase/)
      ).toBeInTheDocument();
    });

    it('should show reveal button', () => {
      render(<SettingsPage />);
      expect(
        screen.getByText('Reveal Recovery Phrase')
      ).toBeInTheDocument();
    });

    it('should show seed after clicking reveal', () => {
      render(<SettingsPage />);

      fireEvent.click(screen.getByText('Reveal Recovery Phrase'));
      fireEvent.click(screen.getByText('Reveal'));

      expect(
        screen.getByText('Write down your recovery phrase')
      ).toBeInTheDocument();
    });
  });

  describe('Danger Zone', () => {
    it('should show delete button', () => {
      render(<SettingsPage />);
      expect(
        screen.getByText('Delete Wallet From Device')
      ).toBeInTheDocument();
    });

    it('should show confirmation when clicking delete', () => {
      render(<SettingsPage />);

      fireEvent.click(screen.getByText('Delete Wallet From Device'));

      expect(
        screen.getByText('This action cannot be undone.')
      ).toBeInTheDocument();
      expect(screen.getByPlaceholderText('DELETE')).toBeInTheDocument();
    });

    it('should require typing DELETE to confirm', () => {
      render(<SettingsPage />);

      fireEvent.click(screen.getByText('Delete Wallet From Device'));

      const deleteBtn = screen.getByText('Delete Permanently');
      expect(deleteBtn).toBeDisabled();

      fireEvent.change(screen.getByPlaceholderText('DELETE'), {
        target: { value: 'DELETE' },
      });
      expect(deleteBtn).not.toBeDisabled();
    });

    it('should call deleteWallet on confirm', () => {
      render(<SettingsPage />);

      fireEvent.click(screen.getByText('Delete Wallet From Device'));
      fireEvent.change(screen.getByPlaceholderText('DELETE'), {
        target: { value: 'DELETE' },
      });
      fireEvent.click(screen.getByText('Delete Permanently'));

      expect(mockDeleteWallet).toHaveBeenCalledOnce();
      expect(mockPush).toHaveBeenCalledWith('/web-wallet');
    });

    it('should cancel delete', () => {
      render(<SettingsPage />);

      fireEvent.click(screen.getByText('Delete Wallet From Device'));
      fireEvent.click(screen.getByText('Cancel'));

      expect(mockDeleteWallet).not.toHaveBeenCalled();
      expect(
        screen.getByText('Delete Wallet From Device')
      ).toBeInTheDocument();
    });
  });
});
