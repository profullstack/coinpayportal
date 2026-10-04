import { describe, it, expect, vi } from 'vitest';
import {
  creationIdentity,
  findCreatedInvoice,
  createInvoiceOnce,
  loadCreatedInvoice,
} from './creation';

const source = {
  provider: 'github',
  repository: 'profullstack/example',
  thread_number: 10,
  comment_id: 20,
  actor_id: 30,
  actor_login: 'contributor',
  payer_login: 'owner',
};

describe('invoice creation identity', () => {
  it('leaves ordinary invoice creation compatible', () => {
    expect(creationIdentity(null, { amount: '10' })).toEqual({ source: undefined });
  });
  it('normalizes defaults and property order without mutable server state', () => {
    const a = creationIdentity('key', { amount: 10, source_reference: source });
    const b = creationIdentity('key', {
      source_reference: Object.fromEntries(Object.entries(source).reverse()),
      notes: null,
      amount: 10,
      currency: 'USD',
      business_id: 'derived',
      unknown: 'ignored',
    });
    expect(a.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(a.hash).toBe(b.hash);
  });
  it.each([
    { amount: 11 },
    { currency: 'EUR' },
    { notes: 'Different work' },
    { merchant_wallet_address: 'different-wallet' },
    { crypto_currency: 'SOL' },
    { source_reference: { ...source, payer_login: 'another' } },
    { schedule: { recurrence: 'weekly' } },
  ])('binds all requested terms: %j', (change) => {
    const original = { amount: 10, source_reference: source };
    expect(creationIdentity('key', original).hash).not.toBe(
      creationIdentity('key', { ...original, ...change }).hash
    );
  });
  it.each(['', ' ', 'x'.repeat(256), 'two words', 'line\nbreak', 'non-ascii-\u00e9'])(
    'rejects invalid key %j',
    (key) => {
      expect(() => creationIdentity(key, { amount: 10 })).toThrow(/Idempotency-Key/);
    }
  );
  it.each([0, -1, Infinity, NaN, '10', 1.001, 1e12, 1e-10, 1.0000001])(
    'rejects invalid amount %j',
    (amount) => {
      expect(() => creationIdentity('key', { amount })).toThrow();
    }
  );
  it.each([0.01, 0.29, 0.3, 999999999.99])('accepts exact currency amount %j', (amount) => {
    expect(creationIdentity('key', { amount }).hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([
    { ...source, actor_id: 0 },
    { ...source, repository: '../x' },
    { ...source, repository: 'owner/..' },
    { ...source, repository: 'owner/.' },
    { ...source, actor_login: '<script>' },
    { ...source, extra: 'unbounded' },
    'freeform data',
  ])('validates audit data even without a key', (source_reference) => {
    expect(() => creationIdentity(null, { amount: 10, source_reference })).toThrow(
      /source reference/
    );
  });
  it('bounds notes and rejects incomplete custom schedules', () => {
    expect(() => creationIdentity('key', { amount: 10, notes: 'x'.repeat(5001) })).toThrow();
    expect(() =>
      creationIdentity('key', { amount: 10, schedule: { recurrence: 'custom' } })
    ).toThrow();
  });
  it('bounds wallet input and schedule fields before the database casts them', () => {
    expect(() =>
      creationIdentity('key', {
        amount: 10,
        merchant_wallet_address: 'x'.repeat(513),
      })
    ).toThrow();
    for (const field of ['custom_interval_days', 'max_occurrences']) {
      expect(() =>
        creationIdentity('key', {
          amount: 10,
          schedule: { recurrence: 'weekly', [field]: 2147483648 },
        })
      ).toThrow();
      expect(
        creationIdentity('key', {
          amount: 10,
          schedule: { recurrence: 'weekly', [field]: 2147483647 },
        }).hash
      ).toMatch(/^[a-f0-9]{64}$/);
    }
  });
  it('validates source rate limits without changing retry identity', () => {
    const body = { amount: 10, source_reference: source };
    expect(creationIdentity('key', body).sourceRateLimit).toBe(20);
    expect(creationIdentity('key', { ...body, source_rate_limit: 10 }).hash).toBe(
      creationIdentity('key', body).hash
    );
    for (const source_rate_limit of [0, -1, 1.5, 1001, '20']) {
      expect(() => creationIdentity('key', { ...body, source_rate_limit })).toThrow();
    }
  });
});

function database(result: unknown) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  return { chain, client: { from: vi.fn(() => chain), rpc: vi.fn() } };
}

describe('stored creation replay', () => {
  it('logs only operation and bounded error codes, not invoice data or database messages', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const db = database({
        data: null,
        error: {
          code: '42P01',
          message: 'private wallet and invoice terms',
          details: 'private details',
        },
      });
      await expect(loadCreatedInvoice(db.client as any, 'biz', 'inv')).rejects.toMatchObject({
        status: 503,
      });
      expect(log).toHaveBeenLastCalledWith('Invoice creation database failure', {
        operation: 'load',
        code: '42P01',
      });
      db.chain.maybeSingle.mockResolvedValue({
        data: null,
        error: { code: 'secret injected text' },
      });
      await expect(
        findCreatedInvoice(db.client as any, 'biz', 'key', 'hash')
      ).rejects.toMatchObject({ status: 503 });
      expect(log).toHaveBeenLastCalledWith('Invoice creation database failure', {
        operation: 'lookup',
        code: 'UNKNOWN',
      });
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|secret/);
    } finally {
      log.mockRestore();
    }
  });
  it('fails closed if the migration or lookup is unavailable', async () => {
    const db = database({ data: null, error: { code: '42P01' } });
    await expect(findCreatedInvoice(db.client as any, 'biz', 'key', 'hash')).rejects.toMatchObject({
      status: 503,
      code: 'IDEMPOTENCY_UNAVAILABLE',
    });
  });
  it('rejects changed terms or deleted originals', async () => {
    const db = database({ data: { request_hash: 'original', invoice_id: 'inv' }, error: null });
    await expect(
      findCreatedInvoice(db.client as any, 'biz', 'key', 'changed')
    ).rejects.toMatchObject({ status: 409 });
    db.chain.maybeSingle.mockResolvedValue({
      data: { request_hash: 'hash', invoice_id: null },
      error: null,
    });
    await expect(findCreatedInvoice(db.client as any, 'biz', 'key', 'hash')).rejects.toMatchObject({
      status: 410,
    });
  });
  it('returns current state of the original without republishing or altering it', async () => {
    const db = database({});
    db.chain.maybeSingle
      .mockResolvedValueOnce({ data: { request_hash: 'hash', invoice_id: 'inv' }, error: null })
      .mockResolvedValueOnce({ data: { id: 'inv', status: 'cancelled' }, error: null });
    expect(await findCreatedInvoice(db.client as any, 'biz', 'key', 'hash')).toEqual({
      id: 'inv',
      status: 'cancelled',
    });
    expect(db.chain.eq).toHaveBeenCalledWith('business_id', 'biz');
    expect(db.chain.eq).toHaveBeenCalledWith('idempotency_key', 'key');
    expect(db.client.rpc).not.toHaveBeenCalled();
  });
  it.each([
    ['PT409', 409],
    ['PT410', 410],
    ['PT429', 429],
    ['42883', 503],
    ['23505', 503],
  ])('surfaces %s from atomic creation without fallback inserts', async (code, status) => {
    const db = database({});
    db.client.rpc.mockResolvedValue({ error: { code }, data: null });
    await expect(
      createInvoiceOnce(db.client as any, 'biz', 'key', 'hash', {}, null)
    ).rejects.toMatchObject({ status });
    expect(db.client.from).not.toHaveBeenCalled();
  });
  it('does not report success for an unconfirmed RPC response', async () => {
    const db = database({});
    db.client.rpc.mockResolvedValue({ data: [], error: null });
    await expect(
      createInvoiceOnce(db.client as any, 'biz', 'key', 'hash', {}, null)
    ).rejects.toMatchObject({ status: 503 });
  });
});
