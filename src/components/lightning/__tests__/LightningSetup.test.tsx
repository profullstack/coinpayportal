/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LightningSetup } from '../LightningSetup';

const { mockEnableLightning } = vi.hoisted(() => ({
  mockEnableLightning: vi.fn(),
}));
vi.mock('@/components/web-wallet/WalletContext', () => ({
  useWebWallet: () => ({
    wallet: {
      walletId: 'w-1',
      enableLightning: (...args: unknown[]) => mockEnableLightning(...args),
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LightningSetup', () => {
  const defaultProps = {
    walletId: 'w-1',
    businessId: 'b-1',
    mnemonic: 'test mnemonic phrase',
  };

  it('should render the enable lightning button', () => {
    render(<LightningSetup {...defaultProps} />);
    expect(screen.getByText('Enable Lightning ⚡')).toBeDefined();
  });

  it('should render description text', () => {
    render(<LightningSetup {...defaultProps} />);
    expect(screen.getByText('Enable Lightning Wallet')).toBeDefined();
    expect(
      screen.getByText(/Send and receive instant Bitcoin payments over the Lightning Network/)
    ).toBeDefined();
  });

  it('should show loading state on click', async () => {
    mockEnableLightning.mockReturnValue(new Promise(() => {}));

    render(<LightningSetup {...defaultProps} />);
    fireEvent.click(screen.getByText('Enable Lightning ⚡'));

    await waitFor(() => {
      expect(screen.getByText('Setting up wallet...')).toBeDefined();
    });
  });

  it('should show success state after provisioning', async () => {
    const fakeNode = {
      id: 'node-1',
      node_pubkey: '02abcdef1234567890abcdef1234567890',
      status: 'active',
    };
    mockEnableLightning.mockResolvedValue(fakeNode);

    render(<LightningSetup {...defaultProps} />);
    fireEvent.click(screen.getByText('Enable Lightning ⚡'));

    await waitFor(() => {
      expect(screen.getByText('Lightning Enabled!')).toBeDefined();
      expect(screen.getByText(/Your Lightning wallet is ready/)).toBeDefined();
    });
  });

  it('should call onSetupComplete callback', async () => {
    const fakeNode = { id: 'node-1', node_pubkey: '02abc', status: 'active' };
    mockEnableLightning.mockResolvedValue(fakeNode);
    const onComplete = vi.fn();

    render(<LightningSetup {...defaultProps} onSetupComplete={onComplete} />);
    fireEvent.click(screen.getByText('Enable Lightning ⚡'));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(fakeNode);
    });
  });

  it('should show error on API failure', async () => {
    mockEnableLightning.mockRejectedValue(new Error('Node limit reached'));

    render(<LightningSetup {...defaultProps} />);
    fireEvent.click(screen.getByText('Enable Lightning ⚡'));

    await waitFor(() => {
      expect(screen.getByText('Node limit reached')).toBeDefined();
    });
  });

  it('should show error on network failure', async () => {
    mockEnableLightning.mockRejectedValue(new Error('Failed'));

    render(<LightningSetup {...defaultProps} />);
    fireEvent.click(screen.getByText('Enable Lightning ⚡'));

    await waitFor(() => {
      expect(screen.getByText('Failed')).toBeDefined();
    });
  });

  it('should call the signed wallet SDK with provisioning details', async () => {
    mockEnableLightning.mockResolvedValue({ id: 'n1' });

    render(<LightningSetup {...defaultProps} />);
    fireEvent.click(screen.getByText('Enable Lightning ⚡'));

    await waitFor(() => {
      expect(mockEnableLightning).toHaveBeenCalledWith('test mnemonic phrase', 'b-1');
    });
  });
});
