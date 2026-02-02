/**
 * E2E Test: Receive Flow
 *
 * Tests the receive page: chain filter → address display → QR code → derive new address.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReceivePage from '../receive/page';

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

// Mock QRCode since it uses canvas
vi.mock('@/components/web-wallet/QRCode', () => ({
  QRCode: ({ value, label }: { value: string; label?: string }) => (
    <div data-testid="qr-code" data-value={value}>
      QR: {label || value}
    </div>
  ),
}));

const mockGetAddresses = vi.fn();
const mockDeriveAddress = vi.fn();
let mockState: any;

vi.mock('@/components/web-wallet/WalletContext', () => ({
  useWebWallet: () => mockState,
}));

beforeEach(() => {
  mockGetAddresses.mockReset();
  mockDeriveAddress.mockReset();
  mockReplace.mockReset();

  mockGetAddresses.mockResolvedValue([
    { id: 'a1', chain: 'BTC', address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', derivation_index: 0 },
    { id: 'a2', chain: 'ETH', address: '0x1234567890abcdef1234567890abcdef12345678', derivation_index: 0 },
    { id: 'a3', chain: 'SOL', address: 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH', derivation_index: 0 },
  ]);

  mockState = {
    wallet: {
      getAddresses: mockGetAddresses,
      deriveAddress: mockDeriveAddress,
    },
    chains: ['BTC', 'ETH', 'SOL'],
    isUnlocked: true,
  };
});

describe('E2E: Receive Flow', () => {
  it('should render the receive page with addresses', async () => {
    render(<ReceivePage />);

    expect(screen.getByText('Receive')).toBeInTheDocument();
    expect(screen.getByText('Share your address to receive crypto')).toBeInTheDocument();

    // Wait for addresses to load
    await waitFor(() => {
      expect(screen.getByText('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toBeInTheDocument();
    });
  });

  it('should show all addresses when no filter applied', async () => {
    render(<ReceivePage />);

    await waitFor(() => {
      expect(screen.getByText('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toBeInTheDocument();
      expect(screen.getByText('0x1234567890abcdef1234567890abcdef12345678')).toBeInTheDocument();
      expect(screen.getByText('HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH')).toBeInTheDocument();
    });
  });

  it('should filter addresses by chain', async () => {
    render(<ReceivePage />);

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toBeInTheDocument();
    });

    // Select BTC chain filter
    const chainSelect = screen.getByRole('combobox');
    fireEvent.change(chainSelect, { target: { value: 'BTC' } });

    // Should re-fetch for BTC
    await waitFor(() => {
      expect(mockGetAddresses).toHaveBeenCalled();
    });
  });

  it('should show QR codes for addresses', async () => {
    render(<ReceivePage />);

    await waitFor(() => {
      const qrCodes = screen.getAllByTestId('qr-code');
      expect(qrCodes.length).toBeGreaterThan(0);
    });
  });

  it('should show chain-specific warning when chain selected', async () => {
    render(<ReceivePage />);

    // Select BTC
    const chainSelect = screen.getByRole('combobox');
    fireEvent.change(chainSelect, { target: { value: 'BTC' } });

    await waitFor(() => {
      expect(screen.getByText(/Only send Bitcoin/)).toBeInTheDocument();
    });
  });

  it('should show ETH chain warning', async () => {
    render(<ReceivePage />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ETH' } });

    await waitFor(() => {
      expect(screen.getByText(/Only send Ethereum/)).toBeInTheDocument();
    });
  });

  it('should show SOL chain warning', async () => {
    render(<ReceivePage />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'SOL' } });

    await waitFor(() => {
      expect(screen.getByText(/Only send Solana/)).toBeInTheDocument();
    });
  });

  it('should show derive address button when chain selected', async () => {
    render(<ReceivePage />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'BTC' } });

    await waitFor(() => {
      expect(screen.getByText(/Generate Additional BTC Address/)).toBeInTheDocument();
    });
  });

  it('should derive a new address', async () => {
    mockDeriveAddress.mockResolvedValue({
      address_id: 'new-addr-001',
      chain: 'BTC',
      address: '1NewAddressGenerated',
    });

    render(<ReceivePage />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'BTC' } });

    await waitFor(() => {
      expect(screen.getByText(/Generate Additional BTC Address/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Generate Additional BTC Address/));

    // After derive, getAddresses should be called again
    await waitFor(() => {
      expect(mockDeriveAddress).toHaveBeenCalledWith('BTC');
    });
  });

  it('should show error on derive failure', async () => {
    mockDeriveAddress.mockRejectedValue(new Error('Derivation limit reached'));

    render(<ReceivePage />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ETH' } });

    await waitFor(() => {
      expect(screen.getByText(/Generate Additional ETH Address/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Generate Additional ETH Address/));

    await waitFor(() => {
      expect(screen.getByText('Derivation limit reached')).toBeInTheDocument();
    });
  });

  it('should show empty state when no addresses exist for chain', async () => {
    mockGetAddresses.mockResolvedValue([]);

    render(<ReceivePage />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'BTC' } });

    await waitFor(() => {
      expect(screen.getByText(/No BTC addresses yet/)).toBeInTheDocument();
    });
  });

  it('should redirect to unlock when not unlocked', () => {
    mockState = { ...mockState, isUnlocked: false };
    render(<ReceivePage />);
    expect(mockReplace).toHaveBeenCalledWith('/web-wallet/unlock');
  });

  it('should have back link to dashboard', () => {
    render(<ReceivePage />);
    const backLink = screen.getByText('← Dashboard');
    expect(backLink.closest('a')).toHaveAttribute('href', '/web-wallet');
  });
});
