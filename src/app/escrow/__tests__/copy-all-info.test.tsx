import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => null,
}));

// Mock auth fetch
vi.mock('@/lib/auth/client', () => ({
  authFetch: vi.fn().mockResolvedValue({
    response: { ok: true },
    data: { escrows: [], total: 0, success: true },
  }),
}));

global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

import EscrowDashboardPage from '../page';

describe('EscrowDashboardPage - Copy All Info', () => {
  let mockClipboard: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClipboard = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: mockClipboard },
    });
  });

  it('shows Copy All Info button when an escrow is selected', async () => {
    const { authFetch } = await import('@/lib/auth/client');
    (authFetch as any).mockResolvedValue({
      response: { ok: true },
      data: {
        escrows: [{
          id: 'esc_test123',
          depositor_address: '0xabc',
          beneficiary_address: '0xdef',
          escrow_address: '0xescrow',
          chain: 'USDC_POL',
          amount: 100,
          amount_usd: 100,
          fee_amount: 1,
          deposited_amount: null,
          status: 'created',
          deposit_tx_hash: null,
          settlement_tx_hash: null,
          metadata: {},
          dispute_reason: null,
          created_at: '2025-01-01T00:00:00Z',
          funded_at: null,
          settled_at: null,
          expires_at: '2025-01-08T00:00:00Z',
        }],
        total: 1,
        success: true,
      },
    });

    render(<EscrowDashboardPage />);

    // Wait for escrows to load
    await waitFor(() => {
      expect(screen.getByText(/esc_test/)).toBeInTheDocument();
    });

    // Click on the escrow to select it
    fireEvent.click(screen.getByText(/esc_test/));

    // Should show Copy All Info button
    await waitFor(() => {
      expect(screen.getByText(/copy all info/i)).toBeInTheDocument();
    });
  });

  it('copies escrow info to clipboard when clicked', async () => {
    const { authFetch } = await import('@/lib/auth/client');
    (authFetch as any).mockResolvedValue({
      response: { ok: true },
      data: {
        escrows: [{
          id: 'esc_test123',
          depositor_address: '0xabc',
          beneficiary_address: '0xdef',
          escrow_address: '0xescrow',
          chain: 'USDC_POL',
          amount: 100,
          amount_usd: 100,
          fee_amount: 1,
          deposited_amount: null,
          status: 'created',
          deposit_tx_hash: null,
          settlement_tx_hash: null,
          metadata: {},
          dispute_reason: null,
          created_at: '2025-01-01T00:00:00Z',
          funded_at: null,
          settled_at: null,
          expires_at: '2025-01-08T00:00:00Z',
        }],
        total: 1,
        success: true,
      },
    });

    render(<EscrowDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText(/esc_test/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/esc_test/));

    await waitFor(() => {
      expect(screen.getByText(/copy all info/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/copy all info/i));

    await waitFor(() => {
      expect(mockClipboard).toHaveBeenCalledWith(
        expect.stringContaining('Escrow ID: esc_test123')
      );
    });
  });
});
