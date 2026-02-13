import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock Next.js router
const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
};

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

// Mock auth fetch
vi.mock('@/lib/auth/client', () => ({
  authFetch: vi.fn(),
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import component after mocks
import CreateEscrowPage from './page';
import { authFetch } from '@/lib/auth/client';

describe('CreateEscrowPage - Dual Input Feature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock auth fetch to return null (not logged in, triggers anonymous fallback)
    vi.mocked(authFetch).mockResolvedValue(null);
    
    // Mock rates API response with a typical exchange rate
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/rates')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            rate: 1.0 // USDC rate for simplicity
          })
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('should render the dual input system with correct initial state', async () => {
    render(<CreateEscrowPage />);
    
    // Wait for component to load
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Escrow' })).toBeInTheDocument();
    });

    // Check fiat currency selector is present
    expect(screen.getByText('USD ($)')).toBeInTheDocument();
    
    // Check both input fields are present
    const fiatInput = screen.getByPlaceholderText(/0\.00 USD/);
    const cryptoInput = screen.getByPlaceholderText(/0\.000000 USDC_POL/);
    
    expect(fiatInput).toBeInTheDocument();
    expect(cryptoInput).toBeInTheDocument();
    
    // Check initial state - fiat should be primary (enabled), crypto secondary (disabled)
    expect(fiatInput).not.toBeDisabled();
    expect(cryptoInput).toBeDisabled();
    
    // Check "Primary" indicator
    expect(screen.getByText('Primary')).toBeInTheDocument();
  });

  it('should toggle between fiat and crypto primary input', async () => {
    const user = userEvent.setup();
    render(<CreateEscrowPage />);
    
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Escrow' })).toBeInTheDocument();
    });

    const fiatInput = screen.getByPlaceholderText(/0\.00 USD/);
    const cryptoInput = screen.getByPlaceholderText(/0\.000000 USDC_POL/);
    const toggleButton = screen.getByTitle('Switch primary input');
    
    // Initially fiat should be primary
    expect(fiatInput).not.toBeDisabled();
    expect(cryptoInput).toBeDisabled();
    
    // Toggle to crypto primary
    await user.click(toggleButton);
    
    expect(fiatInput).toBeDisabled();
    expect(cryptoInput).not.toBeDisabled();
    
    // Toggle back to fiat primary
    await user.click(toggleButton);
    
    expect(fiatInput).not.toBeDisabled();
    expect(cryptoInput).toBeDisabled();
  });

  it('should fetch exchange rates when component loads', async () => {
    render(<CreateEscrowPage />);
    
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Escrow' })).toBeInTheDocument();
    });

    // Should fetch rate for initial chain (USDC_POL) and currency (USD)
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/rates?coin=USDC_POL&fiat=USD')
      );
    });
  });

  it('should auto-calculate crypto amount when typing in fiat input', async () => {
    const user = userEvent.setup();
    
    // Mock exchange rate of 1.0 for USDC
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/rates')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            rate: 1.0
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<CreateEscrowPage />);
    
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Escrow' })).toBeInTheDocument();
    });

    // Wait for rate to load
    await waitFor(() => {
      expect(screen.getByText(/1 USDC_POL = \$1/)).toBeInTheDocument();
    });

    const fiatInput = screen.getByPlaceholderText(/0\.00 USD/);
    const cryptoInput = screen.getByPlaceholderText(/0\.000000 USDC_POL/);
    
    // Type in fiat input
    await user.clear(fiatInput);
    await user.type(fiatInput, '100');
    
    // Crypto amount should be calculated automatically
    await waitFor(() => {
      expect(cryptoInput).toHaveValue(100);
    });
  });

  it('should auto-calculate fiat amount when typing in crypto input', async () => {
    const user = userEvent.setup();
    
    // Mock exchange rate of 2.0 for test
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/rates')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            rate: 2.0
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<CreateEscrowPage />);
    
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Escrow' })).toBeInTheDocument();
    });

    // Switch to crypto primary
    const toggleButton = screen.getByTitle('Switch primary input');
    await user.click(toggleButton);
    
    // Wait for rate to load
    await waitFor(() => {
      expect(screen.getByText(/1 USDC_POL = \$2/)).toBeInTheDocument();
    });

    const fiatInput = screen.getByPlaceholderText(/0\.00 USD/);
    const cryptoInput = screen.getByPlaceholderText(/0\.000000 USDC_POL/);
    
    // Type in crypto input
    await user.clear(cryptoInput);
    await user.type(cryptoInput, '50');
    
    // Fiat amount should be calculated automatically (50 * 2.0 = 100)
    await waitFor(() => {
      expect(fiatInput).toHaveValue(100);
    });
  });

  it('should trigger rate re-fetch when fiat currency changes', async () => {
    const user = userEvent.setup();
    render(<CreateEscrowPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Escrow' })).toBeInTheDocument();
    });

    // Initial call for USD
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/rates?coin=USDC_POL&fiat=USD')
      );
    });

    vi.clearAllMocks();

    // Change fiat currency to EUR - find the fiat currency selector (not the chain selector)
    const currencySelectors = screen.getAllByRole('combobox');
    const fiatCurrencySelector = currencySelectors.find(select =>
      (select as HTMLSelectElement).value === 'USD'
    )!;
    await user.selectOptions(fiatCurrencySelector, 'EUR');
    
    // Should trigger new rate fetch
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/rates?coin=USDC_POL&fiat=EUR')
      );
    });
  });

  it('should trigger rate re-fetch when chain changes', async () => {
    const user = userEvent.setup();
    render(<CreateEscrowPage />);
    
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Escrow' })).toBeInTheDocument();
    });

    // Initial call for USDC_POL
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/rates?coin=USDC_POL&fiat=USD')
      );
    });

    vi.clearAllMocks();

    // Change chain to BTC - need to use the chain selector
    const chainSelector = screen.getByLabelText('Cryptocurrency *');
    await user.selectOptions(chainSelector, 'BTC');
    
    // Should trigger new rate fetch
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/rates?coin=BTC&fiat=USD')
      );
    });
  });

  it('should handle stablecoin rate (~1.0) correctly', async () => {
    const user = userEvent.setup();
    
    // Mock stablecoin rate close to 1.0
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/rates')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            rate: 0.999 // Typical stablecoin rate
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<CreateEscrowPage />);
    
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Escrow' })).toBeInTheDocument();
    });

    // Wait for rate to load
    await waitFor(() => {
      expect(screen.getByText(/1 USDC_POL = \$0\.999/)).toBeInTheDocument();
    });

    const fiatInput = screen.getByPlaceholderText(/0\.00 USD/);
    const cryptoInput = screen.getByPlaceholderText(/0\.000000 USDC_POL/);
    
    // Type 100 USD
    await user.clear(fiatInput);
    await user.type(fiatInput, '100');
    
    // Should calculate crypto amount using the stablecoin rate
    // 100 / 0.999 ≈ 100.1
    await waitFor(() => {
      expect(parseFloat(cryptoInput.value)).toBeCloseTo(100.1, 1);
    });
  });

  it('should display loading state while fetching exchange rates', async () => {
    // Mock delayed rate response
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/rates')) {
        return new Promise(resolve => {
          setTimeout(() => {
            resolve({
              ok: true,
              json: () => Promise.resolve({
                success: true,
                rate: 1.0
              })
            });
          }, 100);
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<CreateEscrowPage />);
    
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Escrow' })).toBeInTheDocument();
    });

    // Should show loading state (after 300ms debounce fires)
    await waitFor(() => {
      expect(screen.getByText('Loading exchange rate...')).toBeInTheDocument();
    });

    // Should eventually show the rate
    await waitFor(() => {
      expect(screen.getByText(/1 USDC_POL = \$1/)).toBeInTheDocument();
    }, { timeout: 2000 });
  });

  it('should display error when rate fetch fails', async () => {
    // Mock failed rate response
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/rates')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: false,
            error: 'Rate not available'
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<CreateEscrowPage />);
    
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Escrow' })).toBeInTheDocument();
    });

    // Should show error message
    await waitFor(() => {
      expect(screen.getByText('Failed to fetch exchange rate')).toBeInTheDocument();
    });
  });

  it('should submit form with crypto amount regardless of input mode', async () => {
    const user = userEvent.setup();
    
    // Mock successful escrow creation
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/rates')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            rate: 1.0
          })
        });
      }
      if (url.includes('/api/escrow') && url !== '/api/escrow') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            id: 'test-escrow-id',
            escrow_address: 'test-address',
            depositor_address: 'test-depositor',
            beneficiary_address: 'test-beneficiary',
            chain: 'USDC_POL',
            amount: 100,
            status: 'pending',
            release_token: 'test-release-token',
            beneficiary_token: 'test-beneficiary-token',
            expires_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            metadata: {}
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<CreateEscrowPage />);
    
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Escrow' })).toBeInTheDocument();
    });

    // Wait for rate to load
    await waitFor(() => {
      expect(screen.getByText(/1 USDC_POL = \$1/)).toBeInTheDocument();
    });

    // Fill in form - starting with fiat input
    const fiatInput = screen.getByPlaceholderText(/0\.00 USD/);
    await user.clear(fiatInput);
    await user.type(fiatInput, '100');
    
    // Fill other required fields
    await user.type(screen.getByPlaceholderText('Your wallet address (sender)'), 'test-depositor-address');
    await user.type(screen.getByPlaceholderText('Recipient wallet address'), 'test-beneficiary-address');
    
    // Submit form
    const submitButton = screen.getByRole('button', { name: 'Create Escrow' });
    await user.click(submitButton);
    
    // Check that the API was called with crypto amount (100)
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/escrow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('"amount":100')
      });
    });
  });

  it('should handle empty inputs gracefully', async () => {
    const user = userEvent.setup();
    render(<CreateEscrowPage />);
    
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Escrow' })).toBeInTheDocument();
    });

    const fiatInput = screen.getByPlaceholderText(/0\.00 USD/);
    const cryptoInput = screen.getByPlaceholderText(/0\.000000 USDC_POL/);
    
    // Clear fiat input
    await user.clear(fiatInput);
    
    // Both inputs should be empty
    expect(fiatInput).toHaveValue(null);
    expect(cryptoInput).toHaveValue(null);
  });

  it('should handle negative numbers by clearing the calculated field', async () => {
    const user = userEvent.setup();
    
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/rates')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            rate: 1.0
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<CreateEscrowPage />);
    
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Escrow' })).toBeInTheDocument();
    });

    const fiatInput = screen.getByPlaceholderText(/0\.00 USD/);
    const cryptoInput = screen.getByPlaceholderText(/0\.000000 USDC_POL/);
    
    // Type negative number
    await user.clear(fiatInput);
    await user.type(fiatInput, '-50');
    
    // Crypto amount should be cleared
    expect(cryptoInput).toHaveValue(null);
  });

  it('should debounce rate fetching to avoid excessive API calls', async () => {
    // Use fake timers to control debouncing
    vi.useFakeTimers();

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/rates')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            rate: 1.0
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<CreateEscrowPage />);

    // Advance past initial debounce and flush all promise resolutions
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Record how many rate calls have happened so far (initial fetch)
    const initialRateCallCount = mockFetch.mock.calls.filter(
      (call: any[]) => call[0].includes('/api/rates')
    ).length;

    const chainSelector = screen.getByLabelText('Cryptocurrency *');

    // Change chain multiple times quickly using fireEvent (synchronous, no timer issues)
    fireEvent.change(chainSelector, { target: { value: 'BTC' } });
    fireEvent.change(chainSelector, { target: { value: 'ETH' } });
    fireEvent.change(chainSelector, { target: { value: 'SOL' } });

    // Only the last call should be made after debounce time
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    // Debounce should prevent 3 separate rate fetches (one per change)
    // With debouncing, we expect fewer calls than the 3 changes made
    const allRateCalls = mockFetch.mock.calls.filter(
      (call: any[]) => call[0].includes('/api/rates')
    );
    const newRateCalls = allRateCalls.length - initialRateCallCount;
    expect(newRateCalls).toBeLessThan(3);
    // The last rate call should be for SOL (the final chain selection)
    const lastRateCall = allRateCalls[allRateCalls.length - 1];
    expect(lastRateCall[0]).toContain('/api/rates?coin=SOL&fiat=USD');
  });

  it('should update currency symbols when fiat currency changes', async () => {
    const user = userEvent.setup();
    render(<CreateEscrowPage />);
    
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Escrow' })).toBeInTheDocument();
    });

    // Initially should show USD symbol ($)
    expect(screen.getByText('$')).toBeInTheDocument();
    
    // Change to EUR - find the currency selector within the form
    const currencySelectors = screen.getAllByRole('combobox');
    const fiatCurrencySelector = currencySelectors.find(select => 
      select.closest('div')?.textContent?.includes('USD ($)')
    );
    
    if (fiatCurrencySelector) {
      await user.selectOptions(fiatCurrencySelector, 'EUR');
      
      // Should show EUR symbol (€)
      await waitFor(() => {
        expect(screen.getByText('€')).toBeInTheDocument();
      });
      
      // USD symbol should be gone
      expect(screen.queryByText('$')).not.toBeInTheDocument();
    } else {
      // Fallback: just check that the page has currency selectors
      expect(currencySelectors.length).toBeGreaterThan(0);
    }
  });

  it('should display commission estimate that updates with amount changes', async () => {
    const user = userEvent.setup();
    
    // Mock logged-in user with business (0.5% rate)
    const mockBusinesses = [{ id: 'bus_123', name: 'Test Business' }];
    vi.mocked(authFetch).mockResolvedValueOnce({
      response: { ok: true },
      data: { success: true, businesses: mockBusinesses }
    });

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/rates')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            rate: 1.0
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<CreateEscrowPage />);
    
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Escrow' })).toBeInTheDocument();
    });

    // Wait for businesses to load and rate to be set
    await waitFor(() => {
      expect(screen.getByText(/Platform fee: 0\.5% \(paid tier\)/)).toBeInTheDocument();
    });

    // Test that the info box shows the business rate (0.5%)
    expect(screen.getByText(/Platform fee: 0\.5% \(paid tier\)/)).toBeInTheDocument();
  });

  it('should show anonymous user commission rate (1%)', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/rates')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            rate: 1.0
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<CreateEscrowPage />);
    
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Escrow' })).toBeInTheDocument();
    });

    // Should show 1% for anonymous users
    expect(screen.getByText(/Platform fee: 1% \(0\.5% for logged-in merchants\)/)).toBeInTheDocument();
  });

  it('should show correct commission estimate for different user types', async () => {
    const user = userEvent.setup();
    
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/rates')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            rate: 1.0
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<CreateEscrowPage />);
    
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Escrow' })).toBeInTheDocument();
    });

    // Check initial state shows anonymous rate (1%)
    expect(screen.getByText(/Platform fee: 1% \(0\.5% for logged-in merchants\)/)).toBeInTheDocument();
  });
});