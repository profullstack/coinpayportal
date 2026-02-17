import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

// Mock authFetch
const mockAuthFetch = vi.fn();
vi.mock('@/lib/auth/client', () => ({
  authFetch: (...args: any[]) => mockAuthFetch(...args),
}));

// Mock global fetch (rate API)
const mockFetch = vi.fn();
global.fetch = mockFetch;

import CreateEscrowPage from '../create/page';

describe('Escrow Confirmation Screens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: not logged in
    mockAuthFetch.mockResolvedValue(null);
    // Rate API mock (default for all fetch calls)
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, rate: 50000 }),
    });
  });

  function fillFormAndSubmit() {
    // Switch to crypto primary so we can type directly
    const toggleBtn = screen.getByTitle('Switch primary input');
    fireEvent.click(toggleBtn);

    // Fill required fields
    const cryptoInputs = screen.getAllByRole('spinbutton');
    const cryptoInput = cryptoInputs.find(i => !(i as HTMLInputElement).disabled && (i as HTMLInputElement).step === 'any');
    if (cryptoInput) fireEvent.change(cryptoInput, { target: { value: '1.5' } });

    fireEvent.change(screen.getByPlaceholderText(/your wallet address/i), {
      target: { value: '0xDepositor123' },
    });
    fireEvent.change(screen.getByPlaceholderText(/recipient wallet/i), {
      target: { value: '0xBeneficiary456' },
    });

    fireEvent.click(screen.getByRole('button', { name: /create escrow/i }));
  }

  describe('Single escrow confirmation', () => {
    const escrowResponse = {
      id: 'esc_abc123',
      escrow_address: '0xEscrowAddr789',
      chain: 'USDC_POL',
      amount: 1.5,
      release_token: 'rel_token_xyz',
      beneficiary_token: 'ben_token_abc',
      expires_at: '2026-03-15T20:00:00Z',
      status: 'pending_deposit',
      depositor_address: '0xDepositor123',
      beneficiary_address: '0xBeneficiary456',
      amount_usd: null,
      fee_amount: null,
      deposited_amount: null,
      created_at: '2026-02-15T20:00:00Z',
      metadata: {},
      business_id: null,
    };

    it('shows confirmation with all expected fields', async () => {
      // authFetch: businesses (null=not logged in), then escrow create (null=fallback to fetch)
      mockAuthFetch.mockResolvedValue(null);
      // global fetch: rate API calls, then escrow creation fallback
      mockFetch.mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/api/escrow')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(escrowResponse),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, rate: 50000 }),
        });
      });

      render(<CreateEscrowPage />);
      await waitFor(() => expect(screen.getByRole('button', { name: /create escrow/i })).toBeInTheDocument());

      fillFormAndSubmit();

      await waitFor(() => {
        expect(screen.getByText('Escrow Created!')).toBeInTheDocument();
      });

      // Escrow ID
      expect(screen.getByText('esc_abc123')).toBeInTheDocument();

      // Amount with chain (appears in multiple places on confirmation)
      expect(screen.getAllByText(/1\.5 USDC_POL/).length).toBeGreaterThan(0);

      // Tokens
      expect(screen.getByText('rel_token_xyz')).toBeInTheDocument();
      expect(screen.getByText('ben_token_abc')).toBeInTheDocument();

      // Deposit address
      expect(screen.getByText('0xEscrowAddr789')).toBeInTheDocument();

      // Depositor / beneficiary
      expect(screen.getByText('0xDepositor123')).toBeInTheDocument();
      expect(screen.getByText('0xBeneficiary456')).toBeInTheDocument();

      // Valid expiry (not "Invalid Date")
      const expiryText = screen.getByText(/expires/i)?.parentElement?.textContent || '';
      expect(expiryText).not.toContain('Invalid Date');
    });
  });

  describe('Recurring series confirmation', () => {
    const escrowInSeries = {
      id: 'esc_series_001',
      escrow_address: '0xSeriesEscrowAddr',
      chain: 'USDC_POL',
      amount: 1.5,
      release_token: 'rel_series_token',
      beneficiary_token: 'ben_series_token',
      expires_at: '2026-04-15T20:00:00Z',
      status: 'pending',
      depositor_address: '0xDepositor123',
      beneficiary_address: '0xBeneficiary456',
      amount_usd: null,
      fee_amount: null,
      deposited_amount: null,
      created_at: '2026-02-15T20:00:00Z',
      metadata: {},
      business_id: null,
    };

    const seriesResponse = {
      series: {
        id: 'series_xyz789',
        amount: 1.5,
        coin: 'USDC_POL',
        interval: 'monthly',
        max_periods: 12,
        status: 'active',
        payment_method: 'crypto',
        next_charge_at: '2026-03-15T20:00:00Z',
        currency: 'USD',
      },
      escrow: escrowInSeries,
    };

    it('shows recurring confirmation with deposit address and tokens (same as single escrow)', async () => {
      // authFetch: businesses (null), then series create (null=fallback to fetch)
      mockAuthFetch.mockResolvedValue(null);
      // global fetch: rate API calls, wallet lookup, then series creation fallback
      mockFetch.mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/api/escrow/series')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(seriesResponse),
          });
        }
        if (typeof url === 'string' && url.includes('/api/wallets/lookup')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ found: false }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, rate: 50000 }),
        });
      });

      render(<CreateEscrowPage />);
      await waitFor(() => expect(screen.getByRole('button', { name: /create escrow/i })).toBeInTheDocument());

      // Enable recurring
      fireEvent.click(screen.getByLabelText(/make recurring/i));

      fillFormAndSubmit();

      await waitFor(() => {
        expect(screen.getByText('Recurring Escrow Created!')).toBeInTheDocument();
      });

      // Recurring series banner with series ID
      expect(screen.getByText('series_xyz789')).toBeInTheDocument();
      expect(screen.getByText(/monthly/i)).toBeInTheDocument();

      // Deposit address (same UI as single escrow)
      expect(screen.getByText('0xSeriesEscrowAddr')).toBeInTheDocument();

      // Tokens shown (critical for funding)
      expect(screen.getByText('rel_series_token')).toBeInTheDocument();
      expect(screen.getByText('ben_series_token')).toBeInTheDocument();

      // Escrow ID
      expect(screen.getByText('esc_series_001')).toBeInTheDocument();

      // No "Invalid Date"
      const pageText = document.body.textContent || '';
      expect(pageText).not.toContain('Invalid Date');
    });
  });
});
