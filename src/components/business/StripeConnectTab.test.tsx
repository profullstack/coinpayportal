import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { StripeConnectTab } from './StripeConnectTab';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
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
