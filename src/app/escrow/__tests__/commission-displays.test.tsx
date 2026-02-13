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
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import components after mocks
import EscrowDashboardPage from '../page';
import CreateEscrowPage from '../create/page';
import { authFetch } from '@/lib/auth/client';

describe.skip('Escrow Commission Displays', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(navigator.clipboard.writeText).mockResolvedValue(undefined);
    
    // Mock auth fetch to return no businesses (not logged in)
    vi.mocked(authFetch).mockRejectedValue(new Error('Not logged in'));
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Escrow List Page - Commission Display', () => {
    const mockEscrowsWithCommission = {
      escrows: [
        {
          id: 'esc_123',
          depositor_address: '0xdepositor123',
          beneficiary_address: '0xbeneficiary456',
          escrow_address: '0xescrow789',
          chain: 'USDC_POL',
          amount: 100,
          amount_usd: 100,
          fee_amount: 1.0, // 1% commission
          deposited_amount: null,
          status: 'created',
          deposit_tx_hash: null,
          settlement_tx_hash: null,
          metadata: { description: 'Test escrow with commission' },
          dispute_reason: null,
          created_at: '2024-01-01T00:00:00Z',
          funded_at: null,
          settled_at: null,
          disputed_at: null,
          refunded_at: null,
          expires_at: '2024-01-02T00:00:00Z',
        },
        {
          id: 'esc_456',
          depositor_address: '0xdepositor789',
          beneficiary_address: '0xbeneficiary123',
          escrow_address: '0xescrow456',
          chain: 'BTC',
          amount: 0.1,
          amount_usd: 5000,
          fee_amount: 0.0005, // 0.5% commission
          deposited_amount: null,
          status: 'funded',
          deposit_tx_hash: null,
          settlement_tx_hash: null,
          metadata: {},
          dispute_reason: null,
          created_at: '2024-01-01T00:00:00Z',
          funded_at: '2024-01-01T01:00:00Z',
          settled_at: null,
          disputed_at: null,
          refunded_at: null,
          expires_at: '2024-01-02T00:00:00Z',
        }
      ],
      total: 2
    };

    it('should display commission percentage on escrow list items', async () => {
      // Mock authFetch to return escrows with commission
      vi.mocked(authFetch).mockResolvedValueOnce({
        response: { ok: true },
        data: mockEscrowsWithCommission
      });

      render(<EscrowDashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('100 USDC_POL')).toBeInTheDocument();
      });

      // Check first escrow commission display (1%)
      expect(screen.getByText('Commission: 1 USDC_POL (1.0%)')).toBeInTheDocument();
      
      // Check second escrow commission display (0.5%) 
      expect(screen.getByText('Commission: 0.0005 BTC (0.5%)')).toBeInTheDocument();
    });

    it('should not display commission for escrows with no fee', async () => {
      const escrowWithoutFee = {
        escrows: [{
          id: 'esc_no_fee',
          depositor_address: '0xdepositor',
          beneficiary_address: '0xbeneficiary',
          escrow_address: '0xescrow',
          chain: 'ETH',
          amount: 1.0,
          amount_usd: 3000,
          fee_amount: null,
          deposited_amount: null,
          status: 'created',
          deposit_tx_hash: null,
          settlement_tx_hash: null,
          metadata: {},
          dispute_reason: null,
          created_at: '2024-01-01T00:00:00Z',
          funded_at: null,
          settled_at: null,
          disputed_at: null,
          refunded_at: null,
          expires_at: '2024-01-02T00:00:00Z',
        }],
        total: 1
      };

      vi.mocked(authFetch).mockResolvedValueOnce({
        response: { ok: true },
        data: escrowWithoutFee
      });

      render(<EscrowDashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('1 ETH')).toBeInTheDocument();
      });

      // Should not show commission text
      expect(screen.queryByText(/Commission:/)).not.toBeInTheDocument();
    });

    it('should display commission in detail panel when escrow is selected', async () => {
      vi.mocked(authFetch).mockResolvedValueOnce({
        response: { ok: true },
        data: mockEscrowsWithCommission
      });

      // Mock events fetch
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/events')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ events: [] })
          });
        }
        return Promise.resolve({ ok: false });
      });

      render(<EscrowDashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('100 USDC_POL')).toBeInTheDocument();
      });

      // Click on the first escrow to select it
      const escrowButton = screen.getByText('100 USDC_POL').closest('button');
      if (escrowButton) {
        fireEvent.click(escrowButton);
      }

      // Wait for detail panel to load
      await waitFor(() => {
        expect(screen.getByText('Platform Commission')).toBeInTheDocument();
      });

      // Check commission details in detail panel
      expect(screen.getByText('1 USDC_POL (1.0%)')).toBeInTheDocument();
    });

    it('should show Manage Escrow link in header', () => {
      vi.mocked(authFetch).mockResolvedValueOnce({
        response: { ok: true },
        data: { escrows: [], total: 0 }
      });

      render(<EscrowDashboardPage />);

      const manageLink = screen.getByText('Manage Escrow');
      expect(manageLink).toBeInTheDocument();
      expect(manageLink.closest('a')).toHaveAttribute('href', '/escrow/manage');
    });
  });

  describe('Create Escrow Page - Live Commission Estimate', () => {
    beforeEach(() => {
      // Mock successful rates response
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
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true })
        });
      });
    });

    it('should display live commission estimate for anonymous users (1%)', async () => {
      render(<CreateEscrowPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Create Escrow' })).toBeInTheDocument();
      });

      // Check info box shows 1% fee for anonymous users
      expect(screen.getByText(/Platform fee: 1% \(0\.5% for logged-in merchants\)/)).toBeInTheDocument();
    });

    it('should display commission estimate for logged-in merchants (0.5%)', async () => {
      // Mock logged-in user with business
      const mockBusinesses = [{ id: 'bus_123', name: 'Test Business' }];
      vi.mocked(authFetch).mockResolvedValueOnce({
        response: { ok: true },
        data: { success: true, businesses: mockBusinesses }
      });

      render(<CreateEscrowPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Create Escrow' })).toBeInTheDocument();
      });

      // Check info box shows 0.5% for logged-in merchants
      expect(screen.getByText(/Platform fee: 0\.5% \(paid tier\)/)).toBeInTheDocument();
    });
  });

  describe('Create Escrow Success Page - Commission Display', () => {
    const mockSuccessfulEscrow = {
      id: 'esc_success_123',
      escrow_address: 'bc1qescrowaddress123456789',
      depositor_address: 'bc1qdepositor456',
      beneficiary_address: 'bc1qbeneficiary789',
      chain: 'BTC',
      amount: 1.0,
      amount_usd: 50000,
      fee_amount: 0.01, // 1% commission
      deposited_amount: null,
      status: 'created',
      release_token: 'release-token-abc123456789',
      beneficiary_token: 'beneficiary-token-def456789',
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString(),
      metadata: { description: 'Test escrow' },
      business_id: null,
    };

    it('should display prominent escrow ID with copy button', async () => {
      const user = userEvent.setup();

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/api/rates')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true, rate: 1.0 })
          });
        }
        if (url.includes('/api/escrow') && url.endsWith('/api/escrow')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockSuccessfulEscrow)
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
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
      await user.click(screen.getByRole('button', { name: 'Create Escrow' }));

      // Wait for success view
      await waitFor(() => {
        expect(screen.getByText('Escrow Created!')).toBeInTheDocument();
      });

      // Check prominent escrow ID display  
      expect(screen.getByText('esc_success_123')).toBeInTheDocument();
      
      // Check for copy functionality on escrow ID
      const copyButtons = screen.getAllByText('📋');
      expect(copyButtons.length).toBeGreaterThan(0);
    });

    it('should display commission in amber box with percentage and net amount', async () => {
      const user = userEvent.setup();

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/api/rates')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true, rate: 1.0 })
          });
        }
        if (url.includes('/api/escrow') && url.endsWith('/api/escrow')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockSuccessfulEscrow)
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
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
      await user.type(cryptoInput, '1.0');
      await user.clear(depositorInput);
      await user.type(depositorInput, 'bc1qdepositor456');
      await user.clear(beneficiaryInput);
      await user.type(beneficiaryInput, 'bc1qbeneficiary789');
      await user.click(screen.getByRole('button', { name: 'Create Escrow' }));

      await waitFor(() => {
        expect(screen.getByText('Escrow Created!')).toBeInTheDocument();
      });

      // Check commission display in amber box
      expect(screen.getByText('Platform Commission:')).toBeInTheDocument();
      expect(screen.getByText('0.01 BTC (1.0%)')).toBeInTheDocument();
      
      // Check beneficiary net amount display
      expect(screen.getByText(/Beneficiary will receive: 0\.990000 BTC/)).toBeInTheDocument();
    });

    it('should not display commission box when fee_amount is null or zero', async () => {
      const escrowNoCommission = {
        ...mockSuccessfulEscrow,
        fee_amount: null
      };

      const user = userEvent.setup();

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/api/rates')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true, rate: 1.0 })
          });
        }
        if (url.includes('/api/escrow') && url.endsWith('/api/escrow')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(escrowNoCommission)
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
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
      await user.type(cryptoInput, '1.0');
      await user.clear(depositorInput);
      await user.type(depositorInput, 'bc1qdepositor456');
      await user.clear(beneficiaryInput);
      await user.type(beneficiaryInput, 'bc1qbeneficiary789');
      await user.click(screen.getByRole('button', { name: 'Create Escrow' }));

      await waitFor(() => {
        expect(screen.getByText('Escrow Created!')).toBeInTheDocument();
      });

      // Should not show commission box
      expect(screen.queryByText('Platform Commission:')).not.toBeInTheDocument();
    });

    it('should show paid tier indicator for business escrows', async () => {
      const businessEscrow = {
        ...mockSuccessfulEscrow,
        fee_amount: 0.005, // 0.5% for business
        business_id: 'bus_123'
      };

      // Mock logged-in user with business
      const mockBusinesses = [{ id: 'bus_123', name: 'Test Business' }];
      vi.mocked(authFetch).mockResolvedValueOnce({
        response: { ok: true },
        data: { success: true, businesses: mockBusinesses }
      });

      const user = userEvent.setup();

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/api/rates')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true, rate: 1.0 })
          });
        }
        if (url.includes('/api/escrow') && url.endsWith('/api/escrow')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(businessEscrow)
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
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
      await user.type(cryptoInput, '1.0');
      await user.clear(depositorInput);
      await user.type(depositorInput, 'bc1qdepositor456');
      await user.clear(beneficiaryInput);
      await user.type(beneficiaryInput, 'bc1qbeneficiary789');
      await user.click(screen.getByRole('button', { name: 'Create Escrow' }));

      await waitFor(() => {
        expect(screen.getByText('Escrow Created!')).toBeInTheDocument();
      });

      // Check for paid tier indicator
      expect(screen.getByText('(paid tier rate)')).toBeInTheDocument();
    });
  });
});