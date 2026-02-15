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
    // Default: not logged in, rate fetch returns a rate
    mockAuthFetch.mockResolvedValue(null);
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
      // First call: businesses check (not logged in → null)
      // Second call: escrow creation (success)
      mockAuthFetch
        .mockResolvedValueOnce(null) // businesses
        .mockResolvedValueOnce({ response: { ok: true }, data: escrowResponse });

      render(<CreateEscrowPage />);
      await waitFor(() => expect(screen.getByRole('button', { name: /create escrow/i })).toBeInTheDocument());

      fillFormAndSubmit();

      await waitFor(() => {
        expect(screen.getByText('Escrow Created!')).toBeInTheDocument();
      });

      // Escrow ID
      expect(screen.getByText('esc_abc123')).toBeInTheDocument();

      // Amount with chain
      expect(screen.getByText(/1\.5 USDC_POL/)).toBeInTheDocument();

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
    const seriesResponse = {
      id: 'series_xyz789',
      amount: 1.5,
      coin: 'USDC_POL',
      interval: 'monthly',
      max_periods: 12,
      status: 'active',
      payment_method: 'crypto',
      next_charge_at: '2026-03-15T20:00:00Z',
      currency: 'USD',
    };

    it('shows recurring confirmation with correct fields', async () => {
      mockAuthFetch
        .mockResolvedValueOnce(null) // businesses
        .mockResolvedValueOnce({ response: { ok: true }, data: seriesResponse });

      render(<CreateEscrowPage />);
      await waitFor(() => expect(screen.getByText(/create escrow/i)).toBeInTheDocument());

      // Enable recurring
      fireEvent.click(screen.getByLabelText(/make recurring/i));

      fillFormAndSubmit();

      await waitFor(() => {
        expect(screen.getByText('Recurring Escrow Series Created!')).toBeInTheDocument();
      });

      // Series ID
      expect(screen.getByText('series_xyz789')).toBeInTheDocument();

      // Amount with coin
      expect(screen.getByText(/1\.5 USDC_POL/)).toBeInTheDocument();

      // Interval
      expect(screen.getByText('monthly')).toBeInTheDocument();

      // Max periods
      expect(screen.getByText('12')).toBeInTheDocument();

      // Should NOT have release/beneficiary tokens
      expect(screen.queryByText('rel_token')).not.toBeInTheDocument();
      expect(screen.queryByText('ben_token')).not.toBeInTheDocument();

      // No "Invalid Date"
      const pageText = document.body.textContent || '';
      expect(pageText).not.toContain('Invalid Date');
    });
  });
});
