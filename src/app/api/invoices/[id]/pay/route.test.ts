import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSingle = vi.fn();
const mockEq = vi.fn().mockReturnValue({ single: mockSingle });
const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

import { GET } from './route';

function makeRequest(id: string): NextRequest {
  return new NextRequest(`http://localhost/api/invoices/${id}/pay`);
}

const baseInvoice = {
  id: 'inv-1',
  invoice_number: 'INV-001',
  status: 'sent',
  currency: 'USD',
  amount: '100.00',
  crypto_currency: 'SOL',
  crypto_amount: '0.50000000',
  payment_address: 'SoLaDdReSs123',
  stripe_checkout_url: 'https://checkout.stripe.com/pay/cs_test_123',
  due_date: null,
  notes: null,
  created_at: '2026-03-22T00:00:00Z',
  businesses: { id: 'biz-1', name: 'Acme' },
};

describe('GET /api/invoices/[id]/pay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('includes stripe_checkout_url in response', async () => {
    mockSingle.mockResolvedValue({ data: baseInvoice, error: null });

    const res = await GET(makeRequest('inv-1'), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.invoice.stripe_checkout_url).toBe('https://checkout.stripe.com/pay/cs_test_123');
  });

  it('returns null stripe_checkout_url when not set', async () => {
    mockSingle.mockResolvedValue({
      data: { ...baseInvoice, stripe_checkout_url: null },
      error: null,
    });

    const res = await GET(makeRequest('inv-1'), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.invoice.stripe_checkout_url).toBeNull();
  });

  it('returns 404 for draft invoices', async () => {
    mockSingle.mockResolvedValue({
      data: { ...baseInvoice, status: 'draft' },
      error: null,
    });

    const res = await GET(makeRequest('inv-1'), { params: Promise.resolve({ id: 'inv-1' }) });
    expect(res.status).toBe(404);
  });
});
