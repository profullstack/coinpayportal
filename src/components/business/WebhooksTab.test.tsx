import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { WebhooksTab } from './WebhooksTab';
import type { Business } from './types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const mockAuthFetch = vi.fn();
vi.mock('@/lib/auth/client', () => ({
  authFetch: (...args: unknown[]) => mockAuthFetch(...args),
}));

const baseBusiness: Business = {
  id: 'b198c6dc-4c3b-4a54-994c-a750c1a580cd',
  merchant_id: '5d79f032-b9ec-42b6-a34a-577c9ab9688d',
  name: 'd0rz.com',
  webhook_url: 'https://d0rz.com/api/webhooks/coinpay/crypto',
  webhook_secret: 'whsecret_test',
  webhook_events: [],
  active: true,
  created_at: '2026-04-07T00:00:00Z',
  updated_at: '2026-04-07T00:00:00Z',
} as any;

describe('WebhooksTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.localStorage.setItem('auth_token', 'test-token');
  });

  it('reads webhook URL from businesses (single source of truth, never per-rail)', async () => {
    mockAuthFetch.mockResolvedValue({ response: { ok: true }, data: { success: true, logs: [] } });
    render(<WebhooksTab business={baseBusiness} onUpdate={vi.fn()} onCopy={vi.fn()} />);
    // The URL input is pre-filled from the SAME businesses.webhook_url
    // that sendPaymentWebhook reads. Whatever shows here is what every
    // payment event (crypto AND card) will be POSTed to.
    const input = (await screen.findByPlaceholderText('https://example.com/webhook')) as HTMLInputElement;
    expect(input.value).toBe('https://d0rz.com/api/webhooks/coinpay/crypto');
  });

  it('queries /api/webhooks?business_id=...&limit=20 on mount for the deliveries panel', async () => {
    mockAuthFetch.mockResolvedValue({ response: { ok: true }, data: { success: true, logs: [] } });
    render(<WebhooksTab business={baseBusiness} onUpdate={vi.fn()} onCopy={vi.fn()} />);
    await waitFor(() => {
      expect(mockAuthFetch).toHaveBeenCalledWith(
        `/api/webhooks?business_id=${baseBusiness.id}&limit=20`,
        {},
        expect.anything()
      );
    });
  });

  it('renders the deliveries table with status, latency, attempt, error', async () => {
    mockAuthFetch.mockResolvedValue({
      response: { ok: true },
      data: {
        success: true,
        logs: [
          {
            id: 'log_1',
            event: 'payment.confirmed',
            webhook_url: 'https://d0rz.com/api/webhooks/coinpay/crypto',
            status_code: 200,
            response_status: 200,
            success: true,
            attempt_number: 1,
            response_time_ms: 142,
            error_message: null,
            created_at: '2026-04-07T08:44:50.186Z',
            payment_id: 'd084f959-c33c-4540-82b8-221181347639',
          },
          {
            id: 'log_2',
            event: 'payment.confirmed',
            webhook_url: 'https://d0rz.com/api/webhooks/coinpay/crypto',
            status_code: 401,
            response_status: 401,
            success: false,
            attempt_number: 1,
            response_time_ms: 88,
            error_message: 'HTTP 401: Unauthorized',
            created_at: '2026-04-07T07:00:00.000Z',
            payment_id: '2a75c13a-51fc-4a2e-8693-545d6509a167',
          },
        ],
      },
    });
    render(<WebhooksTab business={baseBusiness} onUpdate={vi.fn()} onCopy={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('200')).toBeTruthy();
      expect(screen.getByText('401')).toBeTruthy();
      expect(screen.getByText('142ms')).toBeTruthy();
      expect(screen.getByText('88ms')).toBeTruthy();
      expect(screen.getByText('HTTP 401: Unauthorized')).toBeTruthy();
    });
  });

  it('renders empty state when there are no deliveries', async () => {
    mockAuthFetch.mockResolvedValue({ response: { ok: true }, data: { success: true, logs: [] } });
    render(<WebhooksTab business={baseBusiness} onUpdate={vi.fn()} onCopy={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/No deliveries yet/i)).toBeTruthy();
    });
  });

  it('Refresh button re-fetches the deliveries panel', async () => {
    mockAuthFetch.mockResolvedValue({ response: { ok: true }, data: { success: true, logs: [] } });
    render(<WebhooksTab business={baseBusiness} onUpdate={vi.fn()} onCopy={vi.fn()} />);
    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalled());
    const callsBefore = mockAuthFetch.mock.calls.length;
    const refresh = screen.getByText('Refresh');
    fireEvent.click(refresh);
    await waitFor(() => {
      expect(mockAuthFetch.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it('soft-fails when the deliveries fetch errors (does not throw)', async () => {
    mockAuthFetch.mockRejectedValue(new Error('boom'));
    render(<WebhooksTab business={baseBusiness} onUpdate={vi.fn()} onCopy={vi.fn()} />);
    // Empty state still renders rather than crashing the tab.
    await waitFor(() => {
      expect(screen.getByText(/No deliveries yet/i)).toBeTruthy();
    });
  });
});
