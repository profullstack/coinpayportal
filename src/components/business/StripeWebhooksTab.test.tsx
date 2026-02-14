import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { StripeWebhooksTab } from './StripeWebhooksTab';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const mockAuthFetch = vi.fn();
vi.mock('@/lib/auth/client', () => ({
  authFetch: (...args: unknown[]) => mockAuthFetch(...args),
}));

describe('StripeWebhooksTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows empty state', async () => {
    mockAuthFetch.mockResolvedValue({ response: { ok: true }, data: { success: true, endpoints: [] } });
    render(<StripeWebhooksTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('No webhook endpoints configured.')).toBeTruthy();
    });
  });

  it('renders endpoints', async () => {
    mockAuthFetch.mockResolvedValue({
      response: { ok: true },
      data: { success: true, endpoints: [{ id: 'we_1', url: 'https://example.com/hook', status: 'enabled', enabled_events: ['charge.succeeded'], created: 1700000000 }] },
    });
    render(<StripeWebhooksTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('https://example.com/hook')).toBeTruthy();
    });
  });

  it('shows add form when button clicked', async () => {
    mockAuthFetch.mockResolvedValue({ response: { ok: true }, data: { success: true, endpoints: [] } });
    render(<StripeWebhooksTab businessId="biz-1" />);
    await waitFor(() => screen.getByText('Add Endpoint'));
    fireEvent.click(screen.getByText('Add Endpoint'));
    await waitFor(() => {
      expect(screen.getByText('Endpoint URL')).toBeTruthy();
    });
  });
});
