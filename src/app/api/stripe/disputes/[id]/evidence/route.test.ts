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
  for (const m of ['select', 'eq', 'maybeSingle', 'single', 'update']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: any) => Promise.resolve(value).then(resolve);
  return chain;
}

const disputesUpdate = vi.fn();
const filesCreate = vi.fn();
const params = Promise.resolve({ id: 'dsp-1' });

function reqWith(form: FormData) {
  return new NextRequest('http://localhost/api/stripe/disputes/dsp-1/evidence', {
    method: 'POST',
    headers: { authorization: 'Bearer valid' },
    body: form,
  });
}

function wire(tables: Record<string, { data: any; error: any }>) {
  mockFrom.mockImplementation((table: string) => makeChain(tables[table] ?? { data: null, error: null }));
}

const actionableDispute = {
  stripe_disputes: {
    data: { id: 'dsp-1', merchant_id: 'user-1', stripe_dispute_id: 'dp_1', stripe_charge_id: 'ch_1', status: 'needs_response' },
    error: null,
  },
  stripe_transactions: { data: { business_id: 'biz-1' }, error: null },
};

describe('POST /api/stripe/disputes/[id]/evidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    (verifyToken as any).mockReturnValue({ userId: 'user-1' });
    (authorizeBusinessOwner as any).mockResolvedValue({ ok: true, role: 'owner', ownerId: 'user-1' });
    disputesUpdate.mockResolvedValue({ id: 'dp_1', status: 'under_review' });
    filesCreate.mockResolvedValue({ id: 'file_1' });
    (getStripe as any).mockResolvedValue({ disputes: { update: disputesUpdate }, files: { create: filesCreate } });
  });

  it('submits text evidence to Stripe', async () => {
    wire(actionableDispute);
    const form = new FormData();
    form.set('product_description', 'Annual SaaS subscription');
    form.set('uncategorized_text', 'Customer logged in and used the product for 3 months.');

    const res = await POST(reqWith(form), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(disputesUpdate).toHaveBeenCalledWith(
      'dp_1',
      expect.objectContaining({
        submit: true,
        evidence: expect.objectContaining({ product_description: 'Annual SaaS subscription' }),
      })
    );
    expect(filesCreate).not.toHaveBeenCalled();
  });

  it('uploads a file and references it in the evidence', async () => {
    wire(actionableDispute);
    const form = new FormData();
    form.set('product_description', 'Widget');
    form.set('receipt', new File([new Uint8Array([1, 2, 3])], 'receipt.pdf', { type: 'application/pdf' }));

    const res = await POST(reqWith(form), { params });
    expect(res.status).toBe(200);
    expect(filesCreate).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'dispute_evidence' }));
    expect(disputesUpdate).toHaveBeenCalledWith(
      'dp_1',
      expect.objectContaining({ evidence: expect.objectContaining({ receipt: 'file_1' }) })
    );
  });

  it('400 when no evidence provided', async () => {
    wire(actionableDispute);
    const res = await POST(reqWith(new FormData()), { params });
    expect(res.status).toBe(400);
    expect(disputesUpdate).not.toHaveBeenCalled();
  });

  it('400 when a file is the wrong type', async () => {
    wire(actionableDispute);
    const form = new FormData();
    form.set('receipt', new File([new Uint8Array([1])], 'evil.exe', { type: 'application/x-msdownload' }));
    const res = await POST(reqWith(form), { params });
    expect(res.status).toBe(400);
    expect(filesCreate).not.toHaveBeenCalled();
  });

  it('409 when the dispute is no longer actionable', async () => {
    wire({
      stripe_disputes: {
        data: { id: 'dsp-1', merchant_id: 'user-1', stripe_dispute_id: 'dp_1', stripe_charge_id: 'ch_1', status: 'won' },
        error: null,
      },
      stripe_transactions: { data: { business_id: 'biz-1' }, error: null },
    });
    const form = new FormData();
    form.set('product_description', 'x');
    const res = await POST(reqWith(form), { params });
    expect(res.status).toBe(409);
    expect(disputesUpdate).not.toHaveBeenCalled();
  });

  it('403 when the caller lacks funds.move', async () => {
    (authorizeBusinessOwner as any).mockResolvedValue({ ok: false, status: 403, error: 'Insufficient permissions' });
    wire(actionableDispute);
    const form = new FormData();
    form.set('product_description', 'x');
    const res = await POST(reqWith(form), { params });
    expect(res.status).toBe(403);
    expect(disputesUpdate).not.toHaveBeenCalled();
  });

  it('404 when the dispute does not exist', async () => {
    wire({ stripe_disputes: { data: null, error: { message: 'nope' } } });
    const form = new FormData();
    form.set('product_description', 'x');
    const res = await POST(reqWith(form), { params });
    expect(res.status).toBe(404);
  });
});
