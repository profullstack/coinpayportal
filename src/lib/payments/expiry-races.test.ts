import { readFileSync } from 'node:fs';
import { randomUUID, webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  client: vi.fn(), balance: vi.fn(), webhook: vi.fn(), forward: vi.fn(),
  cronWebhook: vi.fn(), collectionForward: vi.fn(), activate: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.client }));
vi.mock('@/lib/auth/payment-access', () => ({ authorizePaymentAccess: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/web-wallet/rate-limit', () => ({ checkRateLimitAsync: vi.fn(async () => ({ allowed: true })) }));
vi.mock('@/app/api/cron/monitor-payments/balance-checkers', () => ({ checkBalance: mocks.balance }));
vi.mock('@/lib/webhooks/service', () => ({ sendPaymentWebhook: mocks.webhook }));
vi.mock('@/lib/wallets/secure-forwarding', () => ({ forwardPaymentSecurely: mocks.forward }));
vi.mock('@/app/api/cron/monitor-payments/webhook', () => ({ sendWebhook: mocks.cronWebhook }));
vi.mock('@/lib/payments/business-collection', () => ({ processConfirmedBusinessCollectionPayment: mocks.collectionForward }));
vi.mock('@/lib/subscriptions/service', () => ({ handleSubscriptionPaymentConfirmed: mocks.activate }));

import { POST } from '@/app/api/payments/[id]/check-balance/route';
import { monitorPayments } from '@/app/api/cron/monitor-payments/payment-monitor';

const now = new Date('2026-09-08T01:00:00Z');
type Row = Record<string, unknown>;
function payment(address: string | null = 'synthetic-address'): Row {
  return { id: 'synthetic-payment', business_id: 'synthetic-business', status: 'pending',
    payment_address: address, blockchain: 'ETH', crypto_amount: '1', amount: 20,
    expires_at: '2026-09-08T00:00:00Z', created_at: '2026-09-07T23:45:00Z' };
}

// Read snapshots are copied; the database row may change before an UPDATE executes.
// Unlike a call-shape mock, this evaluates the actual equality predicates supplied
// by each handler, so removing a status predicate makes the race tests fail.
function database(row: Row, options: { table?: string; competingStatus?: string; writeError?: boolean; readErrorAfterRace?: boolean } = {}) {
  const tableName = options.table ?? 'payments';
  let raced = false;
  const reads: string[] = [];
  const writes: Array<{ table: string; values: Row; predicates: Array<[string, unknown]>; affected: number }> = [];
  const client = {
    from(table: string) {
      let values: Row | undefined;
      let plural = true;
      let historical = false;
      const predicates: Array<[string, unknown]> = [];
      const query = {
        select() { return query; },
        update(next: Row) { values = next; return query; },
        eq(key: string, value: unknown) { predicates.push([key, value]); return query; },
        in() { historical = true; return query; },
        not() { return query; }, neq() { return query; }, gte() { return query; },
        lte() { return query; }, order() { return query; }, limit() { return query; },
        single() { plural = false; return query; },
        maybeSingle() { plural = false; return query; },
        then(onFulfilled: (value: { data: Row[] | Row | null; error: Error | null }) => unknown, onRejected?: (reason: unknown) => unknown) {
          if (values) {
            if (table === tableName && !raced && options.competingStatus) {
              row.status = options.competingStatus;
              raced = true;
            }
            if (options.writeError) return Promise.resolve({ data: null, error: new Error('synthetic database failure') }).then(onFulfilled, onRejected);
            const match = table === tableName && predicates.every(([key, value]) => row[key] === value);
            if (match) Object.assign(row, values);
            writes.push({ table, values, predicates, affected: Number(match) });
            return Promise.resolve({ data: plural ? (match ? [{ ...row }] : []) : (match ? { ...row } : null), error: null }).then(onFulfilled, onRejected);
          }
          reads.push(table);
          if (raced && options.readErrorAfterRace) return Promise.resolve({ data: null, error: new Error('synthetic read failure') }).then(onFulfilled, onRejected);
          const match = !historical && table === tableName && predicates.every(([key, value]) => row[key] === value);
          return Promise.resolve({ data: plural ? (match ? [{ ...row }] : []) : (match ? { ...row } : null), error: null }).then(onFulfilled, onRejected);
        },
      };
      return query;
    },
  };
  return { client: client as unknown as SupabaseClient, row, reads, writes };
}

async function callRoute() {
  return POST(new Request('http://localhost/api/payments/synthetic-payment/check-balance', { method: 'POST' }) as NextRequest,
    { params: Promise.resolve({ id: 'synthetic-payment' }) });
}

// Execute the actual edge entrypoint with its Deno/server and Supabase transport
// supplied locally. This is handler coverage, not a Deno deployment/runtime test.
function edgeHandler(client: SupabaseClient, rpcBalance?: string) {
  const cronSecret = randomUUID();
  const serviceToken = randomUUID();
  let handler: ((request: Request) => Promise<Response>) | undefined;
  const source = readFileSync(new URL('../../../supabase/functions/monitor-payments/index.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  class FixedDate extends Date {
    constructor(value?: string | number) { super(value ?? now.getTime()); }
    static now() { return now.getTime(); }
  }
  runInNewContext(code, {
    exports: {}, Response, Request, TextEncoder, crypto: webcrypto, console, Date: FixedDate,
    require: (name: string) => {
      if (name !== 'https://esm.sh/@supabase/supabase-js@2') throw new Error(`Unexpected import: ${name}`);
      return { createClient: () => client };
    },
    fetch: vi.fn(async () => {
      if (rpcBalance === undefined) throw new Error('External transport forbidden');
      return Response.json({ result: rpcBalance });
    }),
    Deno: {
      env: { get: (key: string) => ({ CRON_SECRET: cronSecret, SUPABASE_SERVICE_ROLE_KEY: serviceToken, SUPABASE_URL: 'http://localhost' } as Record<string, string>)[key] },
      serve: (callback: typeof handler) => { handler = callback; },
    },
  });
  if (!handler) throw new Error('Edge handler not registered');
  return () => handler!(new Request('http://localhost/monitor', { method: 'POST', headers: { Authorization: `Bearer ${cronSecret}` } }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('INTERNAL_API_KEY', '');
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('External transport forbidden'); }));
  mocks.balance.mockResolvedValue(0);
  mocks.webhook.mockResolvedValue(undefined);
  mocks.cronWebhook.mockResolvedValue(undefined);
  mocks.forward.mockResolvedValue({ success: true });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('actual numeric balance oracle failures do not expire payments', () => {
  it.each(['http', 'malformed', 'timeout'])('HTTP keeps an overdue payment pending on %s failure', async failure => {
    const oracle = await vi.importActual<typeof import('@/app/api/cron/monitor-payments/balance-checkers')>('@/app/api/cron/monitor-payments/balance-checkers');
    mocks.balance.mockImplementation(oracle.checkBalance);
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (failure === 'timeout') throw new Error('synthetic timeout');
      return failure === 'http' ? new Response('', { status: 503 }) : Response.json({});
    }));
    const db = database(payment()); mocks.client.mockReturnValue(db.client);
    const response = await callRoute();
    expect(response.status).toBe(500);
    expect(db.row.status).toBe('pending');
    expect(db.writes).toHaveLength(0);
    expect(mocks.forward).not.toHaveBeenCalled();
    expect(mocks.webhook).not.toHaveBeenCalled();
  });
  it.each(['payments', 'business_collection_payments'])('cron leaves %s pending and counts an error on RPC failure', async table => {
    const oracle = await vi.importActual<typeof import('@/app/api/cron/monitor-payments/balance-checkers')>('@/app/api/cron/monitor-payments/balance-checkers');
    mocks.balance.mockImplementation(oracle.checkBalance);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    const db = database(payment(), { table });
    const stats = await monitorPayments(db.client, now);
    expect(db.row.status).toBe('pending');
    expect(db.writes).toHaveLength(0);
    expect(stats.expired).toBe(0);
    expect(stats.confirmed).toBe(0);
    expect(stats.errors).toBe(1);
    expect(mocks.cronWebhook).not.toHaveBeenCalled();
    expect(mocks.collectionForward).not.toHaveBeenCalled();
  });
});

describe('HTTP balance check uses the winning database state', () => {
  it.each(['forwarded', 'forwarding', 'confirmed', 'expired'])('preserves concurrent %s during addressed expiry', async status => {
    const db = database(payment(), { competingStatus: status });
    mocks.client.mockReturnValue(db.client);
    const response = await callRoute();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, status, balance: 0, expected: 1 });
    expect(db.row.status).toBe(status);
    expect(db.writes.every(write => write.affected === 0)).toBe(true);
    expect(mocks.webhook).not.toHaveBeenCalled();
    expect(mocks.forward).not.toHaveBeenCalled();
  });
  it('preserves concurrent confirmation when an addressless snapshot expires', async () => {
    const db = database(payment(null), { competingStatus: 'confirmed' });
    mocks.client.mockReturnValue(db.client);
    expect(await (await callRoute()).json()).toMatchObject({ status: 'confirmed' });
    expect(db.row.status).toBe('confirmed');
    expect(mocks.balance).not.toHaveBeenCalled();
  });
  it.each([0, 1])('reports database failures rather than successful status changes at balance %s', async balance => {
    const db = database(payment(), { writeError: true });
    mocks.client.mockReturnValue(db.client);
    mocks.balance.mockResolvedValue(balance);
    expect((await callRoute()).status).toBe(500);
    expect(db.row.status).toBe('pending');
    expect(mocks.webhook).not.toHaveBeenCalled();
    expect(mocks.forward).not.toHaveBeenCalled();
  });
  it.each(['forwarded', 'expired'])('does not claim confirmed after losing to %s', async status => {
    const db = database(payment(), { competingStatus: status });
    mocks.client.mockReturnValue(db.client);
    mocks.balance.mockResolvedValue(1);
    expect(await (await callRoute()).json()).toMatchObject({ status, balance: 1 });
    expect(db.row.status).toBe(status);
    expect(mocks.forward).not.toHaveBeenCalled();
  });
  it('does not guess a status if the post-race read fails', async () => {
    const db = database(payment(), { competingStatus: 'forwarded', readErrorAfterRace: true });
    mocks.client.mockReturnValue(db.client);
    mocks.balance.mockResolvedValue(1);
    expect((await callRoute()).status).toBe(500);
    expect(mocks.forward).not.toHaveBeenCalled();
  });
  it('still expires an unpaid pending payment', async () => {
    const db = database(payment());
    mocks.client.mockReturnValue(db.client);
    expect(await (await callRoute()).json()).toMatchObject({ status: 'expired' });
    expect(db.writes.filter(write => write.affected)).toHaveLength(1);
  });
  it('still confirms and notifies exactly once when it wins', async () => {
    const db = database(payment());
    mocks.client.mockReturnValue(db.client);
    mocks.balance.mockResolvedValue(1);
    expect(await (await callRoute()).json()).toMatchObject({ status: 'confirmed' });
    expect(mocks.webhook).toHaveBeenCalledTimes(1);
    expect(mocks.forward).toHaveBeenCalledTimes(1);
  });
});

describe('cron expiry and confirmation side effects require a successful claim', () => {
  it.each([null, 'synthetic-address'])('does not expire or notify a payment changed after a %s snapshot', async address => {
    const db = database(payment(address), { competingStatus: 'forwarded' });
    const stats = await monitorPayments(db.client, now);
    expect(db.row.status).toBe('forwarded');
    expect(stats).toEqual({ checked: 1, confirmed: 0, expired: 0, errors: 0 });
    expect(mocks.cronWebhook).not.toHaveBeenCalled();
  });
  it.each([null, 'synthetic-address'])('keeps a collection payment final after a %s snapshot', async address => {
    const db = database(payment(address), { table: 'business_collection_payments', competingStatus: 'forwarded' });
    const stats = await monitorPayments(db.client, now);
    expect(db.row.status).toBe('forwarded');
    expect(stats.errors).toBe(0);
    expect(mocks.collectionForward).not.toHaveBeenCalled();
    expect(mocks.activate).not.toHaveBeenCalled();
  });
  it.each([0, 1])('records database failure, not success, at balance %s', async balance => {
    const db = database(payment(), { writeError: true });
    mocks.balance.mockResolvedValue(balance);
    expect(await monitorPayments(db.client, now)).toEqual({ checked: 1, confirmed: 0, expired: 0, errors: 1 });
    expect(mocks.cronWebhook).not.toHaveBeenCalled();
  });
  it('does not increment confirmation statistics after a lost claim', async () => {
    const db = database(payment(), { competingStatus: 'forwarded' });
    mocks.balance.mockResolvedValue(1);
    expect(await monitorPayments(db.client, now)).toEqual({ checked: 1, confirmed: 0, expired: 0, errors: 0 });
    expect(mocks.cronWebhook).not.toHaveBeenCalled();
  });
  it.each([0, 1])('records collection database failures at balance %s without activating a plan', async balance => {
    const db = database(payment(), { table: 'business_collection_payments', writeError: true });
    mocks.balance.mockResolvedValue(balance);
    const stats = await monitorPayments(db.client, now);
    expect(stats.errors).toBe(1);
    expect(db.row.status).toBe('pending');
    expect(mocks.collectionForward).not.toHaveBeenCalled();
    expect(mocks.activate).not.toHaveBeenCalled();
  });
  it('still expires and notifies once for a pending unpaid row', async () => {
    const db = database(payment());
    expect(await monitorPayments(db.client, now)).toEqual({ checked: 1, confirmed: 0, expired: 1, errors: 0 });
    expect(db.row.status).toBe('expired');
    expect(mocks.cronWebhook).toHaveBeenCalledTimes(1);
  });
});

describe('edge monitor expiry respects concurrent settlement', () => {
  it.each(['forwarded', 'forwarding', 'confirmed'])('preserves %s and suppresses the stale expiry webhook', async status => {
    const db = database(payment(), { competingStatus: status });
    const response = await edgeHandler(db.client)();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ stats: { checked: 1, expired: 0, confirmed: 0, errors: 0 } });
    expect(db.row.status).toBe(status);
    expect(db.reads).not.toContain('businesses');
  });
  it('records an expiry write failure instead of sending a false webhook', async () => {
    const db = database(payment(), { writeError: true });
    const response = await edgeHandler(db.client)();
    expect(await response.json()).toMatchObject({ stats: { checked: 1, expired: 0, confirmed: 0, errors: 1 } });
    expect(db.row.status).toBe('pending');
    expect(db.reads).not.toContain('businesses');
  });
  it('still expires a pending row once when the write succeeds', async () => {
    const db = database(payment());
    const response = await edgeHandler(db.client)();
    expect(await response.json()).toMatchObject({ stats: { checked: 1, expired: 1, confirmed: 0, errors: 0 } });
    expect(db.row.status).toBe('expired');
    expect(db.writes.filter(write => write.affected)).toHaveLength(1);
  });
  it('records a failed confirmation claim without notifying', async () => {
    const row = { ...payment(), expires_at: new Date(now.getTime() + 60_000).toISOString() };
    const db = database(row, { writeError: true });
    const response = await edgeHandler(db.client, '0xde0b6b3a7640000')();
    expect(await response.json()).toMatchObject({ stats: { checked: 1, expired: 0, confirmed: 0, errors: 1 } });
    expect(db.row.status).toBe('pending');
    expect(db.reads).not.toContain('businesses');
  });
});
