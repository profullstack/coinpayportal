import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LightningPayments } from '../LightningPayments';

const mockPayments = [
  {
    id: 'p-1',
    offer_id: 'o-1',
    node_id: 'n-1',
    business_id: 'b-1',
    payment_hash: 'abc123def456abc123def456abc123de',
    preimage: null,
    amount_msat: 100000,
    status: 'settled',
    payer_note: 'Thanks for the coffee!',
    settled_at: '2026-02-14T12:00:00Z',
    created_at: '2026-02-14T11:59:00Z',
  },
  {
    id: 'p-2',
    offer_id: 'o-1',
    node_id: 'n-1',
    business_id: 'b-1',
    payment_hash: 'def789abc012def789abc012def789ab',
    preimage: null,
    amount_msat: 50000,
    status: 'pending',
    payer_note: null,
    settled_at: null,
    created_at: '2026-02-14T12:05:00Z',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LightningPayments', () => {
  it('should show loading state initially', () => {
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<LightningPayments nodeId="n-1" />);
    // Pulse animation divs are rendered during loading
    const container = document.querySelector('.animate-pulse');
    expect(container).toBeTruthy();
  });

  it('should display payments on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, data: { payments: mockPayments } }),
    });

    render(<LightningPayments nodeId="n-1" />);

    await waitFor(() => {
      expect(screen.getByText('Lightning Payments')).toBeDefined();
      expect(screen.getByText('100 sats')).toBeDefined();
      expect(screen.getByText('50 sats')).toBeDefined();
    });
  });

  it('should display payer notes', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, data: { payments: mockPayments } }),
    });

    render(<LightningPayments nodeId="n-1" />);

    await waitFor(() => {
      expect(screen.getByText('Thanks for the coffee!')).toBeDefined();
    });
  });

  it('should show empty state when no payments', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, data: { payments: [] } }),
    });

    render(<LightningPayments nodeId="n-1" />);

    await waitFor(() => {
      expect(screen.getByText('No Lightning payments yet')).toBeDefined();
    });
  });

  it('should show error state on failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          success: false,
          error: { message: 'Something went wrong' },
        }),
    });

    render(<LightningPayments nodeId="n-1" />);

    await waitFor(() => {
      expect(screen.getByText('Something went wrong')).toBeDefined();
    });
  });

  it('should show error on network failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    render(<LightningPayments nodeId="n-1" />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeDefined();
    });
  });

  it('should pass query params for filtering', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, data: { payments: [] } }),
    });

    render(<LightningPayments nodeId="n-1" businessId="b-1" offerId="o-1" />);

    await waitFor(() => {
      const url = (global.fetch as any).mock.calls[0][0];
      expect(url).toContain('node_id=n-1');
      expect(url).toContain('business_id=b-1');
      expect(url).toContain('offer_id=o-1');
    });
  });
});
