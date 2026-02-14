import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LightningSetup } from '../LightningSetup';

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
    expect(screen.getByText('Enable Lightning Network')).toBeDefined();
    expect(
      screen.getByText(/Receive instant Bitcoin payments via BOLT12 offers/)
    ).toBeDefined();
  });

  it('should show loading state on click', async () => {
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    render(<LightningSetup {...defaultProps} />);
    fireEvent.click(screen.getByText('Enable Lightning ⚡'));

    await waitFor(() => {
      expect(screen.getByText('Provisioning node...')).toBeDefined();
    });
  });

  it('should show success state after provisioning', async () => {
    const fakeNode = {
      id: 'node-1',
      node_pubkey: '02abcdef1234567890abcdef1234567890',
      status: 'active',
    };
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, data: { node: fakeNode } }),
    });

    render(<LightningSetup {...defaultProps} />);
    fireEvent.click(screen.getByText('Enable Lightning ⚡'));

    await waitFor(() => {
      expect(screen.getByText('Lightning Enabled!')).toBeDefined();
      expect(screen.getByText(/Your node is ready/)).toBeDefined();
    });
  });

  it('should call onSetupComplete callback', async () => {
    const fakeNode = { id: 'node-1', node_pubkey: '02abc', status: 'active' };
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, data: { node: fakeNode } }),
    });
    const onComplete = vi.fn();

    render(<LightningSetup {...defaultProps} onSetupComplete={onComplete} />);
    fireEvent.click(screen.getByText('Enable Lightning ⚡'));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(fakeNode);
    });
  });

  it('should show error on API failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          success: false,
          error: { message: 'Node limit reached' },
        }),
    });

    render(<LightningSetup {...defaultProps} />);
    fireEvent.click(screen.getByText('Enable Lightning ⚡'));

    await waitFor(() => {
      expect(screen.getByText('Node limit reached')).toBeDefined();
    });
  });

  it('should show error on network failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Failed'));

    render(<LightningSetup {...defaultProps} />);
    fireEvent.click(screen.getByText('Enable Lightning ⚡'));

    await waitFor(() => {
      expect(screen.getByText('Network error. Please try again.')).toBeDefined();
    });
  });

  it('should send correct payload to API', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({ success: true, data: { node: { id: 'n1' } } }),
    });

    render(<LightningSetup {...defaultProps} />);
    fireEvent.click(screen.getByText('Enable Lightning ⚡'));

    await waitFor(() => {
      const [url, opts] = (global.fetch as any).mock.calls[0];
      expect(url).toBe('/api/lightning/nodes');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.wallet_id).toBe('w-1');
      expect(body.business_id).toBe('b-1');
      expect(body.mnemonic).toBe('test mnemonic phrase');
    });
  });
});
