import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PaypalCapture } from './client';

const mockSendPaymentWebhook = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true }));
vi.mock('@/lib/webhooks/service', () => ({
  sendPaymentWebhook: mockSendPaymentWebhook,
}));

import { settlePaypalCapture, type PaypalTransactionRow } from './settle';

/**
 * Minimal stand-in for the one query settlement makes:
 *   .from('paypal_transactions').update(...).eq(...).neq(...).select(...).maybeSingle()
 *
 * `matched` models whether the conditional UPDATE hit a row — false is how
 * Postgres reports "someone else already completed this".
 */
function mockSupabase({ matched = true }: { matched?: boolean } = {}) {
  const update = vi.fn();
  const chain = {
    update: (values: any) => {
      update(values);
      return chain;
    },
    eq: () => chain,
    neq: () => chain,
    select: () => chain,
    maybeSingle: async () => ({ data: matched ? { id: 'txn-1' } : null, error: null }),
  };

  return {
    client: { from: vi.fn().mockReturnValue(chain) } as any,
    update,
  };
}

const transaction: PaypalTransactionRow = {
  id: 'txn-1',
  business_id: 'biz-1',
  merchant_id: 'merch-1',
  amount: 100,
  currency: 'USD',
  status: 'pending',
  invoice_number: 'INV-1',
  customer_email: 'buyer@example.com',
  platform_fee_amount: 1,
  paypal_order_id: 'ORDER-1',
};

function capture(overrides: Partial<PaypalCapture> = {}): PaypalCapture {
  return {
    status: 'COMPLETED',
    captureId: 'CAP-1',
    payerEmail: 'buyer@example.com',
    amount: '100.00',
    currency: 'USD',
    paypalFee: '3.49',
    netAmount: '96.51',
    platformFee: '1.00',
    payeeMerchantId: 'MERCHANT1',
    customId: 'txn-1',
    ...overrides,
  };
}

describe('settlePaypalCapture', () => {
  beforeEach(() => {
    mockSendPaymentWebhook.mockClear();
  });

  it('refuses to settle a capture that is not COMPLETED', async () => {
    const { client, update } = mockSupabase();
    const result = await settlePaypalCapture(client, transaction, capture({ status: 'PENDING' }));

    expect(result.settled).toBe(false);
    expect(result.error).toMatch(/PENDING/);
    // Nothing may be written for a capture PayPal has not completed.
    expect(update).not.toHaveBeenCalled();
    expect(mockSendPaymentWebhook).not.toHaveBeenCalled();
  });

  it('settles a completed capture and notifies the merchant once', async () => {
    const { client, update } = mockSupabase({ matched: true });
    const result = await settlePaypalCapture(client, transaction, capture());

    expect(result).toMatchObject({ settled: true, alreadySettled: false });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        paypal_capture_id: 'CAP-1',
        amount: 100,
        paypal_fee_amount: 3.49,
        platform_fee_amount: 1,
        // net_amount (96.51) already excludes PayPal's fee; the merchant's real
        // take is that minus our commission.
        net_to_merchant: 95.51,
      })
    );
    expect(mockSendPaymentWebhook).toHaveBeenCalledTimes(1);
  });

  it('does not re-notify when another path already settled the row', async () => {
    // This is the duplicate case: the webhook and the payer's return leg both
    // arrive. The conditional UPDATE matches zero rows for the loser.
    const { client } = mockSupabase({ matched: false });
    const result = await settlePaypalCapture(client, transaction, capture());

    expect(result).toMatchObject({ settled: false, alreadySettled: true });
    expect(mockSendPaymentWebhook).not.toHaveBeenCalled();
  });

  it("trusts PayPal's platform fee over what we asked for", async () => {
    const { client, update } = mockSupabase();
    // We requested 1.00 but PayPal actually took 0.50 — the breakdown wins,
    // otherwise the ledger overstates platform revenue.
    await settlePaypalCapture(client, transaction, capture({ platformFee: '0.50' }));

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ platform_fee_amount: 0.5, net_to_merchant: 96.01 })
    );
  });

  it('falls back to arithmetic when PayPal sends no breakdown', async () => {
    const { client, update } = mockSupabase();
    await settlePaypalCapture(
      client,
      transaction,
      capture({ paypalFee: null, netAmount: null, platformFee: null })
    );

    // 100 - 1 (our requested fee) - 0 (unknown PayPal fee)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ platform_fee_amount: 1, net_to_merchant: 99 })
    );
  });

  it('still settles when the merchant webhook throws', async () => {
    // A merchant endpoint being down must not make PayPal retry a capture we
    // have already banked.
    mockSendPaymentWebhook.mockRejectedValueOnce(new Error('merchant endpoint down'));
    const { client } = mockSupabase();

    const result = await settlePaypalCapture(client, transaction, capture());
    expect(result.settled).toBe(true);
  });
});
