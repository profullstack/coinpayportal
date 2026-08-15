import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';

const mockFrom = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock('@/lib/auth/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/secrets', () => ({ getJwtSecret: vi.fn(() => 'test-secret') }));
vi.mock('@/lib/auth/authz', () => ({ authorizeBusinessOwner: vi.fn() }));
vi.mock('@/lib/server/optional-deps', () => ({ getStripe: vi.fn() }));

import { verifyToken } from '@/lib/auth/jwt';
import { authorizeBusinessOwner } from '@/lib/auth/authz';
import { getStripe } from '@/lib/server/optional-deps';

// A thenable query chain resolving to `value`; every builder method returns it.
//
// Writes resolve differently from reads. The route claims the transaction with
// a conditional UPDATE ... RETURNING before it calls Stripe — that is what
// stops two concurrent requests from both refunding — so an update chain has
// to resolve to the claimed rows, not to the row a read would return.
// `claimResult` lets a test model losing that race.
function makeChain(
  value: { data: any; error: any },
  claimResult?: { data: any; error: any },
) {
  const chain: any = {};
  let isWrite = false;

  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'single', 'maybeSingle', 'not']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.update = vi.fn(() => {
    isWrite = true;
    return chain;
  });

  chain.then = (resolve: any) => {
    const result = isWrite ? (claimResult ?? { data: [{ id: 'txn-1' }], error: null }) : value;
    return Promise.resolve(result).then(resolve);
  };
  return chain;
}

const refundCreate = vi.fn();
const params = Promise.resolve({ id: 'txn-1' });

function req() {
  return new NextRequest('http://localhost/api/stripe/transactions/txn-1/refund', {
    method: 'POST',
    headers: { authorization: 'Bearer valid' },
  });
}

// Route by table so each query in the handler gets its own result.
function wire(
  tables: Record<string, { data: any; error: any }>,
  claims: Record<string, { data: any; error: any }> = {},
) {
  mockFrom.mockImplementation((table: string) =>
    makeChain(tables[table] ?? { data: null, error: null }, claims[table]),
  );
}

describe('POST /api/stripe/transactions/[id]/refund', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    (verifyToken as any).mockReturnValue({ userId: 'user-1' });
    (authorizeBusinessOwner as any).mockResolvedValue({ ok: true, role: 'owner', ownerId: 'user-1' });
    refundCreate.mockResolvedValue({ id: 're_1', status: 'succeeded', amount: 10000, currency: 'usd' });
    (getStripe as any).mockResolvedValue({ refunds: { create: refundCreate } });
  });

  it('refunds a succeeded transaction', async () => {
    wire({
      stripe_transactions: {
        data: {
          id: 'txn-1',
          business_id: 'biz-1',
          status: 'succeeded',
          amount: 10000,
          currency: 'usd',
          stripe_payment_intent_id: 'pi_1',
          stripe_charge_id: 'ch_1',
        },
        error: null,
      },
      stripe_disputes: { data: null, error: null },
    });

    const res = await POST(req(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(refundCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_1', reverse_transfer: true, refund_application_fee: true }),
      // Second argument carries the idempotency key; asserted in its own test.
      expect.anything()
    );
  });

  it('401 without a bearer token', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/stripe/transactions/txn-1/refund', { method: 'POST' }),
      { params }
    );
    expect(res.status).toBe(401);
  });

  it('404 when the transaction does not exist', async () => {
    wire({ stripe_transactions: { data: null, error: { message: 'not found' } } });
    const res = await POST(req(), { params });
    expect(res.status).toBe(404);
  });

  it('403 when the caller lacks funds.move', async () => {
    (authorizeBusinessOwner as any).mockResolvedValue({ ok: false, status: 403, error: 'Insufficient permissions' });
    wire({
      stripe_transactions: {
        data: { id: 'txn-1', business_id: 'biz-1', status: 'succeeded', stripe_payment_intent_id: 'pi_1', stripe_charge_id: 'ch_1' },
        error: null,
      },
    });
    const res = await POST(req(), { params });
    expect(res.status).toBe(403);
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it('409 when already refunded', async () => {
    wire({
      stripe_transactions: {
        data: { id: 'txn-1', business_id: 'biz-1', status: 'refunded', stripe_payment_intent_id: 'pi_1', stripe_charge_id: 'ch_1' },
        error: null,
      },
    });
    const res = await POST(req(), { params });
    expect(res.status).toBe(409);
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it('409 when the status is not refundable', async () => {
    wire({
      stripe_transactions: {
        data: { id: 'txn-1', business_id: 'biz-1', status: 'failed', stripe_payment_intent_id: 'pi_1', stripe_charge_id: 'ch_1' },
        error: null,
      },
    });
    const res = await POST(req(), { params });
    expect(res.status).toBe(409);
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it('409 when the charge has an open dispute', async () => {
    wire({
      stripe_transactions: {
        data: { id: 'txn-1', business_id: 'biz-1', status: 'succeeded', stripe_payment_intent_id: 'pi_1', stripe_charge_id: 'ch_1' },
        error: null,
      },
      stripe_disputes: { data: { status: 'needs_response' }, error: null },
    });
    const res = await POST(req(), { params });
    expect(res.status).toBe(409);
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it('502 when Stripe rejects the refund', async () => {
    refundCreate.mockRejectedValue(new Error('charge already refunded'));
    wire({
      stripe_transactions: {
        data: { id: 'txn-1', business_id: 'biz-1', status: 'succeeded', stripe_payment_intent_id: 'pi_1', stripe_charge_id: 'ch_1' },
        error: null,
      },
      stripe_disputes: { data: null, error: null },
    });
    const res = await POST(req(), { params });
    expect(res.status).toBe(502);
  });

  it('does not call Stripe when another request already claimed the refund', async () => {
    // Both requests pass every read-based check; only the one that wins the
    // conditional UPDATE may refund. Without this the customer is refunded
    // twice and the money cannot be recovered.
    wire(
      {
        stripe_transactions: {
          data: {
            id: 'txn-1',
            business_id: 'biz-1',
            status: 'succeeded',
            stripe_payment_intent_id: 'pi_1',
            stripe_charge_id: 'ch_1',
          },
          error: null,
        },
      },
      { stripe_transactions: { data: [], error: null } },
    );

    const response = await POST(req(), { params });

    expect(response.status).toBe(409);
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it('sends an idempotency key so a retried refund cannot double-refund', async () => {
    wire({
      stripe_transactions: {
        data: {
          id: 'txn-1',
          business_id: 'biz-1',
          status: 'succeeded',
          stripe_payment_intent_id: 'pi_1',
          stripe_charge_id: 'ch_1',
        },
        error: null,
      },
    });

    await POST(req(), { params });

    expect(refundCreate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ idempotencyKey: 'refund:txn-1' }),
    );
  });
});
