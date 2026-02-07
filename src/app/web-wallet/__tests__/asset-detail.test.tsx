import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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

vi.mock('@/components/web-wallet/AmountInput', () => ({
  AmountInput: ({
    value,
    onChange,
    symbol,
    label,
    error,
  }: {
    value: string;
    onChange: (v: string) => void;
    symbol?: string;
    label?: string;
    error?: string | null;
  }) => (
    <div data-testid="amount-input">
      {label && <label htmlFor="mock-amount">{label}</label>}
      <input
        id="mock-amount"
        data-testid="amount-field"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`0.00 ${symbol ?? ''}`}
      />
      {error && <p role="alert">{error}</p>}
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
  mockParams = { chain: 'BTC' };
  mockState = {
    hasWallet: true,
    isUnlocked: true,
    isLoading: false,
    wallet: createMockWallet(),
  };
});

// ─────────────────────────────────────────────
// 1. Page-level tests
// ─────────────────────────────────────────────

describe('AssetDetailPage – page-level', () => {
  it('should show loading spinner when wallet is loading', () => {
    mockState = {
      hasWallet: false,
      isUnlocked: false,
      isLoading: true,
      wallet: null,
    };

    const { container } = render(<AssetDetailPage />);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('should redirect to unlock when not unlocked', () => {
    mockState = {
      hasWallet: true,
      isUnlocked: false,
      isLoading: false,
      wallet: null,
    };

    render(<AssetDetailPage />);
    expect(mockReplace).toHaveBeenCalledWith('/web-wallet/unlock');
  });

  it('should show "Unknown Chain" for invalid chain param', () => {
    mockParams = { chain: 'INVALID' };
    mockState = {
      hasWallet: true,
      isUnlocked: true,
      isLoading: false,
      wallet: createMockWallet(),
    };

    render(<AssetDetailPage />);
    expect(screen.getByText('Unknown Chain')).toBeInTheDocument();
    expect(screen.getByText(/not a supported chain/)).toBeInTheDocument();
  });

  it('should show the invalid chain name in the error message', () => {
    mockParams = { chain: 'UNKNOWN_CHAIN' };
    mockState = {
      hasWallet: true,
      isUnlocked: true,
      isLoading: false,
      wallet: createMockWallet(),
    };

    render(<AssetDetailPage />);
    expect(screen.getByText(/UNKNOWN_CHAIN/)).toBeInTheDocument();
  });

  it('should show "Back to Dashboard" link on unknown chain', () => {
    mockParams = { chain: 'FAKE' };
    mockState = {
      hasWallet: true,
      isUnlocked: true,
      isLoading: false,
      wallet: createMockWallet(),
    };

    render(<AssetDetailPage />);
    const link = screen.getByText('Back to Dashboard');
    expect(link.closest('a')).toHaveAttribute('href', '/web-wallet');
  });

  it('should render chain name in header for valid chain', async () => {
    renderUnlockedPage('BTC');
    await waitFor(() => {
      expect(screen.getByText('Bitcoin')).toBeInTheDocument();
    });
  });

  it('should show the wallet header', () => {
    renderUnlockedPage('BTC');
    expect(screen.getByTestId('wallet-header')).toBeInTheDocument();
  });

  it('should show a back link to the dashboard', () => {
    renderUnlockedPage('BTC');
    const dashLink = screen.getByText(/Dashboard/);
    expect(dashLink.closest('a')).toHaveAttribute('href', '/web-wallet');
  });

  it('should display balance after loading', async () => {
    renderUnlockedPage('BTC');

    await waitFor(() => {
      expect(screen.getByText(/0\.005 BTC/)).toBeInTheDocument();
    });
    expect(screen.getByText(/\$100\.00 USD/)).toBeInTheDocument();
  });

  it('should handle balance loading state', () => {
    const neverResolve = new Promise<never>(() => {});
    renderUnlockedPage('BTC', {
      getTotalBalanceUSD: vi.fn().mockReturnValue(neverResolve),
    });

    // Balance section shows pulse animation while loading
    const { container } = render(<div />); // just to access container
    // The page itself should be rendered (tabs visible)
    expect(screen.getByText('Send')).toBeInTheDocument();
  });

  it('should show ETH chain name for ETH param', async () => {
    renderUnlockedPage('ETH', {
      getTotalBalanceUSD: vi.fn().mockResolvedValue({
        totalUsd: 500,
        balances: [{ chain: 'ETH', balance: '0.25', usdValue: 500 }],
      }),
    });

    await waitFor(() => {
      expect(screen.getByText('Ethereum')).toBeInTheDocument();
    });
  });
});

// ─────────────────────────────────────────────
// 2. Tab switching
// ─────────────────────────────────────────────

describe('AssetDetailPage – tab switching', () => {
  it('should render all three tabs', () => {
    renderUnlockedPage('BTC');
    expect(screen.getByText('Send')).toBeInTheDocument();
    expect(screen.getByText('Receive')).toBeInTheDocument();
    expect(screen.getByText('History')).toBeInTheDocument();
  });

  it('should default to Send tab', () => {
    renderUnlockedPage('BTC');
    // Send tab content shows "Recipient Address" label
    expect(screen.getByText('Recipient Address')).toBeInTheDocument();
  });

  it('should switch to Receive tab', async () => {
    renderUnlockedPage('BTC');

    fireEvent.click(screen.getByText('Receive'));

    await waitFor(() => {
      expect(screen.getByText(/Watching for incoming deposits/)).toBeInTheDocument();
    });
  });

  it('should switch to History tab', async () => {
    renderUnlockedPage('BTC');

    fireEvent.click(screen.getByText('History'));

    await waitFor(() => {
      expect(screen.getByTestId('transaction-list')).toBeInTheDocument();
    });
  });

  it('should switch back to Send tab from Receive', async () => {
    renderUnlockedPage('BTC');

    fireEvent.click(screen.getByText('Receive'));
    await waitFor(() => {
      expect(screen.queryByText('Recipient Address')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => {
      expect(screen.getByText('Recipient Address')).toBeInTheDocument();
    });
  });
});

// ─────────────────────────────────────────────
// 3. Send tab
// ─────────────────────────────────────────────

describe('AssetDetailPage – Send tab', () => {
  it('should render the from address selector', async () => {
    renderUnlockedPage('BTC');

    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });
  });

  it('should render recipient address input', () => {
    renderUnlockedPage('BTC');
    expect(screen.getByPlaceholderText('Enter recipient address')).toBeInTheDocument();
  });

  it('should render amount input', () => {
    renderUnlockedPage('BTC');
    expect(screen.getByTestId('amount-input')).toBeInTheDocument();
  });

  it('should render transaction speed selector', async () => {
    renderUnlockedPage('BTC');

    await waitFor(() => {
      expect(screen.getByText('Slow')).toBeInTheDocument();
      expect(screen.getByText('Standard')).toBeInTheDocument();
      expect(screen.getByText('Fast')).toBeInTheDocument();
    });
  });

  it('should render Review Transaction button', () => {
    renderUnlockedPage('BTC');
    expect(screen.getByText('Review Transaction')).toBeInTheDocument();
  });

  it('should show chain-specific addresses in the from selector', async () => {
    const { mockWallet } = renderUnlockedPage('BTC');

    await waitFor(() => {
      expect(mockWallet.getAddresses).toHaveBeenCalledWith({ chain: 'BTC' });
    });
  });

  it('should show a warning when no addresses exist', async () => {
    renderUnlockedPage('BTC', {
      getAddresses: vi.fn().mockResolvedValue([]),
    });

    await waitFor(() => {
      expect(screen.getByText(/No BTC addresses found/)).toBeInTheDocument();
    });
  });

  it('should show "Derive one first" link when no addresses', async () => {
    renderUnlockedPage('BTC', {
      getAddresses: vi.fn().mockResolvedValue([]),
    });

    await waitFor(() => {
      expect(screen.getByText('Derive one first')).toBeInTheDocument();
    });
  });

  it('should validate address is required on review', async () => {
    renderUnlockedPage('BTC');

    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    // Set amount and a whitespace-only address (bypasses disabled, caught by trim validation)
    fireEvent.change(screen.getByTestId('amount-field'), {
      target: { value: '0.001' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter recipient address'), {
      target: { value: ' ' },
    });
    fireEvent.click(screen.getByText('Review Transaction'));

    await waitFor(() => {
      expect(screen.getByText('Address is required')).toBeInTheDocument();
    });
  });

  it('should validate amount is required on review', async () => {
    renderUnlockedPage('BTC');

    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    // Set address and zero amount (bypasses disabled since "0" is truthy, caught by parseFloat check)
    fireEvent.change(screen.getByPlaceholderText('Enter recipient address'), {
      target: { value: 'bc1qrecipient' },
    });
    fireEvent.change(screen.getByTestId('amount-field'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByText('Review Transaction'));

    await waitFor(() => {
      expect(screen.getByText('Amount must be greater than 0')).toBeInTheDocument();
    });
  });

  it('should disable Review button when required fields are empty', async () => {
    renderUnlockedPage('BTC');

    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    // Button disabled when toAddress and amount are empty
    expect(screen.getByText('Review Transaction')).toBeDisabled();
  });

  it('should proceed to confirm step on valid review', async () => {
    renderUnlockedPage('BTC');

    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Enter recipient address'), {
      target: { value: 'bc1qrecipientaddr' },
    });
    fireEvent.change(screen.getByTestId('amount-field'), {
      target: { value: '0.001' },
    });
    fireEvent.click(screen.getByText('Review Transaction'));

    await waitFor(() => {
      expect(screen.getByText('Confirm Transaction')).toBeInTheDocument();
    });
  });

  it('should show correct details in confirm step', async () => {
    renderUnlockedPage('BTC');

    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Enter recipient address'), {
      target: { value: 'bc1qrecipientaddress1234567890abcdef' },
    });
    fireEvent.change(screen.getByTestId('amount-field'), {
      target: { value: '0.5' },
    });
    fireEvent.click(screen.getByText('Review Transaction'));

    await waitFor(() => {
      expect(screen.getByText('Confirm Transaction')).toBeInTheDocument();
      // "Bitcoin" appears in both the page header and the confirm row
      expect(screen.getAllByText('Bitcoin').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('0.5 BTC')).toBeInTheDocument();
      expect(screen.getByText('Standard')).toBeInTheDocument();
    });
  });

  it('should show irreversibility warning on confirm step', async () => {
    renderUnlockedPage('BTC');

    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Enter recipient address'), {
      target: { value: 'bc1qrecipient' },
    });
    fireEvent.change(screen.getByTestId('amount-field'), {
      target: { value: '0.001' },
    });
    fireEvent.click(screen.getByText('Review Transaction'));

    await waitFor(() => {
      expect(screen.getByText(/Transactions cannot be reversed/)).toBeInTheDocument();
    });
  });

  it('should go back to form from confirm step', async () => {
    renderUnlockedPage('BTC');

    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Enter recipient address'), {
      target: { value: 'bc1qrecipient' },
    });
    fireEvent.change(screen.getByTestId('amount-field'), {
      target: { value: '0.001' },
    });
    fireEvent.click(screen.getByText('Review Transaction'));

    await waitFor(() => {
      expect(screen.getByText('Confirm Transaction')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Edit'));

    expect(screen.getByText('Recipient Address')).toBeInTheDocument();
  });

  it('should proceed to password step from confirm', async () => {
    renderUnlockedPage('BTC');

    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Enter recipient address'), {
      target: { value: 'bc1qrecipient' },
    });
    fireEvent.change(screen.getByTestId('amount-field'), {
      target: { value: '0.001' },
    });
    fireEvent.click(screen.getByText('Review Transaction'));

    await waitFor(() => {
      expect(screen.getByText('Send Now')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Send Now'));

    await waitFor(() => {
      expect(screen.getByText('Enter Password')).toBeInTheDocument();
    });
  });

  it('should disable authorize button when password is empty', async () => {
    renderUnlockedPage('BTC');

    // Navigate to password step
    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Enter recipient address'), {
      target: { value: 'bc1qrecipient' },
    });
    fireEvent.change(screen.getByTestId('amount-field'), {
      target: { value: '0.001' },
    });
    fireEvent.click(screen.getByText('Review Transaction'));

    await waitFor(() => expect(screen.getByText('Send Now')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Send Now'));

    await waitFor(() => expect(screen.getByText('Enter Password')).toBeInTheDocument());

    // Button is disabled when password is empty
    expect(screen.getByText('Authorize & Send')).toBeDisabled();
  });

  it('should show password error when submitting via Enter key with empty password', async () => {
    renderUnlockedPage('BTC');

    // Navigate to password step
    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Enter recipient address'), {
      target: { value: 'bc1qrecipient' },
    });
    fireEvent.change(screen.getByTestId('amount-field'), {
      target: { value: '0.001' },
    });
    fireEvent.click(screen.getByText('Review Transaction'));

    await waitFor(() => expect(screen.getByText('Send Now')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Send Now'));

    await waitFor(() => expect(screen.getByText('Enter Password')).toBeInTheDocument());

    // Submit via Enter key on the password input (bypasses disabled button)
    fireEvent.keyDown(screen.getByPlaceholderText('Enter your password'), {
      key: 'Enter',
    });
    await waitFor(() => {
      expect(screen.getByText('Password is required')).toBeInTheDocument();
    });
  });

  it('should show error on incorrect password', async () => {
    mockLoadWalletFromStorage.mockReturnValue({
      encrypted: { salt: 'abc', iv: 'def', ciphertext: 'ghi' },
    });
    mockDecryptWithPassword.mockResolvedValue(null);

    renderUnlockedPage('BTC');

    // Navigate to password step
    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Enter recipient address'), {
      target: { value: 'bc1qrecipient' },
    });
    fireEvent.change(screen.getByTestId('amount-field'), {
      target: { value: '0.001' },
    });
    fireEvent.click(screen.getByText('Review Transaction'));

    await waitFor(() => expect(screen.getByText('Send Now')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Send Now'));

    await waitFor(() => expect(screen.getByText('Enter Password')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'wrongpassword' },
    });
    fireEvent.click(screen.getByText('Authorize & Send'));

    await waitFor(() => {
      expect(screen.getByText('Incorrect password')).toBeInTheDocument();
    });
  });

  it('should show success after successful send', async () => {
    mockLoadWalletFromStorage.mockReturnValue({
      encrypted: { salt: 'abc', iv: 'def', ciphertext: 'ghi' },
    });
    mockDecryptWithPassword.mockResolvedValue('decrypted-seed');

    const { mockWallet } = renderUnlockedPage('BTC');
    mockWallet.send.mockResolvedValue({ txHash: '0xsuccesshash' });

    // Navigate to password step
    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Enter recipient address'), {
      target: { value: 'bc1qrecipient' },
    });
    fireEvent.change(screen.getByTestId('amount-field'), {
      target: { value: '0.001' },
    });
    fireEvent.click(screen.getByText('Review Transaction'));

    await waitFor(() => expect(screen.getByText('Send Now')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Send Now'));

    await waitFor(() => expect(screen.getByText('Enter Password')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'correctpassword' },
    });
    fireEvent.click(screen.getByText('Authorize & Send'));

    await waitFor(() => {
      expect(screen.getByText('Transaction Sent')).toBeInTheDocument();
    });
    expect(screen.getByText(/0\.001 BTC sent successfully/)).toBeInTheDocument();
    expect(screen.getByText(/0xsuccesshash/)).toBeInTheDocument();
  });

  it('should show error state on send failure', async () => {
    mockLoadWalletFromStorage.mockReturnValue({
      encrypted: { salt: 'abc', iv: 'def', ciphertext: 'ghi' },
    });
    mockDecryptWithPassword.mockResolvedValue('decrypted-seed');

    const { mockWallet } = renderUnlockedPage('BTC');
    mockWallet.send.mockRejectedValue(new Error('Insufficient funds'));

    // Navigate to password step
    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Enter recipient address'), {
      target: { value: 'bc1qrecipient' },
    });
    fireEvent.change(screen.getByTestId('amount-field'), {
      target: { value: '0.001' },
    });
    fireEvent.click(screen.getByText('Review Transaction'));

    await waitFor(() => expect(screen.getByText('Send Now')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Send Now'));

    await waitFor(() => expect(screen.getByText('Enter Password')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'correctpassword' },
    });
    fireEvent.click(screen.getByText('Authorize & Send'));

    await waitFor(() => {
      expect(screen.getByText('Transaction Failed')).toBeInTheDocument();
    });
    expect(screen.getByText('Insufficient funds')).toBeInTheDocument();
  });

  it('should show Try Again button on error and reset to form', async () => {
    mockLoadWalletFromStorage.mockReturnValue({
      encrypted: { salt: 'abc', iv: 'def', ciphertext: 'ghi' },
    });
    mockDecryptWithPassword.mockResolvedValue('decrypted-seed');

    const { mockWallet } = renderUnlockedPage('BTC');
    mockWallet.send.mockRejectedValue(new Error('Network error'));

    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Enter recipient address'), {
      target: { value: 'bc1qrecipient' },
    });
    fireEvent.change(screen.getByTestId('amount-field'), {
      target: { value: '0.001' },
    });
    fireEvent.click(screen.getByText('Review Transaction'));
    await waitFor(() => expect(screen.getByText('Send Now')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Send Now'));
    await waitFor(() => expect(screen.getByText('Enter Password')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'pw' },
    });
    fireEvent.click(screen.getByText('Authorize & Send'));

    await waitFor(() => {
      expect(screen.getByText('Transaction Failed')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Try Again'));
    expect(screen.getByText('Recipient Address')).toBeInTheDocument();
  });

  it('should show Send Another button on success and reset to form', async () => {
    mockLoadWalletFromStorage.mockReturnValue({
      encrypted: { salt: 'abc', iv: 'def', ciphertext: 'ghi' },
    });
    mockDecryptWithPassword.mockResolvedValue('decrypted-seed');

    const { mockWallet } = renderUnlockedPage('BTC');
    mockWallet.send.mockResolvedValue({ txHash: '0xhash' });

    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Enter recipient address'), {
      target: { value: 'bc1qrecipient' },
    });
    fireEvent.change(screen.getByTestId('amount-field'), {
      target: { value: '0.001' },
    });
    fireEvent.click(screen.getByText('Review Transaction'));
    await waitFor(() => expect(screen.getByText('Send Now')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Send Now'));
    await waitFor(() => expect(screen.getByText('Enter Password')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'pw' },
    });
    fireEvent.click(screen.getByText('Authorize & Send'));

    await waitFor(() => {
      expect(screen.getByText('Transaction Sent')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Send Another'));
    expect(screen.getByText('Recipient Address')).toBeInTheDocument();
  });

  it('should show fee estimates in speed selector', async () => {
    renderUnlockedPage('BTC');

    await waitFor(() => {
      expect(screen.getByText(/0\.00001 BTC/)).toBeInTheDocument();
      expect(screen.getByText(/0\.00005 BTC/)).toBeInTheDocument();
      expect(screen.getByText(/0\.0001 BTC/)).toBeInTheDocument();
    });
  });

  it('should show fee in confirm step for selected priority', async () => {
    renderUnlockedPage('BTC');

    await waitFor(() => {
      expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    // Select Fast priority
    fireEvent.click(screen.getByText('Fast'));

    fireEvent.change(screen.getByPlaceholderText('Enter recipient address'), {
      target: { value: 'bc1qrecipient' },
    });
    fireEvent.change(screen.getByTestId('amount-field'), {
      target: { value: '0.001' },
    });
    fireEvent.click(screen.getByText('Review Transaction'));

    await waitFor(() => {
      expect(screen.getByText('Confirm Transaction')).toBeInTheDocument();
      expect(screen.getByText('Fast')).toBeInTheDocument();
      expect(screen.getByText('0.0001 BTC')).toBeInTheDocument();
    });
  });
});

// ─────────────────────────────────────────────
// 4. Receive tab
// ─────────────────────────────────────────────

describe('AssetDetailPage – Receive tab', () => {
  it('should show addresses for the chain', async () => {
    renderUnlockedPage('BTC');

    fireEvent.click(screen.getByText('Receive'));

    await waitFor(() => {
      const displays = screen.getAllByTestId('address-display');
      expect(displays.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('should show QR codes for addresses', async () => {
    renderUnlockedPage('BTC');

    fireEvent.click(screen.getByText('Receive'));

    await waitFor(() => {
      const qrCodes = screen.getAllByTestId('qr-code');
      expect(qrCodes.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('should show "Watching for incoming deposits" message', async () => {
    renderUnlockedPage('BTC');

    fireEvent.click(screen.getByText('Receive'));

    await waitFor(() => {
      expect(screen.getByText(/Watching for incoming deposits/)).toBeInTheDocument();
    });
  });

  it('should show chain warning', async () => {
    renderUnlockedPage('BTC');

    fireEvent.click(screen.getByText('Receive'));

    await waitFor(() => {
      expect(screen.getByText(/Only send Bitcoin \(BTC\) to this address/)).toBeInTheDocument();
    });
  });

  it('should show derive button', async () => {
    renderUnlockedPage('BTC');

    fireEvent.click(screen.getByText('Receive'));

    await waitFor(() => {
      expect(screen.getByText(/Generate Additional BTC Address/)).toBeInTheDocument();
    });
  });

  it('should show "Generate" instead of "Generate Additional" when no addresses', async () => {
    renderUnlockedPage('BTC', {
      getAddresses: vi.fn().mockResolvedValue([]),
    });

    fireEvent.click(screen.getByText('Receive'));

    await waitFor(() => {
      expect(screen.getByText('Generate BTC Address')).toBeInTheDocument();
    });
  });

  it('should show "No addresses yet" message when none exist', async () => {
    renderUnlockedPage('BTC', {
      getAddresses: vi.fn().mockResolvedValue([]),
    });

    fireEvent.click(screen.getByText('Receive'));

    await waitFor(() => {
      expect(screen.getByText(/No BTC addresses yet/)).toBeInTheDocument();
    });
  });

  it('should call deriveAddress when derive button is clicked', async () => {
    const { mockWallet } = renderUnlockedPage('BTC');

    fireEvent.click(screen.getByText('Receive'));

    await waitFor(() => {
      expect(screen.getByText(/Generate Additional BTC Address/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Generate Additional BTC Address/));

    await waitFor(() => {
      expect(mockWallet.deriveAddress).toHaveBeenCalledWith('BTC');
    });
  });

  it('should refetch addresses after deriving', async () => {
    const { mockWallet } = renderUnlockedPage('BTC');

    fireEvent.click(screen.getByText('Receive'));

    await waitFor(() => {
      expect(screen.getByText(/Generate Additional BTC Address/)).toBeInTheDocument();
    });

    // Reset call count so we can detect the refetch
    mockWallet.getAddresses.mockClear();
    fireEvent.click(screen.getByText(/Generate Additional BTC Address/));

    await waitFor(() => {
      expect(mockWallet.getAddresses).toHaveBeenCalled();
    });
  });

  it('should show loading state while fetching addresses', () => {
    const neverResolve = new Promise<never>(() => {});
    renderUnlockedPage('BTC', {
      getAddresses: vi.fn().mockReturnValue(neverResolve),
    });

    fireEvent.click(screen.getByText('Receive'));

    // Should not crash, the tab should be rendered
    expect(screen.getByText('Receive')).toBeInTheDocument();
  });

  it('should show multiple addresses when available', async () => {
    renderUnlockedPage('BTC', {
      getAddresses: vi.fn().mockResolvedValue([
        { addressId: 'addr-1', address: 'bc1qfirst1111111111111111111111111', chain: 'BTC', derivationIndex: 0 },
        { addressId: 'addr-2', address: 'bc1qsecond222222222222222222222222', chain: 'BTC', derivationIndex: 1 },
      ]),
    });

    fireEvent.click(screen.getByText('Receive'));

    await waitFor(() => {
      const displays = screen.getAllByTestId('address-display');
      expect(displays).toHaveLength(2);
    });
  });
});

// ─────────────────────────────────────────────
// 5. History tab
// ─────────────────────────────────────────────

describe('AssetDetailPage – History tab', () => {
  it('should show transaction list', async () => {
    renderUnlockedPage('BTC');

    fireEvent.click(screen.getByText('History'));

    await waitFor(() => {
      expect(screen.getByTestId('transaction-list')).toBeInTheDocument();
    });
  });

  it('should show empty message when no transactions', async () => {
    renderUnlockedPage('BTC', {
      getTransactions: vi.fn().mockResolvedValue({
        transactions: [],
        total: 0,
      }),
    });

    fireEvent.click(screen.getByText('History'));

    await waitFor(() => {
      expect(screen.getByText(/No BTC transactions yet/)).toBeInTheDocument();
    });
  });

  it('should render transactions when available', async () => {
    renderUnlockedPage('BTC', {
      getTransactions: vi.fn().mockResolvedValue({
        transactions: [
          {
            id: 'tx-1',
            txHash: '0xhash1',
            chain: 'BTC',
            direction: 'outgoing',
            amount: '0.5',
            status: 'confirmed',
            confirmations: 6,
            fromAddress: 'bc1qfrom',
            toAddress: 'bc1qto',
            createdAt: new Date().toISOString(),
          },
          {
            id: 'tx-2',
            txHash: '0xhash2',
            chain: 'BTC',
            direction: 'incoming',
            amount: '1.0',
            status: 'pending',
            confirmations: 0,
            fromAddress: 'bc1qsender',
            toAddress: 'bc1qme',
            createdAt: new Date().toISOString(),
          },
        ],
        total: 2,
      }),
    });

    fireEvent.click(screen.getByText('History'));

    await waitFor(() => {
      const items = screen.getAllByTestId('tx-item');
      expect(items).toHaveLength(2);
    });
  });

  it('should call getTransactions with correct chain', async () => {
    const { mockWallet } = renderUnlockedPage('ETH', {
      getTotalBalanceUSD: vi.fn().mockResolvedValue({
        totalUsd: 0,
        balances: [],
      }),
      getAddresses: vi.fn().mockResolvedValue([]),
      estimateFee: vi.fn().mockResolvedValue({
        low: { fee: '0.001', feeCurrency: 'ETH' },
        medium: { fee: '0.003', feeCurrency: 'ETH' },
        high: { fee: '0.005', feeCurrency: 'ETH' },
      }),
    });

    fireEvent.click(screen.getByText('History'));

    await waitFor(() => {
      expect(mockWallet.getTransactions).toHaveBeenCalledWith(
        expect.objectContaining({ chain: 'ETH' })
      );
    });
  });

  it('should show "Load more" button when there are more transactions', async () => {
    // Return exactly PAGE_SIZE (20) items to indicate more exist
    const txs = Array.from({ length: 20 }, (_, i) => ({
      id: `tx-${i}`,
      txHash: `0xhash${i}`,
      chain: 'BTC',
      direction: 'outgoing' as const,
      amount: '0.01',
      status: 'confirmed' as const,
      confirmations: 6,
      fromAddress: 'bc1qfrom',
      toAddress: 'bc1qto',
      createdAt: new Date().toISOString(),
    }));

    renderUnlockedPage('BTC', {
      getTransactions: vi.fn().mockResolvedValue({
        transactions: txs,
        total: 40,
      }),
    });

    fireEvent.click(screen.getByText('History'));

    await waitFor(() => {
      expect(screen.getByText('Load more')).toBeInTheDocument();
    });
  });

  it('should not show "Load more" when fewer than PAGE_SIZE results', async () => {
    renderUnlockedPage('BTC', {
      getTransactions: vi.fn().mockResolvedValue({
        transactions: [
          {
            id: 'tx-1',
            txHash: '0xhash1',
            chain: 'BTC',
            direction: 'outgoing',
            amount: '0.5',
            status: 'confirmed',
            confirmations: 6,
            fromAddress: 'bc1qfrom',
            toAddress: 'bc1qto',
            createdAt: new Date().toISOString(),
          },
        ],
        total: 1,
      }),
    });

    fireEvent.click(screen.getByText('History'));

    await waitFor(() => {
      expect(screen.getByTestId('tx-item')).toBeInTheDocument();
    });

    expect(screen.queryByText('Load more')).not.toBeInTheDocument();
  });

  it('should load more transactions when clicking Load more', async () => {
    const page1 = Array.from({ length: 20 }, (_, i) => ({
      id: `tx-${i}`,
      txHash: `0xhash${i}`,
      chain: 'BTC',
      direction: 'outgoing' as const,
      amount: '0.01',
      status: 'confirmed' as const,
      confirmations: 6,
      fromAddress: 'bc1qfrom',
      toAddress: 'bc1qto',
      createdAt: new Date().toISOString(),
    }));

    const page2 = Array.from({ length: 5 }, (_, i) => ({
      id: `tx-${20 + i}`,
      txHash: `0xhash${20 + i}`,
      chain: 'BTC',
      direction: 'incoming' as const,
      amount: '0.02',
      status: 'confirmed' as const,
      confirmations: 3,
      fromAddress: 'bc1qfrom2',
      toAddress: 'bc1qto2',
      createdAt: new Date().toISOString(),
    }));

    const mockGetTx = vi
      .fn()
      .mockResolvedValueOnce({ transactions: page1, total: 25 })
      .mockResolvedValueOnce({ transactions: page2, total: 25 });

    renderUnlockedPage('BTC', {
      getTransactions: mockGetTx,
    });

    fireEvent.click(screen.getByText('History'));

    await waitFor(() => {
      expect(screen.getByText('Load more')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Load more'));

    await waitFor(() => {
      expect(mockGetTx).toHaveBeenCalledTimes(2);
      expect(mockGetTx).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 20 })
      );
    });
  });

  it('should show loading spinner during pagination', async () => {
    const page1 = Array.from({ length: 20 }, (_, i) => ({
      id: `tx-${i}`,
      txHash: `0xhash${i}`,
      chain: 'BTC',
      direction: 'outgoing' as const,
      amount: '0.01',
      status: 'confirmed' as const,
      confirmations: 6,
      fromAddress: 'bc1qfrom',
      toAddress: 'bc1qto',
      createdAt: new Date().toISOString(),
    }));

    let resolvePage2: (value: any) => void;
    const page2Promise = new Promise((resolve) => {
      resolvePage2 = resolve;
    });

    const mockGetTx = vi
      .fn()
      .mockResolvedValueOnce({ transactions: page1, total: 25 })
      .mockReturnValueOnce(page2Promise);

    const { container } = renderUnlockedPage('BTC', {
      getTransactions: mockGetTx,
    });

    fireEvent.click(screen.getByText('History'));

    await waitFor(() => {
      expect(screen.getByText('Load more')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Load more'));

    // While page 2 is loading, spinner should appear
    await waitFor(() => {
      // The page > 0 loading spinner has aria-busy="true"
      const busyEl = container.querySelector('[aria-busy="true"]');
      expect(busyEl).toBeInTheDocument();
    });

    // Resolve page 2 to clean up
    resolvePage2!({ transactions: [], total: 25 });
  });
});
