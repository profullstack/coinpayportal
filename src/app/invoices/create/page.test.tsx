/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreateInvoicePage from './page';

const mockPush = vi.fn();
const mockAuthFetch = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('@/lib/auth/client', () => ({
  authFetch: (...args: any[]) => mockAuthFetch(...args),
}));

describe('CreateInvoicePage', () => {
  // crypto + card returned by GET /api/businesses/biz_1/payment-methods. Overridden per-test.
  let cryptoResponse: any[] = [];
  let cardResponse: { enabled: boolean } = { enabled: false };

  beforeEach(() => {
    vi.clearAllMocks();
    cryptoResponse = [];
    cardResponse = { enabled: false };

    mockAuthFetch.mockImplementation((url: string) => {
      if (url === '/api/businesses') {
        return Promise.resolve({
          response: { ok: true },
          data: {
            success: true,
            businesses: [{ id: 'biz_1', name: 'Test Business' }],
          },
        });
      }

      if (url === '/api/clients?business_id=biz_1') {
        return Promise.resolve({
          response: { ok: true },
          data: { success: true, clients: [] },
        });
      }

      if (url === '/api/businesses/biz_1/payment-methods') {
        return Promise.resolve({
          response: { ok: true },
          data: { success: true, crypto: cryptoResponse, card: cardResponse },
        });
      }

      return Promise.resolve({
        response: { ok: true },
        data: { success: true },
      });
    });
  });

  it('falls back to the full supported crypto list when no business wallets exist', async () => {
    const user = userEvent.setup();
    render(<CreateInvoicePage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Invoice' })).toBeInTheDocument();
    });

    const businessSelect = screen.getAllByRole('combobox')[0];
    await user.selectOptions(businessSelect, 'biz_1');

    await waitFor(() => {
      expect(mockAuthFetch).toHaveBeenCalledWith('/api/clients?business_id=biz_1', {}, expect.anything());
      expect(mockAuthFetch).toHaveBeenCalledWith('/api/businesses/biz_1/payment-methods', {}, expect.anything());
    });

    const cryptoSelect = screen.getAllByRole('combobox')[3];
    const optionValues = Array.from(cryptoSelect.querySelectorAll('option')).map((option) => option.getAttribute('value'));

    expect(optionValues).toContain('USDT_ETH');
    expect(optionValues).toContain('USDT_POL');
    expect(optionValues).toContain('USDT_SOL');
    expect(optionValues).toContain('USDC_ETH');
    expect(optionValues).toContain('USDC_POL');
    expect(optionValues).toContain('USDC_SOL');
    expect(optionValues).toContain('DOGE');
    expect(optionValues).toContain('XRP');
    expect(optionValues).toContain('ADA');
    expect(optionValues).toContain('BNB');

    // Card disabled for this business -> creator is told cards are off.
    expect(screen.getByText(/Card payments are off for this business/)).toBeInTheDocument();
  });

  it('shows the business crypto + card methods from the payment-methods endpoint', async () => {
    cryptoResponse = [
      { cryptocurrency: 'BTC', wallet_address: 'bc1qbtc' },
      { cryptocurrency: 'SOL', wallet_address: 'solADDR' },
    ];
    cardResponse = { enabled: true };

    const user = userEvent.setup();
    render(<CreateInvoicePage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Invoice' })).toBeInTheDocument();
    });

    const businessSelect = screen.getAllByRole('combobox')[0];
    await user.selectOptions(businessSelect, 'biz_1');

    await waitFor(() => {
      expect(mockAuthFetch).toHaveBeenCalledWith('/api/businesses/biz_1/payment-methods', {}, expect.anything());
    });

    const cryptoSelect = screen.getAllByRole('combobox')[3];
    const optionValues = Array.from(cryptoSelect.querySelectorAll('option')).map((option) => option.getAttribute('value'));

    // Configured wallets are offered, generic fallback list is not used.
    expect(optionValues).toContain('BTC');
    expect(optionValues).toContain('SOL');
    expect(optionValues).not.toContain('DOGE');
    expect(screen.queryByText(/No wallets configured for this business/)).not.toBeInTheDocument();

    // Card is shown as an enabled method.
    expect(screen.getByText(/Card payments enabled/)).toBeInTheDocument();
  });
});
