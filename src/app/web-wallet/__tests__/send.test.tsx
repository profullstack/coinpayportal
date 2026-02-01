import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SendPage from '../send/page';

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

beforeEach(() => {
  mockSend.mockReset();
  mockEstimateFee.mockReset();
  mockGetAddresses.mockReset();
  mockReplace.mockReset();

  mockGetAddresses.mockResolvedValue([]);
  mockEstimateFee.mockResolvedValue({
    low: { fee: '0.0001', feeCurrency: 'BTC' },
    medium: { fee: '0.0002', feeCurrency: 'BTC' },
    high: { fee: '0.0005', feeCurrency: 'BTC' },
  });

  mockState = {
    wallet: {
      send: mockSend,
      estimateFee: mockEstimateFee,
      getAddresses: mockGetAddresses,
    },
    chains: ['BTC', 'ETH', 'SOL'],
    isUnlocked: true,
  };
});

describe('SendPage', () => {
  it('should render the send form', () => {
    render(<SendPage />);

    expect(screen.getByText('Send')).toBeInTheDocument();
    expect(screen.getByText('Chain')).toBeInTheDocument();
  });

  it('should redirect when not unlocked', () => {
    mockState = { ...mockState, isUnlocked: false };
    render(<SendPage />);
    expect(mockReplace).toHaveBeenCalledWith('/web-wallet/unlock');
  });

  it('should show address and fee selectors after chain selection', async () => {
    mockGetAddresses.mockResolvedValue([
      { id: 'a1', address: '1ABC123def456ghi', chain: 'BTC' },
    ]);

    render(<SendPage />);

    // Select chain
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'BTC' },
    });

    await waitFor(() => {
      expect(screen.getByText('From Address')).toBeInTheDocument();
      expect(screen.getByText('Recipient Address')).toBeInTheDocument();
      expect(screen.getByText('Transaction Speed')).toBeInTheDocument();
    });
  });

  it('should show "no addresses" warning when chain has none', async () => {
    mockGetAddresses.mockResolvedValue([]);

    render(<SendPage />);

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'BTC' },
    });

    await waitFor(() => {
      expect(screen.getByText(/No BTC addresses found/)).toBeInTheDocument();
    });
  });

  it('should show fee estimates', async () => {
    mockGetAddresses.mockResolvedValue([
      { id: 'a1', address: '1ABC', chain: 'BTC' },
    ]);

    render(<SendPage />);

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'BTC' },
    });

    await waitFor(() => {
      expect(screen.getByText('Slow')).toBeInTheDocument();
      expect(screen.getByText('Standard')).toBeInTheDocument();
      expect(screen.getByText('Fast')).toBeInTheDocument();
    });
  });

  it('should disable review button when form is incomplete', () => {
    render(<SendPage />);

    const reviewBtn = screen.getByText('Review Transaction');
    expect(reviewBtn).toBeDisabled();
  });

  it('should keep review button disabled when toAddress and amount are empty', async () => {
    mockGetAddresses.mockResolvedValue([
      { id: 'a1', address: '1ABC', chain: 'BTC' },
    ]);

    render(<SendPage />);

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'BTC' },
    });

    await waitFor(() => {
      expect(screen.getByText('From Address')).toBeInTheDocument();
    });

    // Button should be disabled when required fields are empty
    const reviewBtn = screen.getByText('Review Transaction');
    expect(reviewBtn).toBeDisabled();
  });

  it('should show confirmation step', async () => {
    mockGetAddresses.mockResolvedValue([
      { id: 'a1', address: '1ABC123def456ghi789jkl', chain: 'BTC' },
    ]);

    render(<SendPage />);

    // Select chain
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'BTC' },
    });

    await waitFor(() => {
      expect(screen.getByText('From Address')).toBeInTheDocument();
    });

    // Fill recipient
    fireEvent.change(screen.getByPlaceholderText('Enter recipient address'), {
      target: { value: '1XYZ789abc123def456ghi' },
    });

    // Fill amount
    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '0.5' },
    });

    // Review
    fireEvent.click(screen.getByText('Review Transaction'));

    expect(screen.getByText('Confirm Transaction')).toBeInTheDocument();
    expect(screen.getByText('Send Now')).toBeInTheDocument();
    expect(screen.getByText('Edit')).toBeInTheDocument();
  });

  it('should show success state after sending', async () => {
    mockGetAddresses.mockResolvedValue([
      { id: 'a1', address: '1ABC123def456ghi789jkl', chain: 'BTC' },
    ]);
    mockSend.mockResolvedValue({ txHash: '0xtx123', chain: 'BTC', status: 'pending', explorerUrl: '' });

    render(<SendPage />);

    // Select chain
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'BTC' },
    });

    await waitFor(() => {
      expect(screen.getByText('From Address')).toBeInTheDocument();
    });

    // Fill form
    fireEvent.change(screen.getByPlaceholderText('Enter recipient address'), {
      target: { value: '1XYZ789' },
    });
    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '0.5' },
    });

    // Review and send
    fireEvent.click(screen.getByText('Review Transaction'));
    fireEvent.click(screen.getByText('Send Now'));

    await waitFor(() => {
      expect(screen.getByText('Transaction Sent')).toBeInTheDocument();
    });
  });

  it('should show error state on send failure', async () => {
    mockGetAddresses.mockResolvedValue([
      { id: 'a1', address: '1ABC123def456ghi789jkl', chain: 'BTC' },
    ]);
    mockSend.mockRejectedValue(new Error('Insufficient funds'));

    render(<SendPage />);

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'BTC' },
    });

    await waitFor(() => {
      expect(screen.getByText('From Address')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Enter recipient address'), {
      target: { value: '1XYZ789' },
    });
    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '0.5' },
    });

    fireEvent.click(screen.getByText('Review Transaction'));
    fireEvent.click(screen.getByText('Send Now'));

    await waitFor(() => {
      expect(screen.getByText('Transaction Failed')).toBeInTheDocument();
      expect(screen.getByText('Insufficient funds')).toBeInTheDocument();
    });
  });

  it('should have back link to dashboard', () => {
    render(<SendPage />);
    const link = screen.getAllByText(/Dashboard/)[0].closest('a');
    expect(link).toHaveAttribute('href', '/web-wallet');
  });
});
