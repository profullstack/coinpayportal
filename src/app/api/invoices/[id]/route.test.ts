import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Role } from '@/lib/auth/permissions';

const mock = vi.hoisted(() => ({ from: vi.fn(), authorize: vi.fn(), funds: vi.fn(), payee: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: mock.from }) }));
vi.mock('@/lib/auth/invoice-access', () => ({ authorizeInvoice: mock.authorize }));
vi.mock('@/lib/auth/authz', () => ({ authorizeBusiness: mock.funds }));
vi.mock('@/lib/payments/payee', () => ({ resolvePayee: mock.payee }));
import { PUT } from './route';

const original = { id: 'invoice-1', business_id: 'business-1', user_id: 'owner-1', status: 'draft',
  crypto_currency: 'ETH', merchant_wallet_address: 'wallet-a', updated_at: '2026-09-07T00:00:00.000Z',
  metadata: { source_reference: { provider: 'github' } } };
let query: any;
let payload: any;
function access(role: Role | null = 'owner', apiKeyBusinessId: string | null = null, invoice: any = original) {
  mock.authorize.mockResolvedValue({ ok: true, merchantId: role === 'owner' ? 'owner-1' : 'writer-1', role, apiKeyBusinessId, invoice });
}
async function put(body: any) {
  return PUT(new NextRequest('http://localhost/api/invoices/invoice-1', { method: 'PUT',
    headers: { authorization: 'Bearer synthetic-unit', 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  { params: Promise.resolve({ id: original.id }) });
}

describe('PUT /api/invoices/[id] payout and concurrency boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    payload = null;
    query = { eq: vi.fn(() => query), is: vi.fn(() => query), select: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: { ...original, ...payload }, error: null })) };
    mock.from.mockReturnValue({ update: vi.fn((input) => { payload = input; return query; }) });
    mock.funds.mockResolvedValue({ ok: true, role: 'owner' });
    mock.payee.mockResolvedValue({ ok: true, address: 'wallet-b', source: 'manual' });
    access();
  });

  it.each(['writer', 'admin'] as Role[])('denies %s explicit payout overrides before payee lookup or SQL update', async (role) => {
    access(role);
    mock.funds.mockResolvedValue({ ok: false, status: 403, error: 'Insufficient permissions' });
    expect((await put({ merchant_wallet_address: 'wallet-b' })).status).toBe(403);
    expect(mock.funds).toHaveBeenCalledWith(expect.anything(), 'writer-1', original.business_id, 'funds.move');
    expect(mock.payee).not.toHaveBeenCalled();
    expect(mock.from).not.toHaveBeenCalled();
  });

  it('allows an owner override and preserves source metadata alongside a server revision', async () => {
    expect((await put({ merchant_wallet_address: 'wallet-b', metadata: { invoice_edit_revision: 'attacker' } })).status).toBe(200);
    expect(payload.merchant_wallet_address).toBe('wallet-b');
    expect(payload.metadata.source_reference).toEqual(original.metadata.source_reference);
    expect(payload.metadata.invoice_edit_revision).toMatch(/^[a-f\d-]{36}$/);
    expect(query.eq).toHaveBeenCalledWith('id', original.id);
    expect(query.eq).toHaveBeenCalledWith('status', original.status);
    expect(query.eq).toHaveBeenCalledWith('updated_at', original.updated_at);
    expect(query.eq).toHaveBeenCalledWith('metadata', JSON.stringify(original.metadata));
  });

  it('keeps the existing business API key permission model', async () => {
    access(null, original.business_id);
    expect((await put({ merchant_wallet_address: 'wallet-b' })).status).toBe(200);
    expect(mock.funds).not.toHaveBeenCalled();
  });

  it('still lets a writer edit notes without requesting funds.move', async () => {
    access('writer');
    expect((await put({ notes: 'updated description' })).status).toBe(200);
    expect(mock.funds).not.toHaveBeenCalled();
    expect(payload.metadata.invoice_edit_revision).toMatch(/^[a-f\d-]{36}$/);
  });

  it.each([403, 404])('preserves invoice-access denial %s', async (status) => {
    mock.authorize.mockResolvedValue({ ok: false, status, error: 'Denied' });
    expect((await put({ notes: 'not allowed' })).status).toBe(status);
    expect(mock.from).not.toHaveBeenCalled();
  });

  it('returns a retryable conflict when a concurrent edit or publish won the write', async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    const response = await put({ amount: 21 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'INVOICE_STATE_CHANGED' });
  });

  it('uses nullable legacy metadata and timestamp comparisons', async () => {
    access('owner', null, { ...original, metadata: null, updated_at: null });
    expect((await put({ notes: 'legacy edit' })).status).toBe(200);
    expect(query.is).toHaveBeenCalledWith('metadata', null);
    expect(query.is).toHaveBeenCalledWith('updated_at', null);
  });

  it('does not rewrite a sent invoice payout or rotate its payment revision', async () => {
    access('owner', null, { ...original, status: 'sent' });
    expect((await put({ merchant_wallet_address: 'wallet-b', amount: 21 })).status).toBe(200);
    expect(payload).not.toHaveProperty('merchant_wallet_address');
    expect(payload).not.toHaveProperty('amount');
    expect(payload).not.toHaveProperty('metadata');
    expect(query.eq).toHaveBeenCalledWith('status', 'sent');
  });
});
