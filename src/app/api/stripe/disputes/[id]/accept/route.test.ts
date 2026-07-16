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

function makeChain(value: { data: any; error: any }) {
  const chain: any = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'single', 'maybeSingle', 'update']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: any) => Promise.resolve(value).then(resolve);
  return chain;
}

const disputeClose = vi.fn();
const params = Promise.resolve({ id: 'dsp-1' });

function req() {
  return new NextRequest('http://localhost/api/stripe/disputes/dsp-1/accept', {
    method: 'POST',
    headers: { authorization: 'Bearer valid' },
  });
}

function wire(tables: Record<string, { data: any; error: any }>) {
  mockFrom.mockImplementation((table: string) => makeChain(tables[table] ?? { data: null, error: null }));
}

describe('POST /api/stripe/disputes/[id]/accept', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    (verifyToken as any).mockReturnValue({ userId: 'user-1' });
    (authorizeBusinessOwner as any).mockResolvedValue({ ok: true, role: 'owner', ownerId: 'user-1' });
    disputeClose.mockResolvedValue({ id: 'dp_1', status: 'lost' });
    (getStripe as any).mockResolvedValue({ disputes: { close: disputeClose } });
  });

  it('accepts (closes) an actionable dispute', async () => {
    wire({
      stripe_disputes: {
        data: { id: 'dsp-1', merchant_id: 'user-1', stripe_dispute_id: 'dp_1', stripe_charge_id: 'ch_1', status: 'needs_response' },
        error: null,
      },
      stripe_transactions: { data: { business_id: 'biz-1' }, error: null },
    });

    const res = await POST(req(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.dispute.status).toBe('lost');
    expect(disputeClose).toHaveBeenCalledWith('dp_1');
  });

  it('404 when the dispute does not exist', async () => {
    wire({ stripe_disputes: { data: null, error: { message: 'nope' } } });
    const res = await POST(req(), { params });
    expect(res.status).toBe(404);
  });

  it('409 when the dispute is no longer actionable', async () => {
    wire({
      stripe_disputes: {
        data: { id: 'dsp-1', merchant_id: 'user-1', stripe_dispute_id: 'dp_1', stripe_charge_id: 'ch_1', status: 'won' },
        error: null,
      },
      stripe_transactions: { data: { business_id: 'biz-1' }, error: null },
    });
    const res = await POST(req(), { params });
    expect(res.status).toBe(409);
    expect(disputeClose).not.toHaveBeenCalled();
  });

  it('403 when the caller lacks funds.move on the owning business', async () => {
    (authorizeBusinessOwner as any).mockResolvedValue({ ok: false, status: 403, error: 'Insufficient permissions' });
    wire({
      stripe_disputes: {
        data: { id: 'dsp-1', merchant_id: 'owner-x', stripe_dispute_id: 'dp_1', stripe_charge_id: 'ch_1', status: 'needs_response' },
        error: null,
      },
      stripe_transactions: { data: { business_id: 'biz-1' }, error: null },
    });
    const res = await POST(req(), { params });
    expect(res.status).toBe(403);
    expect(disputeClose).not.toHaveBeenCalled();
  });

  it('404 when unmappable charge and caller is not the dispute owner', async () => {
    wire({
      stripe_disputes: {
        data: { id: 'dsp-1', merchant_id: 'someone-else', stripe_dispute_id: 'dp_1', stripe_charge_id: null, status: 'needs_response' },
        error: null,
      },
    });
    const res = await POST(req(), { params });
    expect(res.status).toBe(404);
    expect(disputeClose).not.toHaveBeenCalled();
  });
});
