import { describe, expect, it, vi } from 'vitest';
import { createInvoiceStripeCheckout } from './invoice-stripe';

const invoice = {
  id: 'inv-1',
  invoice_number: 'INV-001',
  amount: 40,
  business_id: 'biz-1',
  businesses: { merchant_id: 'merchant-1' },
};

function stripeAccountClient(result: { data: unknown; error: unknown }) {
  const query: any = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.maybeSingle = vi.fn().mockResolvedValue(result);

  return { from: vi.fn(() => query) } as any;
}

describe('createInvoiceStripeCheckout account resolution', () => {
  it('returns null only when the account lookup succeeds without a usable account', async () => {
    const supabase = stripeAccountClient({ data: null, error: null });

    await expect(createInvoiceStripeCheckout(supabase, invoice, false)).resolves.toBeNull();
  });

  it('surfaces transient account lookup failures instead of clearing a prior checkout', async () => {
    const supabase = stripeAccountClient({
      data: null,
      error: { message: 'connection timed out' },
    });

    await expect(createInvoiceStripeCheckout(supabase, invoice, false)).rejects.toThrow(
      'Failed to resolve Stripe account: connection timed out'
    );
  });
});
