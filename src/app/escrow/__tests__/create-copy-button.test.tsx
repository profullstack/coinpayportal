import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn(),
  },
});

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import component after mocks
import CreateEscrowPage from '../create/page';
import { authFetch } from '@/lib/auth/client';

describe('CreateEscrowPage - Copy Button Feature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    
    // Mock auth fetch to return no businesses (not logged in)
    vi.mocked(authFetch).mockRejectedValue(new Error('Not logged in'));
    
    // Mock rates API response
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
    
    // Mock clipboard API
    vi.mocked(navigator.clipboard.writeText).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('should render copy button next to deposit amount in success view', async () => {
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
      if (url.includes('/api/escrow') && url.endsWith('/api/escrow')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            id: 'escrow-123',
            escrow_address: 'bc1qescrowaddress123',
            depositor_address: 'bc1qdepositor456',
            beneficiary_address: 'bc1qbeneficiary789',
            chain: 'BTC',
            amount: 0.5,
            amount_usd: 25000,
            fee_amount: 0.005,
            deposited_amount: null,
            status: 'pending',
            release_token: 'release-token-abc123',
            beneficiary_token: 'beneficiary-token-def456',
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            created_at: new Date().toISOString(),
            metadata: { description: 'Test escrow' },
            business_id: null,
          })
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      });
    });

    render(<CreateEscrowPage />);
    
    // Wait for component to load
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Escrow' })).toBeInTheDocument();
    });

    // Fill out the form
    const cryptoInput = screen.getByPlaceholderText(/0\.000000 USDC_POL/);
    const depositorInput = screen.getByPlaceholderText('Your wallet address (sender)');
    const beneficiaryInput = screen.getByPlaceholderText('Recipient wallet address');
    
    // Switch to crypto primary input
    const toggleButton = screen.getByTitle('Switch primary input');
    await user.click(toggleButton);
    
    await user.clear(cryptoInput);
    await user.type(cryptoInput, '0.5');
    await user.clear(depositorInput);
    await user.type(depositorInput, 'bc1qdepositor456');
    await user.clear(beneficiaryInput);
    await user.type(beneficiaryInput, 'bc1qbeneficiary789');
    
    // Submit the form
    const submitButton = screen.getByText('Create Escrow');
    await user.click(submitButton);
    
    // Wait for success view to appear
    await waitFor(() => {
      expect(screen.getByText('Escrow Created!')).toBeInTheDocument();
    });

    // Check that the deposit amount text and copy button are present
    expect(screen.getByText(/Send exactly/)).toBeInTheDocument();
    expect(screen.getByText('0.5 USDC_POL')).toBeInTheDocument();
    
    // Find the copy button next to the amount
    const copyButton = screen.getByTitle('Copy amount');
    expect(copyButton).toBeInTheDocument();
    expect(copyButton).toHaveTextContent('📋');
  });

  it('should copy amount to clipboard when copy button is clicked', async () => {
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
      if (url.includes('/api/escrow') && url.endsWith('/api/escrow')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            id: 'escrow-123',
            escrow_address: 'bc1qescrowaddress123',
            depositor_address: 'bc1qdepositor456',
            beneficiary_address: 'bc1qbeneficiary789',
            chain: 'BTC',
            amount: 1.25,
            amount_usd: 62500,
            fee_amount: 0.0125,
            deposited_amount: null,
            status: 'pending',
            release_token: 'release-token-abc123',
            beneficiary_token: 'beneficiary-token-def456',
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            created_at: new Date().toISOString(),
            metadata: { description: 'Test escrow' },
            business_id: null,
          })
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      });
    });

    render(<CreateEscrowPage />);
    
    // Wait for component to load
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Escrow' })).toBeInTheDocument();
    });

    // Fill out and submit form quickly
    const cryptoInput = screen.getByPlaceholderText(/0\.000000 USDC_POL/);
    const depositorInput = screen.getByPlaceholderText('Your wallet address (sender)');
    const beneficiaryInput = screen.getByPlaceholderText('Recipient wallet address');
    const toggleButton = screen.getByTitle('Switch primary input');
    
    await user.click(toggleButton);
    await user.clear(cryptoInput);
    await user.type(cryptoInput, '1.25');
    await user.clear(depositorInput);
    await user.type(depositorInput, 'bc1qdepositor456');
    await user.clear(beneficiaryInput);
    await user.type(beneficiaryInput, 'bc1qbeneficiary789');
    await user.click(screen.getByText('Create Escrow'));
    
    // Wait for success view
    await waitFor(() => {
      expect(screen.getByText('Escrow Created!')).toBeInTheDocument();
    });

    // Click the copy button
    const copyButton = screen.getByTitle('Copy amount');
    await user.click(copyButton);
    
    // Verify clipboard was called with just the amount (no currency)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('1.25');
    
    // Verify the button shows copied state
    expect(copyButton).toHaveTextContent('✓');
  });

  it('should reset copy button state after timeout', async () => {
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
      if (url.includes('/api/escrow') && url.endsWith('/api/escrow')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            id: 'escrow-123',
            escrow_address: 'bc1qescrowaddress123',
            depositor_address: 'bc1qdepositor456',
            beneficiary_address: 'bc1qbeneficiary789',
            chain: 'SOL',
            amount: 2.0,
            amount_usd: null,
            fee_amount: null,
            deposited_amount: null,
            status: 'pending',
            release_token: 'release-token-abc123',
            beneficiary_token: 'beneficiary-token-def456',
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            created_at: new Date().toISOString(),
            metadata: {},
            business_id: null,
          })
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      });
    });

    render(<CreateEscrowPage />);
    
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Escrow' })).toBeInTheDocument();
    });

    // Fill out form and navigate to success
    const cryptoInput = screen.getByPlaceholderText(/0\.000000 USDC_POL/);
    const depositorInput = screen.getByPlaceholderText('Your wallet address (sender)');
    const beneficiaryInput = screen.getByPlaceholderText('Recipient wallet address');
    const toggleButton = screen.getByTitle('Switch primary input');
    
    await user.click(toggleButton);
    await user.clear(cryptoInput);
    await user.type(cryptoInput, '2.0');
    await user.clear(depositorInput);
    await user.type(depositorInput, 'sol_depositor_address');
    await user.clear(beneficiaryInput);
    await user.type(beneficiaryInput, 'sol_beneficiary_address');
    await user.click(screen.getByText('Create Escrow'));
    
    await waitFor(() => {
      expect(screen.getByText('Escrow Created!')).toBeInTheDocument();
    });

    // Click copy button
    const copyButton = screen.getByTitle('Copy amount');
    await user.click(copyButton);
    
    // Verify copied state
    expect(copyButton).toHaveTextContent('✓');
    
    // Fast-forward time by 2 seconds
    vi.advanceTimersByTime(2000);
    
    // Verify button reset to original state
    await waitFor(() => {
      expect(copyButton).toHaveTextContent('📋');
    });
  });

  it('should copy decimal amounts correctly', async () => {
    const user = userEvent.setup();
    
    // Mock successful escrow creation with decimal amount
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
      if (url.includes('/api/escrow') && url.endsWith('/api/escrow')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            id: 'escrow-123',
            escrow_address: 'bc1qescrowaddress123',
            depositor_address: 'bc1qdepositor456',
            beneficiary_address: 'bc1qbeneficiary789',
            chain: 'BTC',
            amount: 0.00125, // Small decimal amount
            amount_usd: 62.5,
            fee_amount: 0.0000125,
            deposited_amount: null,
            status: 'pending',
            release_token: 'release-token-abc123',
            beneficiary_token: 'beneficiary-token-def456',
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            created_at: new Date().toISOString(),
            metadata: {},
            business_id: null,
          })
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      });
    });

    render(<CreateEscrowPage />);
    
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Escrow' })).toBeInTheDocument();
    });

    // Fill out form
    const cryptoInput = screen.getByPlaceholderText(/0\.000000 USDC_POL/);
    const depositorInput = screen.getByPlaceholderText('Your wallet address (sender)');
    const beneficiaryInput = screen.getByPlaceholderText('Recipient wallet address');
    const toggleButton = screen.getByTitle('Switch primary input');
    
    await user.click(toggleButton);
    await user.clear(cryptoInput);
    await user.type(cryptoInput, '0.00125');
    await user.clear(depositorInput);
    await user.type(depositorInput, 'bc1qdepositor456');
    await user.clear(beneficiaryInput);
    await user.type(beneficiaryInput, 'bc1qbeneficiary789');
    await user.click(screen.getByText('Create Escrow'));
    
    await waitFor(() => {
      expect(screen.getByText('Escrow Created!')).toBeInTheDocument();
    });

    // Click copy button
    const copyButton = screen.getByTitle('Copy amount');
    await user.click(copyButton);
    
    // Verify exact decimal amount was copied
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('0.00125');
  });

  it('should show copy button alongside existing copy buttons', async () => {
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
      if (url.includes('/api/escrow') && url.endsWith('/api/escrow')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            id: 'escrow-123',
            escrow_address: 'bc1qescrowaddress123456789',
            depositor_address: 'bc1qdepositor456',
            beneficiary_address: 'bc1qbeneficiary789',
            chain: 'ETH',
            amount: 1.0,
            amount_usd: 2500,
            fee_amount: 0.01,
            deposited_amount: null,
            status: 'pending',
            release_token: 'release-token-abc123456789',
            beneficiary_token: 'beneficiary-token-def456789',
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            created_at: new Date().toISOString(),
            metadata: {},
            business_id: null,
          })
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      });
    });

    render(<CreateEscrowPage />);
    
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Escrow' })).toBeInTheDocument();
    });

    // Fill and submit form
    const cryptoInput = screen.getByPlaceholderText(/0\.000000 USDC_POL/);
    const depositorInput = screen.getByPlaceholderText('Your wallet address (sender)');
    const beneficiaryInput = screen.getByPlaceholderText('Recipient wallet address');
    const toggleButton = screen.getByTitle('Switch primary input');
    
    await user.click(toggleButton);
    await user.clear(cryptoInput);
    await user.type(cryptoInput, '1.0');
    await user.clear(depositorInput);
    await user.type(depositorInput, 'bc1qdepositor456');
    await user.clear(beneficiaryInput);
    await user.type(beneficiaryInput, 'bc1qbeneficiary789');
    await user.click(screen.getByText('Create Escrow'));
    
    await waitFor(() => {
      expect(screen.getByText('Escrow Created!')).toBeInTheDocument();
    });

    // Verify multiple copy buttons exist
    const copyButtons = screen.getAllByText('📋');
    expect(copyButtons.length).toBeGreaterThanOrEqual(3); // Address, tokens, and amount
    
    // Verify our specific amount copy button exists
    const amountCopyButton = screen.getByTitle('Copy amount');
    expect(amountCopyButton).toBeInTheDocument();
    
    // Verify address copy button exists
    expect(screen.getAllByText('📋').length).toBeGreaterThan(1);
  });

  it('should handle clipboard API failure gracefully', async () => {
    const user = userEvent.setup();
    
    // Mock clipboard failure
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('Clipboard access denied'));
    
    // Spy on console.error to verify error is logged
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
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
      if (url.includes('/api/escrow') && url.endsWith('/api/escrow')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            id: 'escrow-123',
            escrow_address: 'bc1qescrowaddress123',
            depositor_address: 'bc1qdepositor456',
            beneficiary_address: 'bc1qbeneficiary789',
            chain: 'BTC',
            amount: 0.5,
            amount_usd: 25000,
            fee_amount: 0.005,
            deposited_amount: null,
            status: 'pending',
            release_token: 'release-token-abc123',
            beneficiary_token: 'beneficiary-token-def456',
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            created_at: new Date().toISOString(),
            metadata: {},
            business_id: null,
          })
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      });
    });

    render(<CreateEscrowPage />);
    
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Escrow' })).toBeInTheDocument();
    });

    // Submit form
    const cryptoInput = screen.getByPlaceholderText(/0\.000000 USDC_POL/);
    const depositorInput = screen.getByPlaceholderText('Your wallet address (sender)');
    const beneficiaryInput = screen.getByPlaceholderText('Recipient wallet address');
    const toggleButton = screen.getByTitle('Switch primary input');
    
    await user.click(toggleButton);
    await user.clear(cryptoInput);
    await user.type(cryptoInput, '0.5');
    await user.clear(depositorInput);
    await user.type(depositorInput, 'bc1qdepositor456');
    await user.clear(beneficiaryInput);
    await user.type(beneficiaryInput, 'bc1qbeneficiary789');
    await user.click(screen.getByText('Create Escrow'));
    
    await waitFor(() => {
      expect(screen.getByText('Escrow Created!')).toBeInTheDocument();
    });

    const copyButton = screen.getByTitle('Copy amount');
    await user.click(copyButton);
    
    // Verify error was logged but UI doesn't crash
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to copy:', expect.any(Error));
    });
    
    // Button should still exist and be clickable
    expect(copyButton).toBeInTheDocument();
    
    consoleSpy.mockRestore();
  });
});