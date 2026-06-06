/**
 * @vitest-environment jsdom
 */

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

  it('tracks failed and expired payments in red', async () => {
    mockAuthFetch.mockResolvedValue({
      response: { ok: true },
      data: {
        success: true,
        payments: [
          {
            id: 'pay-ok',
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
          },
          {
            id: 'pay-failed',
            business_id: 'biz-1',
            business_name: 'Test Biz',
            amount_crypto: '0.002',
            amount_usd: '60.00',
            currency: 'ETH',
            status: 'failed',
            payment_address: '0xfailed',
            tx_hash: null,
            confirmations: 0,
            created_at: '2025-01-02T00:00:00Z',
            expires_at: null,
            fee_amount: null,
            merchant_amount: null,
          },
          {
            id: 'pay-expired',
            business_id: 'biz-1',
            business_name: 'Test Biz',
            amount_crypto: '0.003',
            amount_usd: '90.00',
            currency: 'SOL',
            status: 'expired',
            payment_address: 'SoExpired',
            tx_hash: null,
            confirmations: 0,
            created_at: '2025-01-03T00:00:00Z',
            expires_at: '2025-01-04T00:00:00Z',
            fee_amount: null,
            merchant_amount: null,
          },
        ],
      },
    });

    render(<CryptoTransactionsTab businessId="biz-1" />);

    await waitFor(() => {
      expect(screen.getByText('Failures')).toBeTruthy();
      expect(screen.getByText('2')).toBeTruthy();
      expect(screen.getByText('failed')).toHaveClass('text-red-700');
      expect(screen.getByText('expired')).toHaveClass('text-red-700');
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
