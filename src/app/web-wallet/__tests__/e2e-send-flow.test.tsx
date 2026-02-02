/**
 * E2E Test: Send Transaction Flow
 *
 * Tests the complete UI send flow:
 * chain selection → address selection → amount → review → password → broadcast
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SendPage from '../send/page';

// ── Mocks ──

const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: mockReplace }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('@/components/web-wallet/WalletHeader', () => ({
  WalletHeader: () => <div data-testid="wallet-header">Header</div>,
}));

const mockSend = vi.fn();
const mockEstimateFee = vi.fn();
const mockGetAddresses = vi.fn();
let mockState: any;

vi.mock('@/components/web-wallet/WalletContext', () => ({
  useWebWallet: () => mockState,
}));

const mockDecrypt = vi.fn();
const mockLoadWallet = vi.fn();

vi.mock('@/lib/web-wallet/client-crypto', () => ({
  decryptWithPassword: (...args: any[]) => mockDecrypt(...args),
  loadWalletFromStorage: () => mockLoadWallet(),
}));

beforeEach(() => {
  mockSend.mockReset();
  mockEstimateFee.mockReset();
  mockGetAddresses.mockReset();
  mockReplace.mockReset();
  mockDecrypt.mockReset();
  mockLoadWallet.mockReset();

  mockGetAddresses.mockResolvedValue([]);
  mockEstimateFee.mockResolvedValue({
    low: { fee: '0.0001', feeCurrency: 'ETH' },
    medium: { fee: '0.0003', feeCurrency: 'ETH' },
    high: { fee: '0.0008', feeCurrency: 'ETH' },
  });

  mockLoadWallet.mockReturnValue({
    walletId: 'wid-send-e2e',
    encrypted: { ciphertext: 'ct', salt: 's', iv: 'i' },
    createdAt: '2025-01-01',
    chains: ['ETH', 'BTC', 'SOL'],
  });
  mockDecrypt.mockResolvedValue('test mnemonic');

  mockState = {
    wallet: {
      send: mockSend,
      estimateFee: mockEstimateFee,
      getAddresses: mockGetAddresses,
    },
    chains: ['ETH', 'BTC', 'SOL'],
    isUnlocked: true,
  };
});

describe('E2E: Send Transaction Flow', () => {
  it('should complete full ETH send flow: chain → address → amount → review → password → success', async () => {
    mockGetAddresses.mockResolvedValue([
      { id: 'addr-eth-001', address: '0x1234567890abcdef1234567890abcdef12345678', chain: 'ETH' },
    ]);
    mockSend.mockResolvedValue({
      txHash: '0xtxhash_success',
      chain: 'ETH',
      status: 'pending',
      explorerUrl: 'https://etherscan.io/tx/0xtxhash_success',
    });

    render(<SendPage />);

    // Step 1: Select chain
    const chainSelect = screen.getByRole('combobox');
    fireEvent.change(chainSelect, { target: { value: 'ETH' } });

    // Step 2: Wait for addresses to load
    await waitFor(() => {
      expect(screen.getByText('From Address')).toBeInTheDocument();
    });

    // Step 3: Fill recipient address
    fireEvent.change(screen.getByPlaceholderText('Enter recipient address'), {
      target: { value: '0xRecipient1234567890abcdef12345678' },
    });

    // Step 4: Fill amount
    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '0.5' },
    });

    // Step 5: Verify fee estimates are shown
    expect(screen.getByText('Slow')).toBeInTheDocument();
    expect(screen.getByText('Standard')).toBeInTheDocument();
    expect(screen.getByText('Fast')).toBeInTheDocument();

    // Step 6: Review transaction
    fireEvent.click(screen.getByText('Review Transaction'));
    expect(screen.getByText('Confirm Transaction')).toBeInTheDocument();

    // Step 7: Click Send Now
    fireEvent.click(screen.getByText('Send Now'));

    // Step 8: Enter password
    expect(screen.getByText('Enter Password')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'MyStr0ngPass!' },
    });

    // Step 9: Authorize & Send
    fireEvent.click(screen.getByText('Authorize & Send'));

    // Step 10: Wait for success
    await waitFor(() => {
      expect(screen.getByText('Transaction Sent')).toBeInTheDocument();
    });
  });

  it('should handle BTC send flow', async () => {
    mockGetAddresses.mockResolvedValue([
      { id: 'addr-btc-001', address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', chain: 'BTC' },
    ]);
    mockSend.mockResolvedValue({
      txHash: 'btctxhash123',
      chain: 'BTC',
      status: 'pending',
      explorerUrl: 'https://blockstream.info/tx/btctxhash123',
    });

    render(<SendPage />);

    // Select BTC chain
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'BTC' } });

    await waitFor(() => {
      expect(screen.getByText('From Address')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Enter recipient address'), {
      target: { value: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' },
    });
    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '0.001' },
    });

    fireEvent.click(screen.getByText('Review Transaction'));
    fireEvent.click(screen.getByText('Send Now'));

    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByText('Authorize & Send'));

    await waitFor(() => {
      expect(screen.getByText('Transaction Sent')).toBeInTheDocument();
    });
  });

  it('should show error on insufficient funds', async () => {
    mockGetAddresses.mockResolvedValue([
      { id: 'addr-eth-001', address: '0x1234', chain: 'ETH' },
    ]);
    mockSend.mockRejectedValue(new Error('Insufficient funds'));

    render(<SendPage />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ETH' } });

    await waitFor(() => {
      expect(screen.getByText('From Address')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Enter recipient address'), {
      target: { value: '0xRecipient123' },
    });
    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '999' },
    });

    fireEvent.click(screen.getByText('Review Transaction'));
    fireEvent.click(screen.getByText('Send Now'));

    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByText('Authorize & Send'));

    await waitFor(() => {
      expect(screen.getByText('Transaction Failed')).toBeInTheDocument();
      expect(screen.getByText('Insufficient funds')).toBeInTheDocument();
    });
  });

  it('should reject wrong password', async () => {
    mockDecrypt.mockResolvedValue(null);
    mockGetAddresses.mockResolvedValue([
      { id: 'addr-eth-001', address: '0x1234', chain: 'ETH' },
    ]);

    render(<SendPage />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ETH' } });

    await waitFor(() => {
      expect(screen.getByText('From Address')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Enter recipient address'), {
      target: { value: '0xRecipient' },
    });
    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '0.1' },
    });

    fireEvent.click(screen.getByText('Review Transaction'));
    fireEvent.click(screen.getByText('Send Now'));

    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'wrongpassword' },
    });
    fireEvent.click(screen.getByText('Authorize & Send'));

    await waitFor(() => {
      expect(screen.getByText('Incorrect password')).toBeInTheDocument();
    });
  });

  it('should allow editing after review', async () => {
    mockGetAddresses.mockResolvedValue([
      { id: 'addr-001', address: '0x1234567890abcdef1234', chain: 'ETH' },
    ]);

    render(<SendPage />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ETH' } });

    await waitFor(() => {
      expect(screen.getByText('From Address')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Enter recipient address'), {
      target: { value: '0xRecipient' },
    });
    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '0.1' },
    });

    // Review
    fireEvent.click(screen.getByText('Review Transaction'));
    expect(screen.getByText('Confirm Transaction')).toBeInTheDocument();

    // Edit - go back
    fireEvent.click(screen.getByText('Edit'));

    // Should be back on the form
    expect(screen.getByText('Review Transaction')).toBeInTheDocument();
  });

  it('should show no-addresses warning for chain without addresses', async () => {
    mockGetAddresses.mockResolvedValue([]);

    render(<SendPage />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'SOL' } });

    await waitFor(() => {
      expect(screen.getByText(/No SOL addresses found/)).toBeInTheDocument();
    });
  });

  it('should redirect to unlock if not unlocked', () => {
    mockState = { ...mockState, isUnlocked: false };
    render(<SendPage />);
    expect(mockReplace).toHaveBeenCalledWith('/web-wallet/unlock');
  });
});
