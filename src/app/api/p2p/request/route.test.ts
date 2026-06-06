import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/payments/fees', () => ({
  getFeePercentage: vi.fn(() => 0.01),
}));

vi.mock('@/lib/entitlements/service', () => ({
  isBusinessPaidTier: vi.fn(async () => false),
}));

vi.mock('@/lib/wallets/system-wallet', () => ({
  generatePaymentAddress: vi.fn(async () => ({ success: true, address: 'bc1qstub' })),
}));

vi.mock('@/lib/rates/tatum', () => ({
  getCryptoPrice: vi.fn(async () => 0.0005),
}));

vi.mock('@/lib/payments/service', () => ({
  createPayment: vi.fn(async () => ({
    success: true,
    payment: {
      id: 'pay-p2p-1',
      payment_address: 'bc1qcoinpaymiddleman',
      crypto_amount: 0.0005,
    },
  })),
}));

vi.mock('@/lib/server/optional-deps', () => ({
  getStripe: vi.fn(),
}));

import { createClient } from '@supabase/supabase-js';
import { createPayment } from '@/lib/payments/service';
import { POST } from './route';

const PLATFORM_KEY = 'rp_test_' + 'a'.repeat(32);

function postRequest(body: unknown, authKey: string | null = PLATFORM_KEY) {
  return new NextRequest('http://localhost/api/p2p/request', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authKey ? { authorization: `Bearer ${authKey}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function validBody() {
  return {
    payee: {
      did: 'did:ugig:alice',
      email: 'alice@ugig.net',
      name: 'Alice',
      payout: { crypto: { currency: 'BTC', address: 'bc1qpayeeaddr' } },
    },
    payer: { did: 'did:ugig:bob', email: 'bob@ugig.net', name: 'Bob' },
    amount_usd: 100,
    notes: 'Web design work',
  };
}

type SupabaseStub = ReturnType<typeof buildStub>;

function buildStub({ existingBusiness = false }: { existingBusiness?: boolean } = {}) {
  const calls: Array<{ table: string; op: string; payload?: unknown }> = [];

  const businessRow = existingBusiness
    ? { id: 'biz-existing', merchant_id: 'merchant-existing' }
    : null;

  function chain(table: string, response: { data: unknown; error: unknown }) {
    const builder: any = {
      _table: table,
      _filters: {} as Record<string, unknown>,
      select: vi.fn(() => builder),
      eq: vi.fn((col: string, val: unknown) => {
        builder._filters[col] = val;
        return builder;
      }),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => response),
      single: vi.fn(async () => response),
    };
    return builder;
  }

  const supabase: any = {
    from: vi.fn((table: string) => {
      if (table === 'businesses') {
        const inserter: any = {
          select: vi.fn(() => inserter),
          single: vi.fn(async () => ({
            data: { id: 'biz-new', merchant_id: 'merchant-new' },
            error: null,
          })),
        };
        const builder = chain('businesses', { data: businessRow, error: null });
        builder.insert = vi.fn((payload: unknown) => {
          calls.push({ table, op: 'insert', payload });
          return inserter;
        });
        return builder;
      }
      if (table === 'merchant_dids') {
        const builder = chain('merchant_dids', { data: null, error: null });
        builder.insert = vi.fn((payload: unknown) => {
          calls.push({ table, op: 'insert', payload });
          return { select: () => ({ single: async () => ({ data: null, error: null }) }) };
        });
        builder.update = vi.fn(() => ({ eq: vi.fn(async () => ({ data: null, error: null })) }));
        return builder;
      }
      if (table === 'merchants') {
        const inserter: any = {
          select: vi.fn(() => inserter),
          single: vi.fn(async () => ({ data: { id: 'merchant-new' }, error: null })),
        };
        const builder = chain('merchants', { data: null, error: null });
        builder.insert = vi.fn((payload: unknown) => {
          calls.push({ table, op: 'insert', payload });
          return inserter;
        });
        return builder;
      }
      if (table === 'merchant_wallets') {
        return {
          upsert: vi.fn(async (payload: unknown) => {
            calls.push({ table, op: 'upsert', payload });
            return { data: null, error: null };
          }),
        };
      }
      if (table === 'stripe_accounts') {
        return {
          upsert: vi.fn(async (payload: unknown) => {
            calls.push({ table, op: 'upsert', payload });
            return { data: null, error: null };
          }),
        };
      }
      if (table === 'clients') {
        const inserter: any = {
          select: vi.fn(() => inserter),
          single: vi.fn(async () => ({ data: { id: 'client-1' }, error: null })),
        };
        const builder = chain('clients', { data: null, error: null });
        builder.insert = vi.fn((payload: unknown) => {
          calls.push({ table, op: 'insert', payload });
          return inserter;
        });
        return builder;
      }
      if (table === 'invoices') {
        const inserter: any = {
          select: vi.fn(() => inserter),
          single: vi.fn(async () => ({
            data: { id: 'inv-1', invoice_number: 'INV-001' },
            error: null,
          })),
        };
        const builder = chain('invoices', { data: null, error: null });
        builder.insert = vi.fn((payload: unknown) => {
          calls.push({ table, op: 'insert', payload });
          return inserter;
        });
        builder.update = vi.fn(() => ({ eq: vi.fn(async () => ({ data: null, error: null })) }));
        return builder;
      }
      if (table === 'reputation_issuers') {
        return chain('reputation_issuers', {
          data: { did: 'did:web:ugig.net', name: 'ugig.net' },
          error: null,
        });
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return { supabase, calls };
}

describe('POST /api/p2p/request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createPayment).mockResolvedValue({
      success: true,
      payment: {
        id: 'pay-p2p-1',
        payment_address: 'bc1qcoinpaymiddleman',
        crypto_amount: 0.0005,
      } as any,
    });
  });

  it('rejects requests without a platform API key', async () => {
    const stub = buildStub();
    (createClient as any).mockReturnValue(stub.supabase);
    const res = await POST(postRequest(validBody(), null));
    expect(res.status).toBe(401);
  });

  it('rejects requests with an unknown API key', async () => {
    const stub = buildStub();
    // Override reputation_issuers to return null
    stub.supabase.from = vi.fn((table: string) => {
      if (table === 'reputation_issuers') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });
    (createClient as any).mockReturnValue(stub.supabase);
    const res = await POST(postRequest(validBody()));
    expect(res.status).toBe(401);
  });

  it('rejects malformed bodies', async () => {
    const stub = buildStub();
    (createClient as any).mockReturnValue(stub.supabase);
    const res = await POST(postRequest({ amount_usd: -1 }));
    expect(res.status).toBe(400);
  });

  it('provisions a new merchant + business on first request and creates an invoice with 1% fee', async () => {
    const stub = buildStub({ existingBusiness: false });
    (createClient as any).mockReturnValue(stub.supabase);

    const res = await POST(postRequest(validBody()));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      invoice_id: 'inv-1',
      invoice_number: 'INV-001',
      fee_rate: 0.01,
      fee_amount_usd: 1,
      payment_address: 'bc1qcoinpaymiddleman',
      crypto_amount: '0.00050000',
    });
    expect(body.pay_url).toMatch(/\/invoices\/inv-1\/pay$/);

    const inserts = stub.calls.filter(c => c.op === 'insert').map(c => c.table);
    expect(inserts).toEqual(expect.arrayContaining(['merchants', 'businesses', 'clients', 'invoices']));

    const businessInsert = stub.calls.find(c => c.table === 'businesses' && c.op === 'insert')!;
    expect(businessInsert.payload).toMatchObject({
      platform: 'ugig.net',
      external_user_did: 'did:ugig:alice',
      auto_provisioned: true,
    });

    const invoiceInsert = stub.calls.find(c => c.table === 'invoices' && c.op === 'insert')!;
    expect(invoiceInsert.payload).toMatchObject({
      amount: 100,
      currency: 'USD',
      fee_rate: 0.01,
      fee_amount: 1,
      status: 'sent',
    });
    expect(createPayment).toHaveBeenCalledWith(stub.supabase, expect.objectContaining({
      amount: 100,
      blockchain: 'BTC',
      merchant_wallet_address: 'bc1qpayeeaddr',
      metadata: expect.objectContaining({
        source: 'p2p_invoice',
        invoice_id: 'inv-1',
        invoice_number: 'INV-001',
      }),
    }));
  });

  it('reuses the existing merchant + business on a repeat request', async () => {
    const stub = buildStub({ existingBusiness: true });
    (createClient as any).mockReturnValue(stub.supabase);

    const res = await POST(postRequest(validBody()));
    expect(res.status).toBe(201);

    const inserts = stub.calls.filter(c => c.op === 'insert').map(c => c.table);
    expect(inserts).not.toContain('merchants');
    expect(inserts).not.toContain('businesses');
    expect(inserts).toContain('invoices');
  });
});
