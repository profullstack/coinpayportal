import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CryptoPayoutsTab } from './CryptoPayoutsTab';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const mockAuthFetch = vi.fn();
vi.mock('@/lib/auth/client', () => ({
  authFetch: (...args: unknown[]) => mockAuthFetch(...args),
}));

describe('CryptoPayoutsTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows empty state', async () => {
    mockAuthFetch.mockResolvedValue({ response: { ok: true }, data: { success: true, payments: [] } });
    render(<CryptoPayoutsTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('No forwarded payments yet.')).toBeTruthy();
    });
  });

  it('renders forwarded payments', async () => {
    mockAuthFetch.mockResolvedValue({
      response: { ok: true },
      data: {
        success: true,
        payments: [{
          id: 'pay-1',
          business_id: 'biz-1',
          amount_crypto: '0.01',
          amount_usd: '300.00',
          currency: 'ETH',
          status: 'forwarded',
          payment_address: '0xaddr',
          merchant_wallet: '0xmerchantwallet1234',
          tx_hash: null,
          forward_tx_hash: '0xforwardtx',
          forwarded_at: '2025-01-01T00:00:00Z',
          created_at: '2025-01-01T00:00:00Z',
          fee_amount: '3.00',
          merchant_amount: '297.00',
        }],
      },
    });
    render(<CryptoPayoutsTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('$300.00')).toBeTruthy();
      expect(screen.getByText('3.00 ETH')).toBeTruthy();
      expect(screen.getByText('297.00 ETH')).toBeTruthy();
      expect(screen.getByText('0xforwar...')).toBeTruthy();
    });
  });

  it('shows loading spinner initially', () => {
    mockAuthFetch.mockReturnValue(new Promise(() => {}));
    render(<CryptoPayoutsTab businessId="biz-1" />);
    expect(screen.getByText('Loading payouts...')).toBeTruthy();
  });

  it('calls API with status=forwarded filter', async () => {
    mockAuthFetch.mockResolvedValue({ response: { ok: true }, data: { success: true, payments: [] } });
    render(<CryptoPayoutsTab businessId="biz-1" />);
    await waitFor(() => {
      expect(mockAuthFetch).toHaveBeenCalledWith(
        '/api/payments?business_id=biz-1&status=forwarded',
        {},
        expect.anything()
      );
    });
  });

  it('shows export button when payouts exist', async () => {
    mockAuthFetch.mockResolvedValue({
      response: { ok: true },
      data: {
        success: true,
        payments: [{
          id: 'pay-1', business_id: 'biz-1', amount_crypto: '1', amount_usd: '100', currency: 'BTC',
          status: 'forwarded', payment_address: 'addr', merchant_wallet: 'merchant-wallet', tx_hash: '0x123',
          forward_tx_hash: null, forwarded_at: null,
          created_at: '2025-01-01T00:00:00Z', fee_amount: null, merchant_amount: null,
        }],
      },
    });
    render(<CryptoPayoutsTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('Export CSV')).toBeTruthy();
    });
  });
});
