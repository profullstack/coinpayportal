/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { StripeConnectTab } from './StripeConnectTab';

// Stable refs so useCallback deps don't churn and re-fire load effects.
const mockRouter = { push: vi.fn() };
const stableSearchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => stableSearchParams,
}));

const mockAuthFetch = vi.fn();
vi.mock('@/lib/auth/client', () => ({
  authFetch: (...args: unknown[]) => mockAuthFetch(...args),
}));

describe('StripeConnectTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows loading state', () => {
    mockAuthFetch.mockReturnValue(new Promise(() => {}));
    render(<StripeConnectTab businessId="biz-1" />);
    expect(screen.getByText('Loading Stripe Connect...')).toBeTruthy();
  });

  it('shows connect button when not connected', async () => {
    mockAuthFetch.mockResolvedValue({ response: { ok: false }, data: { success: false } });
    render(<StripeConnectTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('Connect with Stripe')).toBeTruthy();
    });
  });

  it('disables Connect with Stripe until a country is chosen, then sends it', async () => {
    mockAuthFetch.mockImplementation(async (url: string) => {
      if (url.includes('/connect/status/')) return { response: { ok: false }, data: { success: false } };
      if (url.includes('/connect/onboard')) return { response: { ok: true }, data: { success: true, url: 'https://stripe.com/onboard' } };
      return { response: { ok: true }, data: { success: true } };
    });
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', { writable: true, value: { ...originalLocation, href: '' } });

    render(<StripeConnectTab businessId="biz-1" />);
    await waitFor(() => screen.getByText('Connect with Stripe'));
    expect((screen.getByText('Connect with Stripe') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByText('Select a country'));
    fireEvent.click(screen.getByRole('option', { name: /Germany/ }));

    expect((screen.getByText('Connect with Stripe') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByText('Connect with Stripe'));

    await waitFor(() => {
      expect(mockAuthFetch).toHaveBeenCalledWith(
        '/api/stripe/connect/onboard',
        expect.objectContaining({ body: expect.stringContaining('"country":"DE"') }),
        expect.anything()
      );
    });

    Object.defineProperty(window, 'location', { writable: true, value: originalLocation });
  });

  it('filters the country dropdown by query', async () => {
    mockAuthFetch.mockResolvedValue({ response: { ok: false }, data: { success: false } });
    render(<StripeConnectTab businessId="biz-1" />);
    await waitFor(() => screen.getByText('Connect with Stripe'));

    fireEvent.click(screen.getByText('Select a country'));
    fireEvent.change(screen.getByPlaceholderText('Filter countries…'), { target: { value: 'japan' } });

    expect(screen.getByRole('option', { name: /Japan/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /United States/ })).toBeNull();
  });

  it('shows account info when connected', async () => {
    mockAuthFetch.mockImplementation(async (url: string) => {
      if (url.includes('/connect/status/')) {
        return { response: { ok: true }, data: { success: true, account_id: 'acct_123', charges_enabled: true, payouts_enabled: true, details_submitted: true } };
      }
      return { response: { ok: true }, data: { success: true, balance: { available: [{ amount: 5000, currency: 'usd' }], pending: [] } } };
    });
    render(<StripeConnectTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('Charges Enabled')).toBeTruthy();
      expect(screen.getByText('$50.00')).toBeTruthy();
    });
  });
});
