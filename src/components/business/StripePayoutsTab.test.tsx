import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { StripePayoutsTab } from './StripePayoutsTab';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const mockAuthFetch = vi.fn();
vi.mock('@/lib/auth/client', () => ({
  authFetch: (...args: unknown[]) => mockAuthFetch(...args),
}));

describe('StripePayoutsTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows loading state', () => {
    mockAuthFetch.mockReturnValue(new Promise(() => {}));
    render(<StripePayoutsTab businessId="biz-1" />);
    expect(screen.getByText('Loading payouts...')).toBeTruthy();
  });

  it('shows empty state', async () => {
    mockAuthFetch.mockResolvedValue({ response: { ok: true }, data: { success: true, payouts: [] } });
    render(<StripePayoutsTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('No payouts yet.')).toBeTruthy();
    });
  });

  it('renders payouts table', async () => {
    mockAuthFetch.mockResolvedValue({
      response: { ok: true },
      data: {
        success: true,
        payouts: [{
          id: 'po-1',
          amount: 10000,
          currency: 'usd',
          status: 'paid',
          arrival_date: '2025-03-15T00:00:00Z',
        }],
      },
    });
    render(<StripePayoutsTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('$100.00')).toBeTruthy();
      expect(screen.getByText('paid')).toBeTruthy();
    });
  });

  it('handles null arrival_date', async () => {
    mockAuthFetch.mockResolvedValue({
      response: { ok: true },
      data: {
        success: true,
        payouts: [{
          id: 'po-2',
          amount: 5000,
          currency: 'usd',
          status: 'in_transit',
          arrival_date: null,
        }],
      },
    });
    render(<StripePayoutsTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('$50.00')).toBeTruthy();
      expect(screen.getByText('—')).toBeTruthy();
    });
  });
});
