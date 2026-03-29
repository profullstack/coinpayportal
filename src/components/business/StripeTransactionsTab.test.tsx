import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { StripeTransactionsTab } from './StripeTransactionsTab';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const mockAuthFetch = vi.fn();
vi.mock('@/lib/auth/client', () => ({
  authFetch: (...args: unknown[]) => mockAuthFetch(...args),
}));

describe('StripeTransactionsTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows empty state', async () => {
    mockAuthFetch.mockResolvedValue({ response: { ok: true }, data: { success: true, transactions: [] } });
    render(<StripeTransactionsTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('No transactions yet.')).toBeTruthy();
    });
  });

  it('renders transactions', async () => {
    mockAuthFetch.mockResolvedValue({
      response: { ok: true },
      data: {
        success: true,
        transactions: [{
          id: 'tx-1',
          stripe_charge_id: 'ch_abc',
          stripe_payment_intent_id: null,
          amount_cents: 5000,
          amount_usd: '50.00',
          currency: 'usd',
          status: 'succeeded',
          platform_fee_amount: 50,
          stripe_fee_amount: 145,
          net_to_merchant: 4805,
          business_name: 'Test Business',
          merchant_email: 'a@b.com',
          connected_account_email: null,
          created_at: '2025-01-01T00:00:00Z',
        }],
      },
    });
    render(<StripeTransactionsTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('a@b.com')).toBeTruthy();
    });
  });
});
