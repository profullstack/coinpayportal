import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetOrder, mockCapture, mockResolveContext, mockSettle } = vi.hoisted(() => ({
  mockGetOrder: vi.fn(),
  mockCapture: vi.fn(),
  mockResolveContext: vi.fn(),
  mockSettle: vi.fn(),
}));

vi.mock('./client', () => ({
  getPaypalOrder: mockGetOrder,
  capturePaypalOrder: mockCapture,
}));
vi.mock('./accounts', () => ({ resolvePaypalContext: mockResolveContext }));
// Settlement itself is unit-tested in settle.test.ts; here we only care that the
// sweep routes each PayPal state to it correctly.
vi.mock('./settle', () => ({ settlePaypalCapture: mockSettle }));

import { reconcilePaypalTransactions } from './reconcile';

const CONTEXT = {
  mode: 'self_serve',
  creds: { clientId: 'cid', clientSecret: 'sec', environment: 'live' },
  callContext: {},
  payeeMerchantId: null,
  platformFeePayeeMerchantId: null,
  supportsPlatformFee: false,
  paymentsReceivable: true,
  merchantIdInPaypal: null,
  environment: 'live',
};

const HOURS = 3_600_000;

function row(overrides: Record<string, any> = {}) {
  return {
    id: 'txn-1',
    business_id: 'biz-1',
    merchant_id: 'merch-1',
    amount: 100,
    currency: 'USD',
    status: 'pending',
    invoice_number: 'INV-1',
    customer_email: null,
    platform_fee_amount: 0,
    paypal_order_id: 'ORDER-1',
    // Old enough to sweep, young enough not to expire.
    created_at: new Date(Date.now() - 1 * HOURS).toISOString(),
    ...overrides,
  };
}

/** Records the updates the sweep issues so expiry can be asserted. */
function mockSupabase(rows: any[]) {
  const updates: any[] = [];
  const selectChain: any = {
    in: () => selectChain,
    lt: () => selectChain,
    order: () => selectChain,
    limit: async () => ({ data: rows, error: null }),
  };
  const updateChain: any = {
    eq: () => updateChain,
    in: async () => ({ error: null }),
  };
  return {
    client: {
      from: () => ({
        select: () => selectChain,
        update: (values: any) => {
          updates.push(values);
          return updateChain;
        },
      }),
    } as any,
    updates,
  };
}

describe('reconcilePaypalTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveContext.mockResolvedValue(CONTEXT);
    mockSettle.mockResolvedValue({ settled: true, alreadySettled: false, transactionId: 'txn-1' });
  });

  it('captures an order the payer approved and abandoned', async () => {
    // The whole reason this sweep exists.
    mockGetOrder.mockResolvedValue({ status: 'APPROVED' });
    mockCapture.mockResolvedValue({ status: 'COMPLETED', captureId: 'CAP-1' });

    const { client } = mockSupabase([row()]);
    const stats = await reconcilePaypalTransactions(client);

    expect(mockCapture).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'ORDER-1' }));
    expect(mockSettle).toHaveBeenCalledTimes(1);
    expect(stats).toMatchObject({ examined: 1, captured: 1, errors: 0 });
  });

  it('settles an order PayPal already captured without capturing again', async () => {
    // The webhook was lost. Capturing again would error; settle from what
    // PayPal reports instead.
    mockGetOrder.mockResolvedValue({ status: 'COMPLETED', captureId: 'CAP-2' });

    const { client } = mockSupabase([row()]);
    const stats = await reconcilePaypalTransactions(client);

    expect(mockCapture).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ settled: 1, captured: 0 });
  });

  it('leaves an unapproved order alone until it is old enough', async () => {
    mockGetOrder.mockResolvedValue({ status: 'CREATED' });

    const { client, updates } = mockSupabase([row()]);
    const stats = await reconcilePaypalTransactions(client);

    expect(stats).toMatchObject({ skipped: 1, expired: 0 });
    expect(updates).toHaveLength(0);
  });

  it('expires an unapproved order past the window', async () => {
    mockGetOrder.mockResolvedValue({ status: 'CREATED' });

    const { client, updates } = mockSupabase([
      row({ created_at: new Date(Date.now() - 12 * HOURS).toISOString() }),
    ]);
    const stats = await reconcilePaypalTransactions(client);

    expect(stats).toMatchObject({ expired: 1 });
    expect(updates[0]).toMatchObject({ status: 'expired' });
  });

  it('never calls PayPal for a row whose order was never created', async () => {
    const { client } = mockSupabase([row({ paypal_order_id: 'pending:INV-1' })]);
    const stats = await reconcilePaypalTransactions(client);

    expect(mockGetOrder).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ skipped: 1 });
  });

  it('expires rather than retries when PayPal has dropped the order', async () => {
    mockGetOrder.mockRejectedValue(new Error('RESOURCE_NOT_FOUND'));

    const { client, updates } = mockSupabase([row()]);
    const stats = await reconcilePaypalTransactions(client);

    expect(stats).toMatchObject({ expired: 1, errors: 0 });
    expect(updates[0]).toMatchObject({ status: 'expired' });
  });

  it('leaves a row pending when PayPal errors transiently', async () => {
    // A 500 from PayPal must not burn the payment — try again next cycle.
    mockGetOrder.mockRejectedValue(new Error('INTERNAL_SERVER_ERROR (500)'));

    const { client, updates } = mockSupabase([row()]);
    const stats = await reconcilePaypalTransactions(client);

    expect(stats).toMatchObject({ errors: 1, expired: 0, captured: 0 });
    expect(updates).toHaveLength(0);
  });

  it('does not double-count when settlement reports it was already done', async () => {
    // The real webhook landed mid-sweep and won the conditional update.
    mockGetOrder.mockResolvedValue({ status: 'APPROVED' });
    mockCapture.mockResolvedValue({ status: 'COMPLETED', captureId: 'CAP-3' });
    mockSettle.mockResolvedValue({ settled: false, alreadySettled: true, transactionId: 'txn-1' });

    const { client } = mockSupabase([row()]);
    const stats = await reconcilePaypalTransactions(client);

    expect(stats).toMatchObject({ captured: 0, skipped: 1, errors: 0 });
  });

  it('ages out a row whose business disconnected PayPal', async () => {
    mockResolveContext.mockResolvedValue({ error: 'PayPal is not connected', status: 400 });

    const { client, updates } = mockSupabase([
      row({ created_at: new Date(Date.now() - 12 * HOURS).toISOString() }),
    ]);
    const stats = await reconcilePaypalTransactions(client);

    expect(stats).toMatchObject({ expired: 1 });
    expect(updates[0].failure_reason).toMatch(/disconnected/i);
  });

  it('returns empty stats when nothing is stale', async () => {
    const { client } = mockSupabase([]);
    const stats = await reconcilePaypalTransactions(client);

    expect(stats).toMatchObject({ examined: 0, captured: 0, settled: 0 });
    expect(mockGetOrder).not.toHaveBeenCalled();
  });
});
