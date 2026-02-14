import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { StripeDisputesTab } from './StripeDisputesTab';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const mockAuthFetch = vi.fn();
vi.mock('@/lib/auth/client', () => ({
  authFetch: (...args: unknown[]) => mockAuthFetch(...args),
}));

describe('StripeDisputesTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows loading state', () => {
    mockAuthFetch.mockReturnValue(new Promise(() => {}));
    render(<StripeDisputesTab businessId="biz-1" />);
    expect(screen.getByText('Loading disputes...')).toBeTruthy();
  });

  it('shows empty state', async () => {
    mockAuthFetch.mockResolvedValue({ response: { ok: true }, data: { success: true, disputes: [] } });
    render(<StripeDisputesTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('No disputes.')).toBeTruthy();
    });
  });

  it('renders disputes table', async () => {
    mockAuthFetch.mockResolvedValue({
      response: { ok: true },
      data: {
        success: true,
        disputes: [{
          id: 'd-1',
          amount_cents: 2500,
          currency: 'usd',
          reason: 'fraudulent',
          status: 'needs_response',
          evidence_due_by: '2025-06-01T00:00:00Z',
        }],
      },
    });
    render(<StripeDisputesTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('$25.00')).toBeTruthy();
      expect(screen.getByText('fraudulent')).toBeTruthy();
      expect(screen.getByText('needs response')).toBeTruthy();
    });
  });

  it('handles null evidence_due_by', async () => {
    mockAuthFetch.mockResolvedValue({
      response: { ok: true },
      data: {
        success: true,
        disputes: [{
          id: 'd-2',
          amount_cents: 1000,
          currency: 'usd',
          reason: 'duplicate',
          status: 'won',
          evidence_due_by: null,
        }],
      },
    });
    render(<StripeDisputesTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('$10.00')).toBeTruthy();
      expect(screen.getByText('—')).toBeTruthy();
    });
  });
});
