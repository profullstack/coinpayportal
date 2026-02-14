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
      data: { success: true, transactions: [{ id: 'tx-1', stripe_charge_id: 'ch_abc', amount: 5000, currency: 'usd', status: 'succeeded', customer_email: 'a@b.com', created_at: '2025-01-01T00:00:00Z' }] },
    });
    render(<StripeTransactionsTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('a@b.com')).toBeTruthy();
    });
  });
});
