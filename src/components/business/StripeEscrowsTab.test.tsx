import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { StripeEscrowsTab } from './StripeEscrowsTab';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const mockAuthFetch = vi.fn();
vi.mock('@/lib/auth/client', () => ({
  authFetch: (...args: unknown[]) => mockAuthFetch(...args),
}));

describe('StripeEscrowsTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows loading state', () => {
    mockAuthFetch.mockReturnValue(new Promise(() => {}));
    render(<StripeEscrowsTab businessId="biz-1" />);
    expect(screen.getByText('Loading escrows...')).toBeTruthy();
  });

  it('shows empty state', async () => {
    mockAuthFetch.mockResolvedValue({ response: { ok: true }, data: { success: true, escrows: [] } });
    render(<StripeEscrowsTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('No escrows.')).toBeTruthy();
    });
  });

  it('renders escrows with action buttons for held status', async () => {
    mockAuthFetch.mockResolvedValue({
      response: { ok: true },
      data: {
        success: true,
        escrows: [{ id: 'esc-1', amount: 10000, currency: 'usd', status: 'held' }],
      },
    });
    render(<StripeEscrowsTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('$100.00')).toBeTruthy();
      expect(screen.getByText('Release')).toBeTruthy();
      expect(screen.getByText('Refund')).toBeTruthy();
    });
  });

  it('does not show action buttons for released escrows', async () => {
    mockAuthFetch.mockResolvedValue({
      response: { ok: true },
      data: {
        success: true,
        escrows: [{ id: 'esc-2', amount: 5000, currency: 'usd', status: 'released' }],
      },
    });
    render(<StripeEscrowsTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('$50.00')).toBeTruthy();
      expect(screen.queryByText('Release')).toBeNull();
    });
  });

  it('calls release endpoint when Release clicked', async () => {
    const heldEscrow = { id: 'esc-1', amount: 10000, currency: 'usd', status: 'held' };
    mockAuthFetch.mockImplementation(async (url: string, opts?: any) => {
      if (opts?.method === 'POST') {
        return { response: { ok: true }, data: { success: true } };
      }
      return { response: { ok: true }, data: { success: true, escrows: [heldEscrow] } };
    });

    render(<StripeEscrowsTab businessId="biz-1" />);
    await waitFor(() => screen.getByText('Release'));
    fireEvent.click(screen.getByText('Release'));

    await waitFor(() => {
      expect(mockAuthFetch).toHaveBeenCalledWith(
        '/api/stripe/escrow/release',
        expect.objectContaining({ method: 'POST' }),
        expect.anything()
      );
    });
  });

  it('shows error on failed action', async () => {
    let callCount = 0;
    mockAuthFetch.mockImplementation(async (url: string) => {
      callCount++;
      if (url.includes('/escrow/release')) {
        return { response: { ok: false }, data: { success: false, error: 'Insufficient funds' } };
      }
      return {
        response: { ok: true },
        data: { success: true, escrows: [{ id: 'esc-1', amount: 10000, currency: 'usd', status: 'held' }] },
      };
    });

    render(<StripeEscrowsTab businessId="biz-1" />);
    await waitFor(() => screen.getByText('Release'));
    fireEvent.click(screen.getByText('Release'));

    await waitFor(() => {
      expect(screen.getByText('Insufficient funds')).toBeTruthy();
    });
  });
});
