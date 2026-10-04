import { beforeEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { creationIdentity } from '@/lib/invoices/creation';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  auth: vi.fn(),
  authorize: vi.fn(),
  payee: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));
vi.mock('@/lib/auth/merchant', () => ({ resolveMerchant: mocks.auth }));
vi.mock('@/lib/auth/authz', () => ({ authorizeBusiness: mocks.authorize }));
vi.mock('@/lib/payments/payee', () => ({ resolvePayee: mocks.payee }));
vi.mock('@/lib/entitlements/service', () => ({ isBusinessPaidTier: async () => false }));
vi.mock('@/lib/payments/fees', () => ({ getFeePercentage: () => 0.01 }));

function request(body: unknown, key = 'github:1') {
  return new NextRequest('http://localhost/api/invoices', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(body),
  });
}
function query(value: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(value),
    maybeSingle: vi.fn().mockResolvedValue(value),
  };
}
describe('idempotent POST /api/invoices', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ merchantId: 'owner', apiKeyBusinessId: 'business' });
    mocks.authorize.mockResolvedValue({ ok: true });
  });
  it('uses atomic creation and stores a bounded source reference', async () => {
    const source_reference = {
      provider: 'github',
      repository: 'owner/repo',
      thread_number: 1,
      comment_id: 2,
      actor_id: 3,
      actor_login: 'author',
      payer_login: 'payer',
    };
    mocks.from.mockImplementation((table) => {
      if (table === 'invoice_creation_requests') return query({ data: null, error: null });
      if (table === 'businesses')
        return query({ data: { id: 'business', merchant_id: 'owner' }, error: null });
      if (table === 'invoices')
        return query({ data: { id: 'invoice', status: 'draft' }, error: null });
      throw new Error('unexpected table: ' + table);
    });
    mocks.rpc.mockResolvedValue({
      data: [{ invoice_id: 'invoice', replayed: false }],
      error: null,
    });
    const result = await POST(request({ amount: 10, notes: 'Work', source_reference }));
    expect(result.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'create_idempotent_invoice',
      expect.objectContaining({
        p_business_id: 'business',
        p_key: 'github:1',
        p_request_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        p_repository_hourly_limit: 20,
        p_invoice: expect.objectContaining({ status: 'draft', metadata: { source_reference } }),
      })
    );
  });
  it('replays before resolving current payee/defaults and does not insert again', async () => {
    const body = { amount: 10, crypto_currency: 'SOL' };
    const hash = creationIdentity('github:1', body).hash;
    mocks.from.mockImplementation((table) => {
      if (table === 'invoice_creation_requests')
        return query({ data: { request_hash: hash, invoice_id: 'invoice' }, error: null });
      if (table === 'invoices')
        return query({ data: { id: 'invoice', status: 'sent' }, error: null });
      throw new Error('unexpected lookup after replay');
    });
    const result = await POST(request(body));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      idempotentReplay: true,
      invoice: { status: 'sent' },
    });
    expect(mocks.payee).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('returns conflict when the same key carries different terms', async () => {
    mocks.from.mockReturnValue(
      query({ data: { request_hash: 'other', invoice_id: 'invoice' }, error: null })
    );
    expect((await POST(request({ amount: 10 }))).status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('requires authorization before looking up a replay', async () => {
    mocks.auth.mockResolvedValue({ merchantId: 'reader' });
    mocks.authorize.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' });
    expect((await POST(request({ business_id: 'business', amount: 10 }))).status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('never accesses another API key business', async () => {
    expect((await POST(request({ business_id: 'other', amount: 10 }))).status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('does not let writers replay an owner-only payout override', async () => {
    mocks.auth.mockResolvedValue({ merchantId: 'writer' });
    mocks.authorize
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, status: 403 });
    const result = await POST(
      request({ business_id: 'business', amount: 10, merchant_wallet_address: 'untrusted-wallet' })
    );
    expect(result.status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([null, [], 'text', { amount: 1.001 }])('rejects invalid JSON body %j', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('fails closed when the migration is missing', async () => {
    mocks.from.mockReturnValue(query({ data: null, error: { code: '42P01' } }));
    expect((await POST(request({ amount: 10 }))).status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
