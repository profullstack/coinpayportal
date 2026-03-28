import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CryptoTransactionsTab } from './CryptoTransactionsTab';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const mockAuthFetch = vi.fn();
vi.mock('@/lib/auth/client', () => ({
  authFetch: (...args: unknown[]) => mockAuthFetch(...args),
}));

describe('CryptoTransactionsTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows empty state', async () => {
    mockAuthFetch.mockResolvedValue({ response: { ok: true }, data: { success: true, payments: [] } });
    render(<CryptoTransactionsTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('No crypto transactions yet.')).toBeTruthy();
    });
  });

  it('renders transactions', async () => {
    mockAuthFetch.mockResolvedValue({
      response: { ok: true },
      data: {
        success: true,
        payments: [{
          id: 'pay-1',
          business_id: 'biz-1',
          business_name: 'Test Biz',
          amount_crypto: '0.005',
          amount_usd: '150.00',
          currency: 'BTC',
          status: 'confirmed',
          payment_address: 'bc1qtest123',
          tx_hash: '0xabc123',
          confirmations: 3,
          created_at: '2025-01-01T00:00:00Z',
          expires_at: null,
          fee_amount: '1.50',
          merchant_amount: '148.50',
        }],
      },
    });
    render(<CryptoTransactionsTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('$150.00')).toBeTruthy();
      expect(screen.getByText('BTC')).toBeTruthy();
      expect(screen.getByText('0.005')).toBeTruthy();
      expect(screen.getByText('confirmed')).toBeTruthy();
    });
  });

  it('shows loading spinner initially', () => {
    mockAuthFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<CryptoTransactionsTab businessId="biz-1" />);
    expect(screen.getByText('Loading transactions...')).toBeTruthy();
  });

  it('shows export button when transactions exist', async () => {
    mockAuthFetch.mockResolvedValue({
      response: { ok: true },
      data: {
        success: true,
        payments: [{
          id: 'pay-1', business_id: 'biz-1', business_name: 'Test', amount_crypto: '1', amount_usd: '100',
          currency: 'ETH', status: 'confirmed', payment_address: '0x123', tx_hash: null,
          confirmations: 0, created_at: '2025-01-01T00:00:00Z', expires_at: null, fee_amount: null, merchant_amount: null,
        }],
      },
    });
    render(<CryptoTransactionsTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('Export CSV')).toBeTruthy();
    });
  });
});
