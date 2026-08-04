import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/jwt', () => ({
  verifyToken: vi.fn().mockReturnValue({ userId: 'merch-1' }),
}));

vi.mock('@/lib/secrets', () => ({
  getJwtSecret: vi.fn().mockReturnValue('test-secret'),
}));

const mockFrom = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

const mockAuthorizeBusiness = vi.fn();

vi.mock('@/lib/auth/merchant', () => ({
  resolveMerchant: vi.fn().mockResolvedValue({ merchantId: 'merch-1', apiKeyBusinessId: null }),
}));
vi.mock('@/lib/auth/authz', () => ({
  authorizeBusiness: (...args: any[]) => mockAuthorizeBusiness(...args),
}));

import { GET, PATCH, DELETE } from './route';

const SCHEDULE = {
  id: 'sched-1',
  invoice_id: 'inv-1',
  recurrence: 'monthly',
  active: true,
  occurrences_count: 2,
};

type Ctx = { table: string; op: string; payload?: any; filters: Record<string, any> };

let recorded: Ctx[] = [];

function installSupabase(opts: { scheduleRows?: any[] } = {}) {
  mockFrom.mockImplementation((table: string) => {
    const ctx: Ctx = { table, op: 'select', filters: {} };
    recorded.push(ctx);
    const builder: any = {
      select: () => builder,
      update: (payload: any) => { ctx.op = 'update'; ctx.payload = payload; return builder; },
      delete: () => { ctx.op = 'delete'; return builder; },
      eq: (col: string, val: any) => { ctx.filters[col] = val; return builder; },
      order: () => builder,
      single: () => builder,
      then: (resolve: any, reject: any) => {
        let result: any = { data: null, error: null };
        if (ctx.table === 'invoices') {
          result = { data: { id: 'inv-1', business_id: 'biz-1' }, error: null };
        } else if (ctx.table === 'invoice_schedules') {
          result = { data: opts.scheduleRows ?? [SCHEDULE], error: null };
        }
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return builder;
  });
}

function makeRequest(method: string, body?: any): NextRequest {
  return new NextRequest('http://localhost/api/invoices/inv-1/schedule', {
    method,
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

const params = Promise.resolve({ id: 'inv-1' });

beforeEach(() => {
  vi.clearAllMocks();
  recorded = [];
  mockAuthorizeBusiness.mockResolvedValue({ ok: true, role: 'owner' });
  installSupabase();
});

describe('PATCH /api/invoices/[id]/schedule', () => {
  it('pauses a schedule', async () => {
    const res = await PATCH(makeRequest('PATCH', { active: false }), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);

    const update = recorded.find(c => c.table === 'invoice_schedules' && c.op === 'update');
    expect(update?.payload).toEqual({ active: false });
    // Always scoped to this invoice, so a foreign schedule_id cannot be reached.
    expect(update?.filters.invoice_id).toBe('inv-1');
  });

  it('scopes a targeted schedule_id to the invoice as well', async () => {
    await PATCH(makeRequest('PATCH', { active: false, schedule_id: 'sched-other' }), { params });

    const update = recorded.find(c => c.table === 'invoice_schedules' && c.op === 'update');
    expect(update?.filters).toEqual({ invoice_id: 'inv-1', id: 'sched-other' });
  });

  it('rejects a non-boolean active', async () => {
    const res = await PATCH(makeRequest('PATCH', { active: 'yes' }), { params });
    expect(res.status).toBe(400);
  });

  it('rejects an empty update', async () => {
    const res = await PATCH(makeRequest('PATCH', {}), { params });
    expect(res.status).toBe(400);
  });

  it('rejects a non-positive max_occurrences', async () => {
    const res = await PATCH(makeRequest('PATCH', { max_occurrences: 0 }), { params });
    expect(res.status).toBe(400);
  });

  it('404s when the invoice has no matching schedule', async () => {
    installSupabase({ scheduleRows: [] });
    const res = await PATCH(makeRequest('PATCH', { active: false }), { params });
    expect(res.status).toBe(404);
  });

  it('refuses a caller without write access to the business', async () => {
    mockAuthorizeBusiness.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' });
    const res = await PATCH(makeRequest('PATCH', { active: false }), { params });

    expect(res.status).toBe(403);
    expect(recorded.some(c => c.table === 'invoice_schedules')).toBe(false);
  });

  it('hides existence from a caller with no access at all', async () => {
    mockAuthorizeBusiness.mockResolvedValue({ ok: false, status: 404, error: 'Not found' });
    const res = await PATCH(makeRequest('PATCH', { active: false }), { params });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/invoices/[id]/schedule', () => {
  it('lists the schedules on the invoice', async () => {
    const res = await GET(makeRequest('GET'), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.schedules).toHaveLength(1);
    expect(json.schedules[0].id).toBe('sched-1');
  });
});

describe('DELETE /api/invoices/[id]/schedule', () => {
  it('removes the recurrence for the invoice', async () => {
    const res = await DELETE(makeRequest('DELETE'), { params });
    expect(res.status).toBe(200);

    const del = recorded.find(c => c.table === 'invoice_schedules' && c.op === 'delete');
    expect(del?.filters.invoice_id).toBe('inv-1');
  });

  it('refuses a caller without write access', async () => {
    mockAuthorizeBusiness.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' });
    const res = await DELETE(makeRequest('DELETE'), { params });

    expect(res.status).toBe(403);
    expect(recorded.some(c => c.table === 'invoice_schedules')).toBe(false);
  });
});
