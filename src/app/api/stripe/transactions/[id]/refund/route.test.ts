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
function makeChain(value: { data: any; error: any }) {
  const chain: any = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'single', 'maybeSingle', 'update', 'not']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: any) => Promise.resolve(value).then(resolve);
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
function wire(tables: Record<string, { data: any; error: any }>) {
  mockFrom.mockImplementation((table: string) => makeChain(tables[table] ?? { data: null, error: null }));
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
      expect.objectContaining({ payment_intent: 'pi_1', reverse_transfer: true, refund_application_fee: true })
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
});
