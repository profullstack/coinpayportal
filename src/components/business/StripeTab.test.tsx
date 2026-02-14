import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { StripeTab } from './StripeTab';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Mock authFetch
const mockAuthFetch = vi.fn();
vi.mock('@/lib/auth/client', () => ({
  authFetch: (...args: unknown[]) => mockAuthFetch(...args),
}));

describe('StripeTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    mockAuthFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<StripeTab businessId="biz-1" />);
    expect(screen.getByText('Loading Stripe data...')).toBeTruthy();
  });

  it('shows connect button when not connected', async () => {
    mockAuthFetch.mockResolvedValue({
      response: { ok: false },
      data: { success: false },
    });

    render(<StripeTab businessId="biz-1" />);

    await waitFor(() => {
      expect(screen.getByText('Connect with Stripe')).toBeTruthy();
    });
  });

  it('shows account status when connected', async () => {
    let callCount = 0;
    mockAuthFetch.mockImplementation(async (url: string) => {
      if (url.includes('/connect/status/')) {
        return {
          response: { ok: true },
          data: {
            success: true,
            account_id: 'acct_123',
            charges_enabled: true,
            payouts_enabled: false,
            details_submitted: true,
          },
        };
      }
      // All other endpoints return empty
      return { response: { ok: true }, data: { success: true, transactions: [], disputes: [], payouts: [], escrows: [], balance: null } };
    });

    render(<StripeTab businessId="biz-1" />);

    await waitFor(() => {
      expect(screen.getByText('Charges Enabled')).toBeTruthy();
      expect(screen.getByText('Payouts Disabled')).toBeTruthy();
      expect(screen.getByText('Details Submitted')).toBeTruthy();
    });
  });

  it('renders transactions table when data exists', async () => {
    mockAuthFetch.mockImplementation(async (url: string) => {
      if (url.includes('/connect/status/')) {
        return { response: { ok: true }, data: { success: true, account_id: 'acct_1', charges_enabled: true, payouts_enabled: true, details_submitted: true } };
      }
      if (url.includes('/transactions')) {
        return {
          response: { ok: true },
          data: {
            success: true,
            transactions: [{
              id: 'tx-1', stripe_charge_id: 'ch_abc', amount: 5000, currency: 'usd',
              status: 'succeeded', customer_email: 'test@test.com', created_at: '2025-01-01T00:00:00Z',
            }],
          },
        };
      }
      return { response: { ok: true }, data: { success: true, disputes: [], payouts: [], escrows: [], balance: null } };
    });

    render(<StripeTab businessId="biz-1" />);

    await waitFor(() => {
      expect(screen.getByText('test@test.com')).toBeTruthy();
      expect(screen.getByText('ch_abc')).toBeTruthy();
    });
  });

  it('shows escrow action buttons for held escrows', async () => {
    mockAuthFetch.mockImplementation(async (url: string) => {
      if (url.includes('/connect/status/')) {
        return { response: { ok: true }, data: { success: true, account_id: 'acct_1', charges_enabled: true, payouts_enabled: true, details_submitted: true } };
      }
      if (url.includes('/escrows')) {
        return {
          response: { ok: true },
          data: {
            success: true,
            escrows: [{ id: 'esc-1', amount: 10000, currency: 'usd', status: 'held' }],
          },
        };
      }
      return { response: { ok: true }, data: { success: true, transactions: [], disputes: [], payouts: [], balance: null } };
    });

    render(<StripeTab businessId="biz-1" />);

    await waitFor(() => {
      expect(screen.getByText('Release')).toBeTruthy();
      expect(screen.getByText('Refund')).toBeTruthy();
    });
  });

  it('calls onboard endpoint when connect button clicked', async () => {
    mockAuthFetch.mockImplementation(async (url: string, opts?: any) => {
      if (url.includes('/connect/status/')) {
        return { response: { ok: false }, data: { success: false } };
      }
      if (url.includes('/connect/onboard')) {
        return { response: { ok: true }, data: { success: true, url: 'https://stripe.com/onboard' } };
      }
      return { response: { ok: true }, data: { success: true } };
    });

    // Mock window.location
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', { writable: true, value: { ...originalLocation, href: '' } });

    render(<StripeTab businessId="biz-1" />);

    await waitFor(() => {
      expect(screen.getByText('Connect with Stripe')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Connect with Stripe'));

    await waitFor(() => {
      expect(mockAuthFetch).toHaveBeenCalledWith(
        '/api/stripe/connect/onboard',
        expect.objectContaining({ method: 'POST' }),
        expect.anything()
      );
    });

    Object.defineProperty(window, 'location', { writable: true, value: originalLocation });
  });
});
