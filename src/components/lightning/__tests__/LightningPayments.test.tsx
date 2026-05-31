import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LightningPayments } from '../LightningPayments';

const { mockListLightningPayments } = vi.hoisted(() => ({
  mockListLightningPayments: vi.fn(),
}));
vi.mock('@/components/web-wallet/WalletContext', () => ({
  useWebWallet: () => ({
    wallet: {
      walletId: 'w-1',
      listLightningPayments: (...args: unknown[]) => mockListLightningPayments(...args),
    },
  }),
}));

const mockPayments = [
  {
    id: 'p-1',
    offer_id: 'o-1',
    node_id: 'n-1',
    business_id: 'b-1',
    payment_hash: 'abc123def456abc123def456abc123de',
    preimage: null,
    amount_msat: 100000,
    direction: 'incoming',
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
    direction: 'incoming',
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
    mockListLightningPayments.mockReturnValue(new Promise(() => {}));
    render(<LightningPayments nodeId="n-1" walletId="w-1" />);
    // Pulse animation divs are rendered during loading
    const container = document.querySelector('.animate-pulse');
    expect(container).toBeTruthy();
  });

  it('should display payments on success', async () => {
    mockListLightningPayments.mockResolvedValue(mockPayments);

    render(<LightningPayments nodeId="n-1" walletId="w-1" />);

    await waitFor(() => {
      expect(screen.getByText('+100 sats')).toBeDefined();
      expect(screen.getByText('+50 sats')).toBeDefined();
    });
  });

  it('should display payer notes', async () => {
    mockListLightningPayments.mockResolvedValue(mockPayments);

    render(<LightningPayments nodeId="n-1" walletId="w-1" />);

    await waitFor(() => {
      expect(screen.getByText('Thanks for the coffee!')).toBeDefined();
    });
  });

  it('should show empty state when no payments', async () => {
    mockListLightningPayments.mockResolvedValue([]);

    render(<LightningPayments nodeId="n-1" walletId="w-1" />);

    await waitFor(() => {
      expect(screen.getByText('No Lightning payments yet')).toBeDefined();
    });
  });

  it('should show error state on failure', async () => {
    mockListLightningPayments.mockRejectedValue(new Error('Something went wrong'));

    render(<LightningPayments nodeId="n-1" walletId="w-1" />);

    await waitFor(() => {
      expect(screen.getByText('Something went wrong')).toBeDefined();
    });
  });

  it('should show error on network failure', async () => {
    mockListLightningPayments.mockRejectedValue(new Error('Network error'));

    render(<LightningPayments nodeId="n-1" walletId="w-1" />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeDefined();
    });
  });

  it('should load payments through the signed wallet SDK', async () => {
    mockListLightningPayments.mockResolvedValue([]);

    render(<LightningPayments nodeId="n-1" walletId="w-1" businessId="b-1" offerId="o-1" />);

    await waitFor(() => {
      expect(mockListLightningPayments).toHaveBeenCalledWith(20, {
        nodeId: 'n-1',
        businessId: 'b-1',
        offerId: 'o-1',
      });
    });
  });
});
