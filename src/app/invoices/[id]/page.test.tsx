/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InvoiceDetailPage from './page';

const mockAuthFetch = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: 'inv-1' }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('@/lib/auth/client', () => ({
  authFetch: (...args: unknown[]) => mockAuthFetch(...args),
}));

const sentInvoice = {
  id: 'inv-1',
  invoice_number: 'INV-001',
  status: 'sent',
  currency: 'USD',
  amount: '40.00',
  crypto_currency: 'SOL',
  crypto_amount: '0.52909283',
  payment_address: 'existing-solana-payment-address',
  stripe_checkout_url: null,
  stripe_session_id: null,
  merchant_wallet_address: 'merchant-solana-address',
  fee_rate: '0.01',
  fee_amount: '0.40',
  due_date: null,
  paid_at: null,
  tx_hash: null,
  notes: 'Weekly development milestones',
  email_status: null,
  email_message_id: null,
  email_last_error: null,
  email_last_attempted_at: null,
  created_at: '2026-08-14T00:00:00.000Z',
  updated_at: '2026-08-14T00:00:00.000Z',
  clients: {
    id: 'client-1',
    name: 'Anthony',
    email: 'anthony@profullstack.com',
    company_name: 'Profullstack',
  },
  businesses: { id: 'biz-1', name: 'Profullstack' },
  invoice_schedules: null,
  metadata: null,
};

function mockInitialInvoice(invoice = sentInvoice) {
  mockAuthFetch.mockImplementation((url: string) => {
    if (url === '/api/invoices/inv-1') {
      return Promise.resolve({ response: { ok: true }, data: { success: true, invoice } });
    }
    if (url === '/api/stripe/connect/status/biz-1') {
      return Promise.resolve({ response: { ok: true }, data: { success: true, charges_enabled: false } });
    }
    return Promise.resolve({ response: { ok: true }, data: { success: true } });
  });
}

describe('InvoiceDetailPage email delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitialInvoice();
  });

  it('shows legacy sent invoices as unknown and safely resends their existing payment link', async () => {
    const user = userEvent.setup();
    const resentInvoice = {
      ...sentInvoice,
      email_status: 'accepted',
      email_message_id: 'email-message-2',
      email_last_attempted_at: '2026-08-17T10:00:00.000Z',
    };

    mockAuthFetch.mockImplementation((url: string) => {
      if (url === '/api/invoices/inv-1') {
        return Promise.resolve({ response: { ok: true }, data: { success: true, invoice: sentInvoice } });
      }
      if (url === '/api/stripe/connect/status/biz-1') {
        return Promise.resolve({ response: { ok: true }, data: { success: true, charges_enabled: false } });
      }
      if (url === '/api/invoices/inv-1/resend-email') {
        return Promise.resolve({
          response: { ok: true },
          data: { success: true, emailAccepted: true, invoice: resentInvoice },
        });
      }
      return Promise.resolve({ response: { ok: true }, data: { success: true } });
    });

    render(<InvoiceDetailPage />);

    expect(await screen.findByText('unknown')).toBeInTheDocument();
    expect(screen.getByText(/No email acceptance record exists/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Resend Email/ }));

    await waitFor(() => {
      expect(mockAuthFetch).toHaveBeenCalledWith(
        '/api/invoices/inv-1/resend-email',
        { method: 'POST' },
        expect.anything()
      );
    });
    expect(await screen.findByText('accepted')).toBeInTheDocument();
    expect(screen.getByText('The email provider accepted the invoice message.')).toBeInTheDocument();
    expect(screen.getByText('existing-solana-payment-address')).toBeInTheDocument();
  });

  it('warns when initial send creates the payment but email submission fails', async () => {
    const user = userEvent.setup();
    const draftInvoice = { ...sentInvoice, status: 'draft', email_status: null };
    const failedInvoice = {
      ...sentInvoice,
      email_status: 'failed',
      email_last_error: 'Provider rejected the message',
      email_last_attempted_at: '2026-08-17T10:00:00.000Z',
    };

    mockAuthFetch.mockImplementation((url: string) => {
      if (url === '/api/invoices/inv-1') {
        return Promise.resolve({ response: { ok: true }, data: { success: true, invoice: draftInvoice } });
      }
      if (url === '/api/stripe/connect/status/biz-1') {
        return Promise.resolve({ response: { ok: true }, data: { success: true, charges_enabled: false } });
      }
      if (url === '/api/invoices/inv-1/send') {
        return Promise.resolve({
          response: { ok: true },
          data: {
            success: true,
            emailAccepted: false,
            warning: 'The payment link is active, but the email provider did not accept the message.',
            invoice: failedInvoice,
          },
        });
      }
      return Promise.resolve({ response: { ok: true }, data: { success: true } });
    });

    render(<InvoiceDetailPage />);
    await user.click(await screen.findByRole('button', { name: /Send Invoice/ }));

    expect(await screen.findByText(/payment link is active/)).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Resend Email/ })).toBeInTheDocument();
  });

  it('does not offer email resend for an overdue payment link', async () => {
    mockInitialInvoice({ ...sentInvoice, status: 'overdue' });

    render(<InvoiceDetailPage />);

    expect(await screen.findByRole('button', { name: /Re-issue Payment Details/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Resend Email/ })).not.toBeInTheDocument();
  });

  it('offers payment re-issue after a resend discovers an inactive legacy payment', async () => {
    const user = userEvent.setup();
    const overdueInvoice = { ...sentInvoice, status: 'overdue' };

    mockAuthFetch.mockImplementation((url: string) => {
      if (url === '/api/invoices/inv-1') {
        return Promise.resolve({ response: { ok: true }, data: { success: true, invoice: sentInvoice } });
      }
      if (url === '/api/stripe/connect/status/biz-1') {
        return Promise.resolve({ response: { ok: true }, data: { success: true, charges_enabled: false } });
      }
      if (url === '/api/invoices/inv-1/resend-email') {
        return Promise.resolve({
          response: { ok: false, status: 409 },
          data: {
            success: false,
            code: 'PAYMENT_LINK_INACTIVE',
            canReissue: true,
            error: 'The existing payment link is no longer active. Re-issue the invoice before emailing it again.',
            invoice: overdueInvoice,
          },
        });
      }
      return Promise.resolve({ response: { ok: true }, data: { success: true } });
    });

    render(<InvoiceDetailPage />);
    await user.click(await screen.findByRole('button', { name: /Resend Email/ }));

    expect(await screen.findByRole('button', { name: /Re-issue Payment Details/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Resend Email/ })).not.toBeInTheDocument();
    expect(screen.getByText(/no longer active/)).toBeInTheDocument();
  });
});
