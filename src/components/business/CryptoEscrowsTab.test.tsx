import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CryptoEscrowsTab } from './CryptoEscrowsTab';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const mockAuthFetch = vi.fn();
vi.mock('@/lib/auth/client', () => ({
  authFetch: (...args: unknown[]) => mockAuthFetch(...args),
}));

describe('CryptoEscrowsTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows empty state', async () => {
    mockAuthFetch.mockResolvedValue({ response: { ok: true }, data: { escrows: [] } });
    render(<CryptoEscrowsTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('No escrows yet.')).toBeTruthy();
    });
  });

  it('renders escrows', async () => {
    mockAuthFetch.mockResolvedValue({
      response: { ok: true },
      data: {
        escrows: [{
          id: 'esc-1',
          chain: 'ETH',
          amount: 0.5,
          amount_usd: 1500,
          status: 'funded',
          depositor_address: '0xdepositor123',
          beneficiary_address: '0xbeneficiary456',
          deposit_address: '0xdeposit789',
          tx_hash: '0xtxhash',
          created_at: '2025-01-01T00:00:00Z',
          expires_at: '2025-02-01T00:00:00Z',
          released_at: null,
        }],
      },
    });
    render(<CryptoEscrowsTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('ETH')).toBeTruthy();
      expect(screen.getByText('0.5')).toBeTruthy();
      expect(screen.getByText('funded')).toBeTruthy();
    });
  });

  it('shows loading spinner initially', () => {
    mockAuthFetch.mockReturnValue(new Promise(() => {}));
    render(<CryptoEscrowsTab businessId="biz-1" />);
    expect(screen.getByText('Loading escrows...')).toBeTruthy();
  });

  it('shows export button when escrows exist', async () => {
    mockAuthFetch.mockResolvedValue({
      response: { ok: true },
      data: {
        escrows: [{
          id: 'esc-1', chain: 'SOL', amount: 10, amount_usd: null, status: 'pending',
          depositor_address: 'addr1', beneficiary_address: 'addr2', deposit_address: null,
          tx_hash: null, created_at: '2025-01-01T00:00:00Z', expires_at: null, released_at: null,
        }],
      },
    });
    render(<CryptoEscrowsTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('Export CSV')).toBeTruthy();
    });
  });
});
