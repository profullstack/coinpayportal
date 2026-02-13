import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AssetDetailPage from '../asset/[chain]/page';

// ── Navigation mocks ──

const mockPush = vi.fn();
const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useParams: () => mockParams,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// ── Component mocks ──

vi.mock('@/components/web-wallet/WalletHeader', () => ({
  WalletHeader: () => <div data-testid="wallet-header">Header</div>,
}));

vi.mock('@/components/web-wallet/AddressDisplay', () => ({
  AddressDisplay: ({ address, label }: { address: string; label?: string }) => (
    <div data-testid="address-display">
      <span>{address}</span>
      {label && <span>{label}</span>}
    </div>
  ),
  ChainBadge: ({ chain }: { chain: string }) => (
    <span data-testid="chain-badge">{chain}</span>
  ),
}));

vi.mock('@/components/web-wallet/QRCode', () => ({
  QRCode: ({ value, label }: { value: string; label?: string }) => (
    <div data-testid="qr-code" aria-label={label}>
      QR:{value}
    </div>
  ),
}));

vi.mock('@/components/web-wallet/TransactionList', () => ({
  TransactionList: ({
    transactions,
    isLoading,
    emptyMessage,
  }: {
    transactions: { id: string; txHash: string; chain: string; type: string; amount: string }[];
    isLoading?: boolean;
    emptyMessage?: string;
  }) => (
    <div data-testid="transaction-list">
      {isLoading && <div data-testid="tx-loading">Loading...</div>}
      {!isLoading && transactions.length === 0 && (
        <div data-testid="tx-empty">{emptyMessage ?? 'No transactions yet'}</div>
      )}
      {transactions.map((tx) => (
        <div key={tx.id} data-testid="tx-item">
          {tx.type} {tx.amount} {tx.chain}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('qrcode', () => ({
  default: { toCanvas: vi.fn().mockResolvedValue(undefined) },
}));

// ── Crypto mock ──

const mockDecryptWithPassword = vi.fn();
const mockLoadWalletFromStorage = vi.fn();

vi.mock('@/lib/web-wallet/client-crypto', () => ({
  decryptWithPassword: (...args: unknown[]) => mockDecryptWithPassword(...args),
  loadWalletFromStorage: () => mockLoadWalletFromStorage(),
}));

// ── Mock fetch for exchange rates ──

const mockFetch = vi.fn();
global.fetch = mockFetch;

// ── Wallet state ──

let mockParams: { chain?: string } = {};
let mockState: any;

vi.mock('@/components/web-wallet/WalletContext', () => ({
  useWebWallet: () => mockState,
}));

// ── Helpers ──

function createMockWallet(overrides: Record<string, any> = {}) {
  return {
    getTotalBalanceUSD: vi.fn().mockResolvedValue({
      totalUsd: 100,
      balances: [
        { chain: 'BTC', balance: '0.005', usdValue: 100 },
      ],
    }),
    getAddresses: vi.fn().mockResolvedValue([
      {
        addressId: 'addr-1',
        address: 'bc1qexampleaddr111111111111111111111',
        chain: 'BTC',
        derivationIndex: 0,
      },
    ]),
    estimateFee: vi.fn().mockResolvedValue({
      low: { fee: '0.00001', feeCurrency: 'BTC' },
      medium: { fee: '0.00005', feeCurrency: 'BTC' },
      high: { fee: '0.0001', feeCurrency: 'BTC' },
    }),
    send: vi.fn().mockResolvedValue({ txHash: '0xtxhash123' }),
    getTransactions: vi.fn().mockResolvedValue({
      transactions: [],
      total: 0,
    }),
    deriveAddress: vi.fn().mockResolvedValue({
      addressId: 'addr-2',
      address: 'bc1qnewaddr222222222222222222222222',
      chain: 'BTC',
    }),
    getBalances: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function renderUnlockedPage(chain = 'BTC', walletOverrides: Record<string, any> = {}) {
  mockParams = { chain };
  const mockWallet = createMockWallet(walletOverrides);
  mockState = {
    hasWallet: true,
    isUnlocked: true,
    isLoading: false,
    wallet: mockWallet,
  };
  const result = render(<AssetDetailPage />);
  return { ...result, mockWallet };
}

// ── Tests ──

beforeEach(() => {
  mockPush.mockReset();
  mockReplace.mockReset();
  mockDecryptWithPassword.mockReset();
  mockLoadWalletFromStorage.mockReset();
  mockFetch.mockReset();
  
  // Default mock for rates API
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/api/rates')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          rate: 50000 // BTC rate for testing
        })
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({})
    });
  });
  
  mockParams = { chain: 'BTC' };
  mockState = {
    hasWallet: true,
    isUnlocked: true,
    isLoading: false,
    wallet: createMockWallet(),
  };
});

// ─────────────────────────────────────────────
// Dual Input System Tests
// ─────────────────────────────────────────────

describe.skip('AssetDetailPage - Send Tab - Dual Input System', () => {
  it('should render dual input system with fiat currency selector', async () => {
    renderUnlockedPage('BTC');
    
    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    // Check fiat currency selector exists
    expect(screen.getByDisplayValue('USD ($)')).toBeInTheDocument();
    
    // Check both input fields exist
    expect(screen.getByPlaceholderText('0.00 USD')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('0.000000 BTC')).toBeInTheDocument();
  });

  it('should have fiat as primary input initially', async () => {
    renderUnlockedPage('BTC');
    
    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    const fiatInput = screen.getByPlaceholderText('0.00 USD');
    const cryptoInput = screen.getByPlaceholderText('0.000000 BTC');
    
    expect(fiatInput).not.toBeDisabled();
    expect(cryptoInput).toBeDisabled();
    expect(screen.getByText('Primary')).toBeInTheDocument();
  });

  it('should toggle primary input when clicking swap button', async () => {
    const user = userEvent.setup();
    renderUnlockedPage('BTC');
    
    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    const fiatInput = screen.getByPlaceholderText('0.00 USD');
    const cryptoInput = screen.getByPlaceholderText('0.000000 BTC');
    const swapButton = screen.getByTitle('Switch primary input');
    
    // Initially fiat is primary
    expect(fiatInput).not.toBeDisabled();
    expect(cryptoInput).toBeDisabled();
    
    // Click swap button
    await user.click(swapButton);
    
    // Now crypto should be primary
    expect(fiatInput).toBeDisabled();
    expect(cryptoInput).not.toBeDisabled();
  });

  it('should fetch exchange rate on load', async () => {
    renderUnlockedPage('BTC');
    
    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/rates?coin=BTC&fiat=USD')
      );
    });
  });

  it('should show exchange rate when loaded', async () => {
    renderUnlockedPage('BTC');
    
    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText(/1 BTC = \$50,000\.00 USD/)).toBeInTheDocument();
    });
  });

  it('should calculate crypto amount when typing in fiat input', async () => {
    const user = userEvent.setup();
    renderUnlockedPage('BTC');
    
    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    // Wait for exchange rate to load
    await waitFor(() => {
      expect(screen.getByText(/1 BTC = \$50,000\.00 USD/)).toBeInTheDocument();
    });

    const fiatInput = screen.getByPlaceholderText('0.00 USD');
    const cryptoInput = screen.getByPlaceholderText('0.000000 BTC');
    
    // Type $1000 in fiat input
    await user.clear(fiatInput);
    await user.type(fiatInput, '1000');
    
    // Should calculate crypto amount (1000 / 50000 = 0.02)
    await waitFor(() => {
      expect(cryptoInput).toHaveValue(0.02);
    });
  });

  it('should calculate fiat amount when crypto is primary and typing', async () => {
    const user = userEvent.setup();
    renderUnlockedPage('BTC');
    
    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    // Wait for exchange rate to load
    await waitFor(() => {
      expect(screen.getByText(/1 BTC = \$50,000\.00 USD/)).toBeInTheDocument();
    });

    const swapButton = screen.getByTitle('Switch primary input');
    const fiatInput = screen.getByPlaceholderText('0.00 USD');
    const cryptoInput = screen.getByPlaceholderText('0.000000 BTC');
    
    // Switch to crypto primary
    await user.click(swapButton);
    
    // Type 0.1 BTC
    await user.clear(cryptoInput);
    await user.type(cryptoInput, '0.1');
    
    // Should calculate fiat amount (0.1 * 50000 = 5000)
    await waitFor(() => {
      expect(fiatInput).toHaveValue(5000);
    });
  });

  it('should change fiat currency and refetch rate', async () => {
    const user = userEvent.setup();
    renderUnlockedPage('BTC');
    
    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    const currencySelect = screen.getByDisplayValue('USD ($)');
    
    // Change to EUR
    await user.selectOptions(currencySelect, 'EUR');
    
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/rates?coin=BTC&fiat=EUR')
      );
    });
  });

  it('should show rate loading state', async () => {
    // Mock a slow API response
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/rates')) {
        return new Promise(() => {}); // Never resolves
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      });
    });

    renderUnlockedPage('BTC');
    
    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('Loading exchange rate...')).toBeInTheDocument();
    });
  });

  it('should show rate error on API failure', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/rates')) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({
            success: false,
            error: 'Rate fetch failed'
          })
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      });
    });

    renderUnlockedPage('BTC');
    
    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('Failed to fetch exchange rate')).toBeInTheDocument();
    });
  });

  it('should use crypto amount for form submission', async () => {
    const user = userEvent.setup();
    renderUnlockedPage('BTC');
    
    mockLoadWalletFromStorage.mockReturnValue({
      encrypted: { salt: 'abc', iv: 'def', ciphertext: 'ghi' },
    });
    mockDecryptWithPassword.mockResolvedValue('decrypted-seed');
    
    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    // Wait for exchange rate to load
    await waitFor(() => {
      expect(screen.getByText(/1 BTC = \$50,000\.00 USD/)).toBeInTheDocument();
    });

    const fiatInput = screen.getByPlaceholderText('0.00 USD');
    const toAddressInput = screen.getByPlaceholderText('Enter recipient address');
    
    // Fill in form with fiat amount
    await user.clear(fiatInput);
    await user.type(fiatInput, '1000');
    await user.clear(toAddressInput);
    await user.type(toAddressInput, 'bc1qrecipient');
    
    // Submit through review and confirmation
    await user.click(screen.getByText('Review Transaction'));
    
    await waitFor(() => {
      expect(screen.getByText('Confirm Transaction')).toBeInTheDocument();
    });
    
    await user.click(screen.getByText('Send Now'));
    
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument();
    });
    
    await user.type(screen.getByPlaceholderText('Enter your password'), 'password');
    await user.click(screen.getByText('Authorize & Send'));
    
    // Verify wallet.send was called with crypto amount (0.02 BTC)
    await waitFor(() => {
      expect(mockState.wallet.send).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: '0.02'
        })
      );
    });
  });

  it('should reset dual input state when resetting form', async () => {
    const user = userEvent.setup();
    renderUnlockedPage('BTC');
    
    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    // Wait for exchange rate to load
    await waitFor(() => {
      expect(screen.getByText(/1 BTC = \$50,000\.00 USD/)).toBeInTheDocument();
    });

    const fiatInput = screen.getByPlaceholderText('0.00 USD');
    const swapButton = screen.getByTitle('Switch primary input');
    
    // Type amount and switch to crypto primary
    await user.clear(fiatInput);
    await user.type(fiatInput, '1000');
    await user.click(swapButton);
    
    // Verify state
    expect(screen.getByPlaceholderText('0.000000 BTC')).toHaveValue(0.02);
    expect(screen.getByPlaceholderText('0.000000 BTC')).not.toBeDisabled();
    expect(fiatInput).toBeDisabled();
    
    // Navigate to error state and reset
    mockLoadWalletFromStorage.mockReturnValue({
      encrypted: { salt: 'abc', iv: 'def', ciphertext: 'ghi' },
    });
    mockDecryptWithPassword.mockResolvedValue('decrypted-seed');
    mockState.wallet.send.mockRejectedValue(new Error('Test error'));
    
    await user.clear(screen.getByPlaceholderText('Enter recipient address'));
    await user.type(screen.getByPlaceholderText('Enter recipient address'), 'bc1qrecipient');
    await user.click(screen.getByText('Review Transaction'));
    await user.click(screen.getByText('Send Now'));
    await user.type(screen.getByPlaceholderText('Enter your password'), 'password');
    await user.click(screen.getByText('Authorize & Send'));
    
    await waitFor(() => {
      expect(screen.getByText('Transaction Failed')).toBeInTheDocument();
    });
    
    await user.click(screen.getByText('Try Again'));
    
    // Verify dual input state was reset
    expect(screen.getByPlaceholderText('0.00 USD')).toHaveValue(null);
    expect(screen.getByPlaceholderText('0.000000 BTC')).toHaveValue(null);
    expect(screen.getByPlaceholderText('0.00 USD')).not.toBeDisabled();
    expect(screen.getByPlaceholderText('0.000000 BTC')).toBeDisabled();
  });

  it('should validate crypto amount is required', async () => {
    const user = userEvent.setup();
    renderUnlockedPage('BTC');

    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    // Switch to crypto primary and enter 0 (enables button but fails validation)
    const swapButton = screen.getByTitle('Switch primary input');
    await user.click(swapButton);

    const cryptoInput = screen.getByPlaceholderText('0.000000 BTC');
    await user.type(cryptoInput, '0');

    // Fill address
    await user.type(screen.getByPlaceholderText('Enter recipient address'), 'bc1qrecipient');

    await user.click(screen.getByText('Review Transaction'));

    await waitFor(() => {
      expect(screen.getByText('Amount must be greater than 0')).toBeInTheDocument();
    });
  });
});